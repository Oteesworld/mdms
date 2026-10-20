<?php

namespace App\Lorawan;

use App\Metering\AlarmEvaluator;
use App\Models\Meter;
use App\Models\MeterReading;
use App\Models\Uplink;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Stores every frame from the network server and applies decoded readings to the meter.
 * The network server has already decrypted the LoRaWAN payload with the device's session
 * keys; what arrives here is the application payload (and, if a codec is configured on the
 * network server, its decoded object).
 */
class UplinkIngestor
{
    public function __construct(private KalahariDecoder $decoder, private AlarmEvaluator $alarms) {}

    public function ingest(array $n): Uplink
    {
        return DB::transaction(function () use ($n) {
            $meter = Meter::where('dev_eui', $n['dev_eui'])->first();
            $uplink = new Uplink([
                'meter_id' => $meter?->id,
                ...array_intersect_key($n, array_flip(['dev_eui', 'event', 'f_cnt', 'f_port', 'payload_hex', 'rssi', 'snr', 'gateway_id', 'frequency', 'data_rate', 'source', 'received_at'])),
            ]);

            if (! $meter) {
                $uplink->fill(['decode_status' => 'unknown_device', 'decode_error' => 'No meter is registered with this DevEUI.'])->save();

                return $uplink;
            }

            if ($n['event'] === 'join') {
                $uplink->fill(['decode_status' => 'join'])->save();
                $meter->update([
                    'joined_at' => $n['received_at'],
                    'network_status' => $meter->network_status === 'registered' ? 'joined' : $meter->network_status,
                ]);

                return $uplink;
            }

            $meter->fill([
                'last_uplink_at' => $n['received_at'],
                'last_fcnt' => $n['f_cnt'],
                'last_rssi' => $n['rssi'],
                'last_snr' => $n['snr'],
                'last_gateway' => $n['gateway_id'],
                'network_status' => $meter->network_status === 'decommissioned' ? 'decommissioned' : 'reporting',
                'joined_at' => $meter->joined_at ?? $n['received_at'],
            ]);

            try {
                $decoded = $n['object'] !== null
                    ? $this->decoder->fromObject($n['object'], $n['received_at'])
                    : ($n['payload_hex'] !== null ? $this->decoder->decodeBytes((int) $n['f_port'], hex2bin($n['payload_hex']), $n['received_at']) : null);
            } catch (DecodeException $e) {
                $uplink->fill(['decode_status' => 'error', 'decode_error' => substr($e->getMessage(), 0, 250)])->save();
                $meter->save();

                return $uplink;
            }

            if ($decoded === null) {
                $uplink->fill(['decode_status' => 'undecoded', 'decode_error' => 'Waiting for the Kalahari protocol decoder.'])->save();
                $meter->save();

                return $uplink;
            }

            $uplink->fill(['decode_status' => 'decoded', 'records' => count($decoded['records']), 'decoded' => $decoded])->save();
            $this->apply($meter, $uplink, $decoded, $n['received_at']);

            return $uplink;
        });
    }

    /** Write the hourly records and refresh the meter's latest values. Also used by mdms:redecode. */
    public function apply(Meter $meter, Uplink $uplink, array $decoded, Carbon $at): void
    {
        $records = collect($decoded['records'])->sortBy('read_at')->values();
        $previous = $meter->readings()->where('read_at', '<', $records->first()['read_at'])->latest('read_at')->first();
        $prevTotal = $previous?->total_forward ?? ($meter->total_m3 ?? $meter->initial_reading);

        // The hourly records don't carry credit; the package's remaining volume belongs to its newest hour.
        $lastIdx = $records->count() - 1;
        $rows = [];
        foreach ($records as $i => $r) {
            // Hourly consumption from the register when the meter doesn't send it.
            $consumption = $r['consumption'] ?? max(0, $r['total_forward'] - $prevTotal);
            $prevTotal = $r['total_forward'];
            $rows[] = [
                'meter_id' => $meter->id,
                'uplink_id' => $uplink->id,
                'read_at' => $r['read_at'],
                'total_forward' => $r['total_forward'],
                'flow_forward' => $r['flow_forward'] ?? 0,
                'rtu_voltage' => $r['rtu_voltage'],
                'meter_voltage' => $r['meter_voltage'],
                'temperature' => $r['temperature'],
                'status' => $r['status'],
                'consumption' => round($consumption, 3),
                'total_reverse' => $r['total_reverse'] ?? 0,
                'flow_reverse' => $r['flow_reverse'] ?? 0,
                'remaining' => $r['remaining'] ?? ($i === $lastIdx ? ($decoded['state']['remaining'] ?? null) : null),
            ];
        }
        MeterReading::upsert($rows, ['meter_id', 'read_at'], array_keys(array_diff_key($rows[0], ['meter_id' => 1, 'read_at' => 1])));

        $latest = $meter->readings()->latest('read_at')->first();
        $state = $decoded['state'];
        $meter->fill([
            'total_m3' => $latest->total_forward,
            'flow_m3h' => $latest->flow_forward,
            'battery_v' => $latest->rtu_voltage ?? $meter->battery_v,
            'temperature_c' => $latest->temperature ?? $meter->temperature_c,
            'status_code' => $latest->status ?? $meter->status_code,
            'remaining_m3' => $state['remaining'] ?? $latest->remaining ?? $meter->remaining_m3,
            'valve' => $state['valve'] ?? $meter->valve,
            'firmware' => $state['firmware'] ?? $meter->firmware,
        ])->save();

        $this->alarms->evaluate($meter, $decoded['alarms'], $at);
    }
}
