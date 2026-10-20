<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\Screens;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class RoleAccessTest extends TestCase
{
    use RefreshDatabase;

    public function test_each_role_is_served_only_its_screens(): void
    {
        foreach (Role::cases() as $role) {
            $user = User::factory()->role($role)->create();
            foreach (Screens::ALL as $screen) {
                $res = $this->actingAs($user)->get('/'.$screen);
                if ($role->can($screen)) {
                    $res->assertOk()->assertInertia(fn (Assert $p) => $p->component('App')->where('screen', $screen));
                } else {
                    $res->assertRedirect('/'.$role->home());
                }
            }
        }
    }

    public function test_shared_props_carry_the_user_and_their_access(): void
    {
        $user = User::factory()->role(Role::Vendor)->create(['email' => 'n.seretse@wuc.co.bw']);

        $this->actingAs($user)->get('/vending')->assertInertia(fn (Assert $p) => $p
            ->where('auth.user.handle', 'n.seretse')
            ->where('auth.user.role', 'Vendor')
            ->where('auth.access', Role::Vendor->screens())
            ->missing('auth.user.password'));
    }

    public function test_unknown_screens_are_not_found(): void
    {
        $this->actingAs(User::factory()->create())->get('/nonsense')->assertNotFound();
    }

    public function test_only_admins_manage_users(): void
    {
        $ops = User::factory()->role(Role::Ops)->create();

        $this->actingAs($ops)->post('/settings/users', ['name' => 'X', 'email' => 'x@wuc.co.bw', 'role' => 'Admin'])->assertForbidden();
        $this->actingAs($ops)->put("/settings/users/{$ops->id}", ['name' => 'X', 'email' => $ops->email, 'role' => 'Admin', 'status' => 'Active'])->assertForbidden();
        $this->assertSame(Role::Ops, $ops->fresh()->role);
    }
}
