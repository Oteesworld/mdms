<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Metering\MeterAddress;
use App\Models\Meter;
use App\Models\User;
use Database\Seeders\MeterSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class MeterRegistrationTest extends TestCase
{
    use RefreshDatabase;

    private function valid(array $over = []): array
    {
        return [
            'serial' => 'wm-300001', 'meter_address' => '0288260510566', 'dev_eui' => 'a8:40:41:00:01:82:65:66',
            'join_eui' => '70B3D57ED0000A01', 'app_key' => str_repeat('A1', 16), 'lorawan_region' => 'EU868', 'device_class' => 'A',
            'reporting_hours' => 24, 'sampling_minutes' => 60, 'sts_sgc' => '600741', 'sts_krn' => 2, 'sts_ti' => '01',
            'plot' => 'Plot 1450, Extension 12', 'suburb' => 'Extension 12', 'lat' => -24.6489, 'lng' => 25.9175,
            'installed_at' => now()->toDateString(), 'initial_reading' => 0.012, 'seal_no' => 'S-1', 'valve' => 'open',
            'client_id' => null, 'occupant' => null, 'vending_party' => 'occupant',
            'commissioning' => ['ns_registered' => true, 'bogus' => true], ...$over,
        ];
    }

    public function test_meter_address_check_digit(): void
    {
        $this->assertTrue(MeterAddress::valid('0288260510566')); // the example in the Kalahari manual
        $this->assertFalse(MeterAddress::valid('0288260510567'));
        $this->assertFalse(MeterAddress::valid('028826051056'));
        $this->assertTrue(MeterAddress::valid(MeterAddress::withCheckDigit('028826104000')));
    }

    public function test_field_user_registers_a_meter_as_stock(): void
    {
        $user = User::factory()->role(Role::Field)->create();

        $this->actingAs($user)->post('/meters', $this->valid())->assertRedirect('/meters/WM-300001')->assertSessionHasNoErrors();

        $m = Meter::firstWhere('serial', 'WM-300001');
        $this->assertSame(['A840410001826566', 'registered', null, 'none'], [$m->dev_eui, $m->network_status, $m->client_id, $m->vending_party]);
        $this->assertSame(str_repeat('A1', 16), $m->app_key);
        $this->assertNotSame(str_repeat('A1', 16), \DB::table('meters')->where('id', $m->id)->value('app_key'), 'AppKey is encrypted at rest');
        $this->assertSame(['ns_registered' => true], $m->commissioning);
        $this->assertSame($user->id, $m->registered_by);

        $this->get('/meters/WM-300001')->assertInertia(fn (Assert $p) => $p
            ->where('meter.state', 'awaiting')->where('meter.has_app_key', true)->missing('meter.app_key'));
    }

    public function test_registration_validation(): void
    {
        $this->seed(MeterSeeder::class);
        $taken = Meter::first();
        $user = User::factory()->role(Role::Ops)->create();

        $this->actingAs($user)->post('/meters', $this->valid([
            'serial' => $taken->serial, 'meter_address' => '0288260510567', 'dev_eui' => $taken->dev_eui,
            'join_eui' => 'XYZ', 'app_key' => '', 'lat' => -10, 'reporting_hours' => 5,
        ]))->assertSessionHasErrors(['serial', 'meter_address', 'dev_eui', 'join_eui', 'app_key', 'lat', 'reporting_hours']);
    }

    public function test_assigning_to_a_client_copies_the_account(): void
    {
        $this->seed(MeterSeeder::class);
        $client = Meter::whereNotNull('client_id')->first();

        $this->actingAs(User::factory()->role(Role::Admin)->create())
            ->post('/meters', $this->valid(['client_id' => $client->client_id, 'vending_party' => 'owner']))->assertSessionHasNoErrors();

        $m = Meter::firstWhere('serial', 'WM-300001');
        $this->assertSame([$client->client_name, $client->kyc, 'owner', $client->client_name], [$m->client_name, $m->kyc, $m->vending_party, $m->occupant]);
    }

    public function test_edit_keeps_the_app_key_when_blank_and_can_decommission(): void
    {
        $user = User::factory()->role(Role::Ops)->create();
        $this->actingAs($user)->post('/meters', $this->valid());

        $this->put('/meters/WM-300001', $this->valid(['app_key' => '', 'decommissioned' => true]))->assertSessionHasNoErrors();
        $m = Meter::firstWhere('serial', 'WM-300001');
        $this->assertSame(str_repeat('A1', 16), $m->app_key);
        $this->assertSame('decommissioned', $m->network_status);
        $this->get('/meters/WM-300001?edit=1')->assertInertia(fn (Assert $p) => $p->where('form.meter.decommissioned', true));
    }

    public function test_finance_and_vendors_cannot_register_meters(): void
    {
        foreach ([Role::Finance, Role::Vendor] as $role) {
            $this->actingAs(User::factory()->role($role)->create())->post('/meters', $this->valid())->assertForbidden();
        }
    }
}
