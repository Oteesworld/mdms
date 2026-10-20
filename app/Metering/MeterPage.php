<?php

namespace App\Metering;

use App\Models\Meter;
use App\Models\MeterAlarm;
use App\Models\MeterReading;
use App\Models\Uplink;
use App\Models\VendingValidation;
use Illuminate\Support\Carbon;

/** Server data for the Meters screens: the register, the add/edit form and each meter's dashboard. */
class MeterPage
{
    public const TZ = 'Africa/Gaborone';

    public function register(): array
    {
        $alarms = MeterAlarm::whereNull('cleared_at')->selectRaw('meter_id, count(*) n')->groupBy('meter_id')->pluck('n', 'meter_id');
        $meters = Meter::orderBy('serial')->get();

        return [
            'meters' => $meters->map(fn (Meter $m) => [
                'serial' => $m->serial,
                'address' => $m->meter_address,
                'client' => $m->client_name,
                'plot' => $m->plot,
                'suburb' => $m->suburb,
                'state' => self::state($m),
                'lastSeen' => $m->lastSeenText(),
                'total' => $m->total_m3,
                'remaining' => $m->remaining_m3,
                'battery' => $m->batteryPercent(),
                'rssi' => $m->last_rssi,
                'alarms' => $alarms[$m->id] ?? 0,
            ]),
            'stats' => [
                'undecoded24h' => Uplink::where('decode_status', 'undecoded')->where('received_at', '>', now()->subDay())->count(),
                'unknown24h' => Uplink::where('decode_status', 'unknown_device')->where('received_at', '>', now()->subDay())->count(),
                'uplinks24h' => Uplink::where('received_at', '>', now()->subDay())->count(),
            ],
        ];
    }

    /** online | offline | awaiting (registered, nothing heard yet) | decommissioned */
    public static function state(Meter $m): string
    {
        return match (true) {
            $m->network_status === 'decommissioned' => 'decommissioned',
            in_array($m->network_status, ['registered', 'joined'], true) && ! $m->hasTelemetry() => 'awaiting',
            default => $m->isOnline() ? 'online' : 'offline',
        };
    }

    public function form(?Meter $meter = null): array
    {
        $clients = Meter::query()->whereNotNull('client_id')->select('client_id', 'client_name', 'type')->distinct()->orderBy('client_name')->get();
        $next = (int) substr((string) Meter::max('serial'), 3) + 1;

        return [
            'form' => [
                'meter' => $meter ? $this->editable($meter) : null,
                'clients' => $clients->map(fn ($c) => ['id' => $c->client_id, 'name' => $c->client_name, 'type' => $c->type])->values(),
                'suburbs' => Meter::whereNotNull('suburb')->distinct()->orderBy('suburb')->pluck('suburb'),
                'regions' => config('kalahari.regions'),
                'reportingHours' => config('kalahari.reporting_hours'),
                'samplingMinutes' => config('kalahari.sampling_minutes'),
                'suggestedSerial' => 'WM-'.str_pad((string) max($next, 100000), 6, '0', STR_PAD_LEFT),
            ],
        ];
    }

    private function editable(Meter $m): array
    {
        return [
            'serial' => $m->serial, 'meter_address' => $m->meter_address, 'dev_eui' => $m->dev_eui, 'join_eui' => $m->join_eui ?? '',
            'has_app_key' => $m->app_key !== null, 'lorawan_region' => $m->lorawan_region, 'device_class' => $m->device_class,
            'reporting_hours' => $m->reporting_hours, 'sampling_minutes' => $m->sampling_minutes,
            'sts_sgc' => $m->sts_sgc, 'sts_krn' => $m->sts_krn, 'sts_ti' => $m->sts_ti,
            'plot' => $m->plot ?? '', 'suburb' => $m->suburb ?? '', 'lat' => $m->lat, 'lng' => $m->lng,
            'installed_at' => $m->installed_at?->toDateString() ?? '', 'initial_reading' => $m->initial_reading, 'seal_no' => $m->seal_no ?? '',
            'valve' => $m->valve === 'unknown' ? 'open' : $m->valve,
            'client_id' => $m->client_id ?? '', 'occupant' => $m->occupant ?? '', 'vending_party' => $m->vending_party,
            'commissioning' => $m->commissioning ?? [], 'decommissioned' => $m->network_status === 'decommissioned',
        ];
    }

