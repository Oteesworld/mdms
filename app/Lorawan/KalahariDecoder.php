<?php

namespace App\Lorawan;

use Illuminate\Support\Carbon;

/**
 * Turns a Kalahari uplink into hourly records and meter state.
 *
 * Two inputs are supported:
 *  1. A decoded object from the network server's payload codec (ChirpStack `object`,
 *     TTN `decoded_payload`). Field names follow the manual's frozen-data columns; both the
 *     manual's labels ("Total+", "Vol-RTU", …) and camelCase names are accepted. See README.
 *  2. The raw frame bytes. The byte layout is defined in the "Kalahari Ultrasonic Water Meter
 *     Communication Protocol", which isn't available yet, so decodeBytes() returns null and the
 *     frame is stored as "undecoded". Implement it there and run `php artisan mdms:redecode`.
 */
class KalahariDecoder
{
    private const FIELDS = [
        'time' => ['time', 'Time', 'timestamp', 'readAt', 'read_at'],
        'total_forward' => ['totalForward', 'total_forward', 'Total+', 'total'],
        'flow_forward' => ['flowForward', 'flow_forward', 'Flow+', 'flow'],
        'rtu_voltage' => ['rtuVoltage', 'rtu_voltage', 'Vol-RTU', 'batteryVoltage', 'battery_voltage'],
        'meter_voltage' => ['meterVoltage', 'meter_voltage', 'Voltage'],
        'temperature' => ['temperature', 'waterTemp', 'water_temp', 'Water Temp', 'Temp'],
        'status' => ['status', 'Status'],
        'consumption' => ['consumption', 'consume', 'Consume'],
        'total_reverse' => ['totalReverse', 'total_reverse', 'Total-'],
        'flow_reverse' => ['flowReverse', 'flow_reverse', 'Flow-'],
        'remaining' => ['remainingVolume', 'remaining_volume', 'remaining'],
    ];

    /** Fields scaled by kalahari.volume_scale into m³ and m³/h. */
    private const VOLUMES = ['total_forward', 'flow_forward', 'consumption', 'total_reverse', 'flow_reverse', 'remaining'];

    private function scale(): float
    {
        return (float) config('kalahari.volume_scale', 1);
    }

    /** @return array{records: list<array>, state: array, alarms: ?list<string>}|null */
    public function decodeBytes(int $fPort, string $bytes, Carbon $receivedAt): ?array
    {
        // Waiting for the Kalahari communication protocol document.
        return null;
    }

    /** @return array{records: list<array>, state: array, alarms: ?list<string>} */
    public function fromObject(array $o, Carbon $receivedAt): array
    {
        $raw = isset($o['records']) && is_array($o['records']) ? array_values($o['records']) : [$o];
        $hour = $receivedAt->copy()->utc()->startOfHour();
        $records = [];
        $n = count($raw);
        foreach ($raw as $i => $r) {
            if (! is_array($r)) {
                throw new DecodeException('Each record must be an object.');
            }
            $rec = [];
            foreach (self::FIELDS as $key => $names) {
                $rec[$key] = $this->pick($r, $names);
            }
            if (! is_numeric($rec['total_forward'])) {
                throw new DecodeException('Record '.($i + 1).' has no totalForward ("Total+") reading.');
            }
            // Packages without timestamps are consecutive hours ending at the hour received.
            $rec['read_at'] = $rec['time'] !== null ? $this->time($rec['time']) : $hour->copy()->subHours($n - 1 - $i);
            unset($rec['time']);
            foreach ($rec as $k => $v) {
                if ($k !== 'read_at' && $v !== null) {
                    $rec[$k] = match (true) {
                        $k === 'status' => $this->status($v),
                        in_array($k, self::VOLUMES, true) => round((float) $v * $this->scale(), 4),
                        default => (float) $v,
                    };
                }
            }
            $records[] = $rec;
        }

        $valve = $this->pick($o, ['valve', 'valveStatus', 'valve_status']);

        return [
            'records' => $records,
            'state' => array_filter([
                'remaining' => is_numeric($r = $this->pick($o, self::FIELDS['remaining'])) ? round((float) $r * $this->scale(), 4) : null,
                'valve' => $valve === null ? null : $this->valve($valve),
                'firmware' => $this->pick($o, ['firmware', 'fw', 'version']),
            ], fn ($v) => $v !== null),
            'alarms' => isset($o['alarms']) && is_array($o['alarms']) ? array_values(array_map('strval', $o['alarms'])) : null,
        ];
    }

    private function pick(array $a, array $names): mixed
    {
        foreach ($names as $n) {
            if (array_key_exists($n, $a)) {
                return $a[$n];
            }
        }

        return null;
    }

    /** ISO 8601, epoch seconds, or the manual's "24/09/29 08" (yy/mm/dd hh, meter clock in UTC+2). */
    private function time(mixed $t): Carbon
    {
        if (is_numeric($t)) {
            return Carbon::createFromTimestampUTC((int) $t);
        }
        if (preg_match('#^(\d{2})/(\d{2})/(\d{2}) (\d{2})$#', (string) $t, $m)) {
            return Carbon::create(2000 + (int) $m[1], (int) $m[2], (int) $m[3], (int) $m[4], 0, 0, 'Africa/Gaborone')->utc();
        }
        try {
            return Carbon::parse((string) $t)->utc();
        } catch (\Throwable) {
            throw new DecodeException("Unreadable record time \"{$t}\".");
        }
    }

    private function status(mixed $v): int
    {
        return is_string($v) && str_starts_with(strtolower($v), '0x') ? hexdec(substr($v, 2)) : (int) $v;
    }

    private function valve(mixed $v): string
    {
        if (is_bool($v)) {
            return $v ? 'open' : 'closed';
        }

        return in_array(strtolower((string) $v), ['open', 'opened', '1', 'on'], true) ? 'open' : 'closed';
    }
}
