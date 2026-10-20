<?php

namespace App\Metering;

use App\Lorawan\UplinkIngestor;
use App\Models\Meter;
use Illuminate\Support\Carbon;

/**
 * Demo data: builds the uplinks a Kalahari meter would send (hourly records packaged every
 * `reporting_hours`, as decoded by a network-server codec) and feeds them through the real
 * ingestion pipeline. Only used in demo mode and from the meter page's "Simulate" button.
 */
class MeterSimulator
{
    private const GATEWAYS = ['GW-GAB-01', 'GW-GAB-02', 'GW-GAB-03', 'GW-GAB-04', 'GW-GAB-05'];

    /** Litres per hour by hour of day for a typical household. */
    private const PROFILE = [2, 1, 1, 1, 2, 8, 34, 52, 38, 20, 14, 12, 16, 14, 10, 10, 14, 26, 44, 48, 36, 22, 10, 4];

    private int $seed;

    public function __construct(private UplinkIngestor $ingestor) {}

    /** Simulate the meter's uplinks for the hours from $from up to $to. Returns the number of uplinks sent. */
    public function run(Meter $meter, Carbon $from, Carbon $to): int
    {
        $this->seed = crc32($meter->serial.$from->timestamp);
        $from = $from->copy()->utc()->startOfHour();
        $to = $to->copy()->utc()->startOfHour();
        $last = $meter->readings()->latest('read_at')->first();
        $total = $last?->total_forward ?? ($meter->total_m3 ?? max($meter->initial_reading, 20 + $this->rand() * 300));
        $remaining = $meter->remaining_m3 ?? round(3 + $this->rand() * 12, 3);
        $battery = $last?->rtu_voltage ?? ($meter->battery_v ?? round(3.30 + ($meter->battery_pct / 100) * 0.36, 2));
        $business = $meter->type === 'business';
        $leaky = crc32($meter->serial) % 9 === 0;
        $scale = ($business ? 3.2 : 1) * (0.6 + (crc32($meter->serial) % 100) / 100);
        $fcnt = $meter->last_fcnt ?? (int) (1000 + $this->rand() * 4000);
        $records = [];
        $sent = 0;

        for ($t = $from->copy(); $t->lte($to); $t->addHour()) {
            $local = $t->copy()->setTimezone('Africa/Gaborone');
            $litres = self::PROFILE[$local->hour] * $scale * (0.5 + $this->rand()) + ($leaky ? 3 : 0);
            if ($this->rand() < 0.12 && ! $leaky) {
                $litres = 0;
            }
            if ($remaining <= 0) {
                $litres = 0; // valve closed
            }
            $m3 = round($litres / 1000, 3);
            $total = round($total + $m3, 3);
            $remaining = round($remaining - $m3, 3);
            if ($remaining < 1.2 && $meter->balance >= 0 && $this->rand() < 0.3) {
                $remaining = round($remaining + 10, 3); // token entered
            }
            $battery = max(3.2, $battery - 0.00002);
            $flowing = $m3 > 0 && $this->rand() < 0.4;
            $records[] = [
                'time' => $t->toIso8601ZuluString(),
                'Total+' => $total,
                'Flow+' => $flowing ? round($m3 * (1.5 + $this->rand() * 2), 3) : 0,
                'Vol-RTU' => round($battery, 2),
                'Voltage' => $flowing ? round($battery - 0.03, 2) : 0,
                'Water Temp' => round(19 + 7 * sin(($local->hour - 9) / 24 * 2 * M_PI) + $this->rand() * 2, 1),
                'Status' => $flowing ? 0x40 : 0x42,
                'Consume' => $m3,
                'Total-' => 0,
                'Flow-' => 0,
            ];

            if (count($records) >= $meter->reporting_hours || $t->eq($to)) {
                $this->send($meter, $records, $t->copy()->addMinutes(2 + crc32($meter->serial) % 50), ++$fcnt, $remaining);
                $records = [];
                $sent++;
            }
        }

        return $sent;
    }

    private function send(Meter $meter, array $records, Carbon $at, int $fcnt, float $remaining): void
    {
        $gw = self::GATEWAYS[crc32($meter->serial) % count(self::GATEWAYS)];
        $this->ingestor->ingest([
            'source' => 'simulated',
            'event' => 'up',
            'dev_eui' => $meter->dev_eui,
            'f_cnt' => $fcnt,
            'f_port' => 10,
            'payload_hex' => null,
            'rssi' => (int) round(-92 - $this->rand() * 22),
            'snr' => round(-4 + $this->rand() * 13, 1),
            'gateway_id' => $gw,
            'frequency' => [868100000, 868300000, 868500000][$fcnt % 3],
            'data_rate' => 'SF'.(9 + $fcnt % 3),
            'received_at' => $at->copy()->min(now()),
            'object' => [
                'records' => $records,
                'remainingVolume' => $remaining,
                'valve' => $remaining > 0 ? 'open' : 'closed',
                'firmware' => 'KU-1.03',
            ],
        ]);
    }

    private function rand(): float
    {
        $this->seed = ($this->seed * 1103515245 + 12345) & 0x7FFFFFFF;

        return $this->seed / 0x7FFFFFFF;
    }
}