    public function dashboard(Meter $m): array
    {
        $since = now()->subDays(30);
        $readings = $m->readings()->where('read_at', '>=', $since)->orderBy('read_at')->get();
        $uplinks = $m->uplinks()->latest('received_at')->limit(60)->get();
        $radio = $m->uplinks()->where('event', 'up')->where('received_at', '>=', $since)->whereNotNull('gateway_id')
            ->selectRaw('gateway_id, count(*) n, avg(rssi) rssi, avg(snr) snr, max(received_at) last')->groupBy('gateway_id')->orderByDesc('last')->limit(5)->get();

        // Daily totals by local day.
        $daily = [];
        foreach ($readings as $r) {
            $day = $r->read_at->copy()->setTimezone(self::TZ)->toDateString();
            $daily[$day] = ($daily[$day] ?? 0) + $r->consumption;
        }
        $today = now(self::TZ)->toDateString();
        $days = [];
        for ($d = 29; $d >= 0; $d--) {
            $key = now(self::TZ)->subDays($d)->toDateString();
            $days[] = ['day' => $key, 'm3' => round($daily[$key] ?? 0, 3), 'complete' => $key !== $today];
        }
        $full = array_filter(array_slice($days, -15, 14), fn ($d) => $d['m3'] > 0);
        $avgDaily = $full ? array_sum(array_column($full, 'm3')) / count($full) : null;

        return [
            'meter' => [
                ...$this->editable($m),
                'model' => $m->model, 'firmware' => $m->firmware, 'network_status' => $m->network_status,
                'state' => self::state($m), 'lastSeen' => $m->lastSeenText(),
                'lastUplinkAt' => $m->last_uplink_at?->toIso8601String(), 'joinedAt' => $m->joined_at?->toIso8601String(),
                'nextReportAt' => $m->last_uplink_at?->copy()->addHours($m->reporting_hours)->toIso8601String(),
                'client_name' => $m->client_name, 'type' => $m->type, 'owner' => $m->owner, 'kyc' => $m->kyc, 'account_status' => $m->account_status,
                'total' => $m->total_m3, 'remaining' => $m->remaining_m3, 'flow' => $m->flow_m3h, 'battery_v' => $m->battery_v,
                'battery_pct' => $m->batteryPercent(), 'temperature' => $m->temperature_c, 'status_code' => $m->status_code, 'valve_state' => $m->valve,
                'last_rssi' => $m->last_rssi, 'last_snr' => $m->last_snr, 'last_fcnt' => $m->last_fcnt, 'last_gateway' => $m->last_gateway,
                'hasTelemetry' => $m->hasTelemetry(),
                'usedToday' => round($daily[$today] ?? 0, 3), 'avgDaily' => $avgDaily !== null ? round($avgDaily, 3) : null,
            ],
            'readings' => $readings->map(fn (MeterReading $r) => [
                't' => $r->read_at->toIso8601String(), 'total' => $r->total_forward, 'flow' => $r->flow_forward, 'rtu' => $r->rtu_voltage,
                'volt' => $r->meter_voltage, 'temp' => $r->temperature, 'status' => $r->status, 'use' => $r->consumption,
                'totalRev' => $r->total_reverse, 'flowRev' => $r->flow_reverse, 'remaining' => $r->remaining,
            ]),
            'daily' => $days,
            'alarms' => $m->alarms()->where(fn ($q) => $q->whereNull('cleared_at')->orWhere('raised_at', '>=', $since))->latest('raised_at')->limit(20)->get()
                ->map(fn (MeterAlarm $a) => [
                    'type' => $a->type, 'label' => AlarmEvaluator::LABELS[$a->type] ?? ucfirst(str_replace('_', ' ', $a->type)),
                    'source' => $a->source, 'detail' => $a->detail, 'raised' => $a->raised_at->toIso8601String(), 'cleared' => $a->cleared_at?->toIso8601String(),
                ]),
            'uplinks' => $uplinks->map(fn (Uplink $u) => [
                'id' => $u->id, 't' => $u->received_at->toIso8601String(), 'event' => $u->event, 'fcnt' => $u->f_cnt, 'port' => $u->f_port,
                'gateway' => $u->gateway_id, 'rssi' => $u->rssi, 'snr' => $u->snr, 'dr' => $u->data_rate, 'freq' => $u->frequency,
                'source' => $u->source, 'status' => $u->decode_status, 'error' => $u->decode_error, 'records' => $u->records, 'payload' => $u->payload_hex,
            ]),
            'gateways' => $radio->map(fn ($g) => [
                'id' => $g->gateway_id, 'messages' => (int) $g->n, 'rssi' => round((float) $g->rssi), 'snr' => round((float) $g->snr, 1),
                'last' => Carbon::parse($g->last)->toIso8601String(),
            ]),
            'vending' => VendingValidation::where('meter', $m->serial)->orWhere('meter', $m->meter_address)->latest('id')->limit(8)->get()
                ->map(fn ($v) => ['t' => $v->created_at->toIso8601String(), 'source' => $v->source, 'vendor' => $v->vendor, 'result' => $v->result, 'code' => $v->code, 'amount' => $v->amount]),
            'specs' => config('kalahari.specs'),
            'statusBits' => config('kalahari.status_bits'),
            'canSimulate' => (bool) config('mdms.demo'),
        ];
    }
}
