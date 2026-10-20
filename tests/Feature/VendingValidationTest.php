<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Meter;
use App\Models\User;
use App\Models\VendingValidation;
use Database\Seeders\MeterSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class VendingValidationTest extends TestCase
{
    use RefreshDatabase;

    private const KEY = 'test-vending-key-0123456789';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(MeterSeeder::class);
        config(['mdms.vending_api_key' => self::KEY]);
    }

    private function api(array $body, ?string $key = self::KEY)
    {
        return $this->postJson('/api/vending/validate', $body, $key ? ['Authorization' => 'Bearer '.$key] : []);
    }

    public function test_health_check_reports_configuration(): void
    {
        $this->getJson('/api/vending/validate')->assertOk()->assertJson(['configured' => true]);
        config(['mdms.vending_api_key' => null]);
        $this->getJson('/api/vending/validate')->assertJson(['configured' => false]);
        $this->api(['meter' => 'WM-104000'])->assertStatus(503)->assertJson(['error' => 'not_configured']);
    }

    public function test_requests_need_the_api_key(): void
    {
        $this->api(['meter' => 'WM-104000'], null)->assertUnauthorized();
        $this->api(['meter' => 'WM-104000'], 'wrong')->assertUnauthorized();
        $this->postJson('/api/vending/validate', ['meter' => 'WM-104000'], ['X-Api-Key' => self::KEY])->assertOk();
    }

    public function test_bad_requests_are_rejected(): void
    {
        $this->api([])->assertStatus(400);
        $this->api(['meter' => 'WM-104000', 'purchaser' => 'landlord'])->assertStatus(400);
        $this->api(['meter' => 'WM-104000', 'amount' => -5])->assertStatus(400);
        $this->call('POST', '/api/vending/validate', server: ['HTTP_AUTHORIZATION' => 'Bearer '.self::KEY, 'CONTENT_TYPE' => 'application/json'], content: 'not json')
            ->assertStatus(400);
    }

    public function test_an_approved_meter_gets_sts_parameters_and_is_logged(): void
    {
        $this->api(['meter' => 'wm-104000', 'purchaser' => 'occupant', 'amount' => 100, 'vendorRef' => 'OM-1', 'vendor' => 'Orange Money'])
            ->assertOk()
            ->assertJson([
                'result' => 'APPROVED', 'code' => 'OK',
                'meter' => ['serial' => 'WM-104000'],
                'account' => ['vendingParty' => 'occupant'],
                'sts' => ['supplyGroupCode' => '600741', 'keyRevision' => 2, 'tariffIndex' => '01'],
                'tariff' => ['vatRate' => 0.14],
            ]);

        $log = VendingValidation::sole();
        $this->assertSame(['WM-104000', 'API', 'Orange Money', 'OM-1'], [$log->meter, $log->source, $log->vendor, $log->vendor_ref]);
    }

    public function test_decline_codes(): void
    {
        $meter = fn (array $attrs) => tap(Meter::firstWhere('serial', 'WM-104000'))->update($attrs);

        $this->api(['meter' => 'WM-10400'])->assertJson(['result' => 'DECLINED', 'code' => 'INVALID_FORMAT']);
        $this->api(['meter' => 'WM-999999'])->assertJson(['code' => 'METER_NOT_FOUND']);
        $this->api(['meter' => 'WM-104000', 'purchaser' => 'owner'])->assertJson(['code' => 'PURCHASER_NOT_PERMITTED']);

        $meter(['tamper' => true]);
        $this->api(['meter' => 'WM-104000'])->assertJson(['code' => 'TAMPER_HOLD']);
        $meter(['kyc' => 'Pending']);
        $this->api(['meter' => 'WM-104000'])->assertJson(['code' => 'KYC_INCOMPLETE']);
        $meter(['account_status' => 'Suspended']);
        $this->api(['meter' => 'WM-104000'])->assertJson(['code' => 'ACCOUNT_SUSPENDED']);
        $meter(['account_status' => 'Active', 'kyc' => 'Verified', 'tamper' => false, 'vending_party' => 'none']);
        $this->api(['meter' => 'WM-104000'])->assertJson(['code' => 'VENDING_NOT_PERMITTED']);
    }

    public function test_warnings_for_offline_low_battery_and_arrears(): void
    {
        Meter::firstWhere('serial', 'WM-104000')->update(['online' => false, 'offline_days' => 3, 'last_seen' => '3 d 2 h ago', 'battery_pct' => 20, 'balance' => -42.5]);

        $res = $this->api(['meter' => 'WM-104000'])->assertJson(['result' => 'APPROVED'])->json('warnings');
        $this->assertCount(3, $res);
        $this->assertStringContainsString('P 42.50', $res[1]);
    }

    public function test_console_can_relax_rules_but_the_portal_cannot(): void
    {
        Meter::firstWhere('serial', 'WM-104000')->update(['kyc' => 'Pending']);
        $relaxed = ['blockKycIncomplete' => false];

        $finance = User::factory()->role(Role::Finance)->create();
        $this->actingAs($finance)->postJson('/vending/check', ['meter' => 'WM-104000', 'source' => 'Console', 'rules' => $relaxed])
            ->assertOk()->assertJsonPath('entry.res.code', 'OK')->assertJsonPath('entry.source', 'Console');
        $this->actingAs($finance)->postJson('/vending/check', ['meter' => 'WM-104000', 'source' => 'Portal', 'rules' => $relaxed])
            ->assertJsonPath('entry.res.code', 'KYC_INCOMPLETE');

        $field = User::factory()->role(Role::Field)->create();
        $this->actingAs($field)->postJson('/vending/check', ['meter' => 'WM-104000', 'source' => 'Console'])->assertForbidden();
    }

    public function test_vending_screen_receives_the_log_and_api_state(): void
    {
        $this->api(['meter' => 'WM-104000']);

        $this->actingAs(User::factory()->role(Role::Finance)->create())->get('/vending')
            ->assertInertia(fn (Assert $p) => $p
                ->where('api.configured', true)
                ->where('stats.checks', 1)
                ->has('log', 1)
                ->where('example.result', 'APPROVED')
                ->has('samples'));
    }
}
