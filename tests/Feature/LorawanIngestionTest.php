<?php

namespace Tests\Feature;

use App\Models\Meter;
use App\Models\MeterReading;
use App\Models\Uplink;
use App\Vending\MeterValidator;
use Database\Seeders\MeterSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LorawanIngestionTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-lorawan-token';

    private Meter $meter;

    protected function setUp(): void
    {
        parent::setUp();
        config(['mdms.lorawan_webhook_token' => self::TOKEN]);
        $this->seed(MeterSeeder::class);
        $this->meter = tap(Meter::firstWhere('serial', 'WM-104000'))->update(['network_status' => 'registered', 'total_m3' => null, 'initial_reading' => 60]);
    }

    private function hook(array $body, string $query = '')
    {
        return $this->postJson('/api/lorawan/uplink'.$query, $body, ['Authorization' => 'Bearer '.self::TOKEN]);
    }

    private function chirpstack(?array $object = null, array $extra = []): array
    {
        return [
            'deviceInfo' => ['devEui' => strtolower($this->meter->dev_eui)], 'fCnt' => 7, 'fPort' => 10, 'data' => base64_encode("\x01\x02"),
            'time' => '2026-10-20T10:05:00Z', 'rxInfo' => [['gatewayId' => 'gw-a', 'rssi' => -112, 'snr' => -2], ['gatewayId' => 'gw-b', 'rssi' => -97, 'snr' => 7.5]],
            'txInfo' => ['frequency' => 868300000, 'modulation' => ['lora' => ['spreadingFactor' => 9]]],
            ...($object !== null ? ['object' => $object] : []), ...$extra,
        ];
    }

    public function test_token_is_required(): void
    {
        $this->postJson('/api/lorawan/uplink', [])->assertUnauthorized();
        config(['mdms.lorawan_webhook_token' => null]);
        $this->hook([])->assertStatus(503);
    }

    public function test_join_then_decoded_package_with_the_manuals_columns(): void
    {
        $this->hook($this->chirpstack(), '?event=join')->assertOk()->assertJson(['status' => 'join']);
        $this->assertSame('joined', $this->meter->fresh()->network_status);

        $this->hook($this->chirpstack([
            'records' => [
                ['Time' => '26/10/20 10', 'Total+' => 69.9, 'Flow+' => 0, 'Vol-RTU' => 3.68, 'Voltage' => 0, 'Water Temp' => 0, 'Status' => 42, 'Consume' => 0, 'Total-' => 1.2, 'Flow-' => 0],
                ['Time' => '26/10/20 11', 'Total+' => 70.3, 'Flow+' => 0.5, 'Vol-RTU' => 3.68, 'Voltage' => 3.65, 'Water Temp' => 24.2, 'Status' => '0x40', 'Total-' => 1.2, 'Flow-' => 0],
            ],
            'remainingVolume' => 4.2, 'valve' => 'open',
        ]))->assertOk()->assertJson(['status' => 'decoded', 'records' => 2]);

        $m = $this->meter->fresh();
        $this->assertSame(['reporting', 'gw-b', -97, 7, 70.3, 4.2, 'open'], [$m->network_status, $m->last_gateway, $m->last_rssi, $m->last_fcnt, $m->total_m3, $m->remaining_m3, $m->valve]);
        $readings = $m->readings()->orderBy('read_at')->get();
        // "26/10/20 10" is meter time (UTC+2), so 08:00 UTC.
        $this->assertSame('2026-10-20 08:00:00', $readings[0]->read_at->utc()->format('Y-m-d H:i:s'));
        $this->assertEqualsWithDelta(0.4, $readings[1]->consumption, 1e-9, 'consumption derived from the register');
        $this->assertSame(0x40, $readings[1]->status);
        $this->assertEquals(4.2, $readings[1]->remaining);
        $this->assertNull($readings[0]->remaining);
        $this->assertTrue($m->isOnline());
    }

    public function test_repeated_packages_do_not_duplicate_hours(): void
    {
        $body = $this->chirpstack(['records' => [['time' => '2026-10-20T08:00:00Z', 'totalForward' => 10]]]);
        $this->hook($body);
        $this->hook($body);
        $this->assertSame(1, MeterReading::count());
        $this->assertSame(2, Uplink::count());
    }

    public function test_raw_frames_are_kept_undecoded_until_the_protocol_decoder_exists(): void
    {
        $this->hook([
            'end_device_ids' => ['dev_eui' => $this->meter->dev_eui], 'received_at' => '2026-10-20T11:05:00Z',
            'uplink_message' => ['f_port' => 10, 'f_cnt' => 2, 'frm_payload' => base64_encode('hello'),
                'rx_metadata' => [['gateway_ids' => ['gateway_id' => 'gw-gab-01'], 'rssi' => -99, 'snr' => 4]], 'settings' => ['frequency' => '868100000']],
        ])->assertOk()->assertJson(['status' => 'undecoded']);

        $u = Uplink::sole();
        $this->assertSame(['68656C6C6F', 'ttn', 'gw-gab-01'], [$u->payload_hex, $u->source, $u->gateway_id]);
        $this->assertSame(0, MeterReading::count());
        $this->assertSame('reporting', $this->meter->fresh()->network_status, 'the meter is heard even if not decoded');
        $this->artisan('mdms:redecode')->expectsOutput('Decoded 0 stored uplink(s).')->assertSuccessful();
    }

    public function test_unknown_devices_and_bad_records(): void
    {
        $this->hook(['deviceInfo' => ['devEui' => 'FFFFFFFFFFFFFFFF'], 'fCnt' => 1])->assertStatus(202)->assertJson(['status' => 'unknown_device']);
        $this->hook($this->chirpstack(['records' => [['Flow+' => 1]]]))->assertJson(['status' => 'error']);
        $this->hook(['nope' => 1])->assertStatus(400);
        $this->hook($this->chirpstack(), '?event=status')->assertJson(['ignored' => 'status']);
    }

    public function test_alarms_are_derived_and_cleared(): void
    {
        $this->hook($this->chirpstack(['records' => [['time' => '2026-10-20T08:00:00Z', 'Total+' => 61, 'Flow+' => 4.0, 'Vol-RTU' => 3.35]], 'remainingVolume' => 0.4, 'alarms' => ['valve_fault']]));
        $open = $this->meter->alarms()->whereNull('cleared_at')->pluck('source', 'type')->all();
        ksort($open);
        $this->assertSame(['burst' => 'platform', 'low_battery' => 'platform', 'low_credit' => 'platform', 'valve_fault' => 'meter'], $open);

        $this->hook($this->chirpstack(['records' => [['time' => '2026-10-20T09:00:00Z', 'Total+' => 61.1, 'Flow+' => 0, 'Vol-RTU' => 3.6]], 'remainingVolume' => 9, 'alarms' => []]));
        $this->assertSame(0, $this->meter->alarms()->whereNull('cleared_at')->count());
    }

    public function test_volume_scale_converts_litres(): void
    {
        config(['kalahari.volume_scale' => 0.001]);
        $this->hook($this->chirpstack(['records' => [['time' => '2026-10-20T08:00:00Z', 'Total+' => 69900, 'Flow+' => 250]], 'remainingVolume' => 4200]));
        $m = $this->meter->fresh();
        $this->assertSame([69.9, 0.25, 4.2], [$m->total_m3, $m->flow_m3h, $m->remaining_m3]);
    }

    public function test_vending_accepts_the_meter_number_and_uses_live_state(): void
    {
        $this->hook($this->chirpstack(['records' => [['time' => now()->subHour()->toIso8601String(), 'Total+' => 61, 'Vol-RTU' => 3.62]], 'remainingVolume' => 5]));
        $res = app(MeterValidator::class)->validate(['meter' => $this->meter->meter_address]);
        $this->assertSame(['APPROVED', 'WM-104000', 'online', $this->meter->meter_address], [$res['result'], $res['meter']['serial'], $res['meter']['status'], $res['sts']['meterNumber']]);

        Meter::create(['serial' => 'WM-300002', 'dev_eui' => 'AAAAAAAAAAAAAAAA', 'meter_address' => '0288260510566', 'last_seen' => '', 'network_status' => 'registered']);
        $this->assertSame('VENDING_NOT_PERMITTED', app(MeterValidator::class)->validate(['meter' => 'WM-300002'])['code']);
    }
}
