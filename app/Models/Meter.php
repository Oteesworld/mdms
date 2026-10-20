<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Meter extends Model
{
    protected $guarded = ['id'];

    protected $hidden = ['app_key'];

    protected function casts(): array
    {
        return [
            'balance' => 'float',
            'online' => 'boolean',
            'tamper' => 'boolean',
            'offline_days' => 'integer',
            'battery_pct' => 'integer',
            'app_key' => 'encrypted',
            'commissioning' => 'array',
            'installed_at' => 'date',
            'joined_at' => 'datetime',
            'last_uplink_at' => 'datetime',
            'lat' => 'float',
            'lng' => 'float',
            'initial_reading' => 'float',
            'last_snr' => 'float',
            'total_m3' => 'float',
            'remaining_m3' => 'float',
            'flow_m3h' => 'float',
            'battery_v' => 'float',
            'temperature_c' => 'float',
        ];
    }

    public function readings(): HasMany
    {
        return $this->hasMany(MeterReading::class);
    }

    public function uplinks(): HasMany
    {
        return $this->hasMany(Uplink::class);
    }

    public function alarms(): HasMany
    {
        return $this->hasMany(MeterAlarm::class);
    }

    /** Has the meter sent anything yet? Older demo meters only have the fixture state. */
    public function hasTelemetry(): bool
    {
        return $this->last_uplink_at !== null;
    }

    /**
     * Online while uplinks keep arriving: a meter that reports every N hours counts as
     * offline after missing two reports (plus an hour's grace).
     */
    public function isOnline(): bool
    {
        if (! $this->hasTelemetry()) {
            return $this->network_status === 'reporting' && $this->online;
        }

        return $this->last_uplink_at->gt(now()->subHours(2 * $this->reporting_hours + 1));
    }

    public function lastSeenText(): string
    {
        if (! $this->hasTelemetry()) {
            return $this->network_status === 'reporting' ? $this->last_seen : 'never';
        }

        return $this->last_uplink_at->diffForHumans(short: true);
    }

    public function offlineDays(): int
    {
        if (! $this->hasTelemetry()) {
            return $this->offline_days;
        }

        return $this->isOnline() ? 0 : (int) floor($this->last_uplink_at->diffInHours(now()) / 24);
    }

    public function batteryPercent(): int
    {
        if ($this->battery_v === null) {
            return $this->battery_pct;
        }
        $full = config('kalahari.battery_full_v');
        $empty = config('kalahari.battery_empty_v');

        return (int) round(max(0, min(1, ($this->battery_v - $empty) / ($full - $empty))) * 100);
    }

    public function isAssigned(): bool
    {
        return $this->client_id !== null;
    }
}
