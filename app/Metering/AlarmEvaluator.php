<?php

namespace App\Metering;

use App\Models\Meter;
use App\Models\MeterAlarm;
use Illuminate\Support\Carbon;

/**
 * Keeps a meter's open alarms in step with what it reports. Alarms the meter sends itself
 * (leakage, burst, low balance…) are stored as source "meter"; the platform also derives its
 * own from the hourly records so they work before the protocol's alarm bits are known.
 */
class AlarmEvaluator
{
    public const LABELS = [
        'burst' => 'Burst pipe',
        'leak' => 'Continuous flow (leak)',
        'leakage' => 'Leakage',
        'reverse_flow' => 'Reverse flow',
        'low_battery' => 'Low battery',
        'low_credit' => 'Low credit',
        'no_credit' => 'Credit exhausted',
        'low_balance' => 'Low balance',
        'valve_fault' => 'Valve fault',
        'valve_closed' => 'Valve closed',
        'hardware_error' => 'Hardware error',
        'tamper' => 'Tamper',
    ];

    private const DERIVED = ['burst', 'leak', 'reverse_flow', 'low_battery', 'low_credit', 'no_credit'];

    /**
     * @param  ?list<string>  $reported  alarms in this uplink, or null if the uplink doesn't carry an alarm list
     */
    public function evaluate(Meter $meter, ?array $reported, Carbon $at): void
    {
        $recent = $meter->readings()->latest('read_at')->limit(max(24, (int) config('kalahari.leak_hours')))->get();
        if ($recent->isEmpty()) {
            return;
        }
        $latest = $recent->first();
        $q3 = (float) config('kalahari.q3');
        $leakHours = (int) config('kalahari.leak_hours');
        $window = $recent->take($leakHours);
        $remaining = $meter->remaining_m3;

        $derived = [
            'burst' => $latest->flow_forward > $q3 * config('kalahari.burst_factor')
                ? sprintf('Flow %.2f m³/h is above %.2f m³/h (1.25 × Q3)', $latest->flow_forward, $q3 * config('kalahari.burst_factor')) : null,
            'leak' => $window->count() >= $leakHours && $window->every(fn ($r) => $r->consumption >= config('kalahari.leak_min_m3'))
                ? sprintf('Water has flowed every hour for %d hours (at least %.0f L/h)', $leakHours, $window->min('consumption') * 1000) : null,
            'reverse_flow' => $latest->flow_reverse > 0 || $recent->last()->total_reverse < $latest->total_reverse
                ? sprintf('Reverse register at %.3f m³', $latest->total_reverse) : null,
            'low_battery' => $latest->rtu_voltage !== null && $latest->rtu_voltage < config('kalahari.low_battery_v')
                ? sprintf('Battery at %.2f V', $latest->rtu_voltage) : null,
            'no_credit' => $remaining !== null && $remaining <= 0 ? 'No water credit left; the valve closes until a token is entered' : null,
            'low_credit' => $remaining !== null && $remaining > 0 && $remaining <= config('kalahari.low_credit_m3')
                ? sprintf('%.2f m³ of credit left', $remaining) : null,
        ];

        $open = $meter->alarms()->whereNull('cleared_at')->get()->keyBy('type');
        foreach ($derived as $type => $detail) {
            $this->sync($meter, $open, $type, 'platform', $detail, $at);
        }
        if ($reported !== null) {
            $types = array_values(array_unique(array_map(fn ($t) => strtolower(str_replace([' ', '-'], '_', $t)), $reported)));
            foreach ($open->where('source', 'meter') as $type => $alarm) {
                if (! in_array($type, $types, true)) {
                    $alarm->update(['cleared_at' => $at]);
                }
            }
            foreach ($types as $type) {
                if (! in_array($type, self::DERIVED, true)) {
                    $this->sync($meter, $open, $type, 'meter', 'Reported by the meter', $at);
                }
            }
        }
    }

    private function sync(Meter $meter, $open, string $type, string $source, ?string $detail, Carbon $at): void
    {
        $existing = $open->get($type);
        if ($detail && ! $existing) {
            $meter->alarms()->create(['type' => $type, 'source' => $source, 'detail' => $detail, 'raised_at' => $at]);
        } elseif (! $detail && $existing && $existing->source === $source) {
            $existing->update(['cleared_at' => $at]);
        }
    }
}
