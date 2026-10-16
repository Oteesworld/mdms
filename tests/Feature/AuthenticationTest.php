<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_guests_are_sent_to_sign_in(): void
    {
        $this->get('/dash')->assertRedirect('/login');
        $this->get('/login')->assertOk()->assertInertia(fn (Assert $p) => $p->component('auth/Login')->where('demo', null));
    }

    public function test_active_user_signs_in_and_lands_on_their_role_home(): void
    {
        $user = User::factory()->role(Role::Field)->create(['password' => 'secret-pass-1']);

        $this->post('/login', ['email' => $user->email, 'password' => 'secret-pass-1'])->assertRedirect('/');
        $this->assertAuthenticatedAs($user);
        $this->get('/')->assertRedirect('/map');
        $this->assertNotNull($user->fresh()->last_seen_at);
    }

    public function test_wrong_password_is_rejected(): void
    {
        $user = User::factory()->create(['password' => 'secret-pass-1']);

        $this->post('/login', ['email' => $user->email, 'password' => 'nope'])->assertSessionHasErrors('email');
        $this->assertGuest();
    }

    public function test_suspended_and_pending_users_cannot_sign_in(): void
    {
        $suspended = User::factory()->status(UserStatus::Suspended)->create(['password' => 'secret-pass-1']);
        $pending = User::factory()->status(UserStatus::Pending)->create(['password' => 'secret-pass-1']);

        $this->post('/login', ['email' => $suspended->email, 'password' => 'secret-pass-1'])
            ->assertSessionHasErrors(['email' => 'This account is suspended. Ask an administrator to reactivate it.']);
        $this->post('/login', ['email' => $pending->email, 'password' => 'secret-pass-1'])->assertSessionHasErrors('email');
        $this->assertGuest();
    }

    public function test_a_user_suspended_mid_session_is_signed_out(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user)->get('/dash')->assertOk();

        $user->update(['status' => UserStatus::Suspended]);
        $this->actingAs($user->fresh())->get('/dash')->assertRedirect('/login');
        $this->assertGuest();
    }

    public function test_demo_accounts_are_listed_only_in_demo_mode(): void
    {
        config(['mdms.demo' => true]);
        User::factory()->create(['name' => 'Demo Person']);

        $this->get('/login')->assertInertia(fn (Assert $p) => $p->where('demo.accounts.0.name', 'Demo Person'));
    }

    public function test_sign_in_is_rate_limited(): void
    {
        $user = User::factory()->create(['password' => 'secret-pass-1']);
        foreach (range(1, 5) as $_) {
            $this->post('/login', ['email' => $user->email, 'password' => 'nope']);
        }

        $this->post('/login', ['email' => $user->email, 'password' => 'secret-pass-1'])->assertStatus(429);
    }
}
