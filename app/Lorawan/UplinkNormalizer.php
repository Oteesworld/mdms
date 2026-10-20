<?php

namespace App\Lorawan;

use Illuminate\Support\Carbon;

/** Reads ChirpStack v4 and The Things Stack v3 webhook bodies into one shape. */
class UplinkNormalizer
{
    /**
     * @return array{source: string, event: string, dev_eui: string, f_cnt: ?int, f_port: ?int, payload_hex: ?string,
     *               rssi: ?int, snr: ?float, gateway_id: ?string, frequency: ?int, data_rate: ?string, received_at: Carbon, object: ?array}
     */
    public function normalize(array $b, ?string $eventHint = null): array
    {
        if (isset($b['deviceInfo'])) {
            return $this->chirpstack($b, $eventHint);
        }
        if (isset($b['end_device_ids'])) {
            return $this->ttn($b);
        }
        throw new DecodeException('Unrecognised webhook body: expected a ChirpStack v4 or The Things Stack v3 event.');
    }

    private function chirpstack(array $b, ?string $event): array
    {
        $gw = $this->best($b['rxInfo'] ?? [], fn ($r) => $r['rssi'] ?? -999);
        $lora = $b['txInfo']['modulation']['lora'] ?? [];

        return $this->shape('chirpstack', $event === 'join' ? 'join' : 'up', $b['deviceInfo']['devEui'] ?? '', [
            'f_cnt' => $b['fCnt'] ?? null,
            'f_port' => $b['fPort'] ?? null,
            'data' => $b['data'] ?? null,
            'rssi' => $gw['rssi'] ?? null,
            'snr' => $gw['snr'] ?? null,
            'gateway_id' => $gw['gatewayId'] ?? null,
            'frequency' => $b['txInfo']['frequency'] ?? null,
            'data_rate' => isset($lora['spreadingFactor']) ? 'SF'.$lora['spreadingFactor'] : null,
            'time' => $b['time'] ?? null,
            'object' => $b['object'] ?? null,
        ]);
    }

    private function ttn(array $b): array
    {
        $up = $b['uplink_message'] ?? null;
        $gw = $this->best($up['rx_metadata'] ?? [], fn ($r) => $r['rssi'] ?? -999);
        $sf = $up['settings']['data_rate']['lora']['spreading_factor'] ?? null;

        return $this->shape('ttn', $up ? 'up' : (isset($b['join_accept']) ? 'join' : 'other'), $b['end_device_ids']['dev_eui'] ?? '', [
            'f_cnt' => $up['f_cnt'] ?? null,
            'f_port' => $up['f_port'] ?? null,
            'data' => $up['frm_payload'] ?? null,
            'rssi' => $gw['rssi'] ?? null,
            'snr' => $gw['snr'] ?? null,
            'gateway_id' => $gw['gateway_ids']['gateway_id'] ?? null,
            'frequency' => isset($up['settings']['frequency']) ? (int) $up['settings']['frequency'] : null,
            'data_rate' => $sf ? 'SF'.$sf : null,
            'time' => $b['received_at'] ?? null,
            'object' => $up['decoded_payload'] ?? null,
        ]);
    }

    private function shape(string $source, string $event, string $devEui, array $f): array
    {
        $bytes = is_string($f['data']) ? base64_decode($f['data'], true) : false;

        return [
            'source' => $source,
            'event' => $event,
            'dev_eui' => strtoupper(preg_replace('/[^0-9A-Fa-f]/', '', $devEui)),
            'f_cnt' => $f['f_cnt'] !== null ? (int) $f['f_cnt'] : null,
            'f_port' => $f['f_port'] !== null ? (int) $f['f_port'] : null,
            'payload_hex' => $bytes !== false ? strtoupper(bin2hex($bytes)) : null,
            'rssi' => $f['rssi'] !== null ? (int) $f['rssi'] : null,
            'snr' => $f['snr'] !== null ? (float) $f['snr'] : null,
            'gateway_id' => $f['gateway_id'],
            'frequency' => $f['frequency'] !== null ? (int) $f['frequency'] : null,
            'data_rate' => $f['data_rate'],
            'received_at' => $f['time'] ? Carbon::parse($f['time'])->utc() : now()->utc(),
            'object' => is_array($f['object']) && $f['object'] !== [] ? $f['object'] : null,
        ];
    }

    private function best(array $rows, callable $score): array
    {
        usort($rows, fn ($a, $b) => $score($b) <=> $score($a));

        return $rows[0] ?? [];
    }
}
