<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Enums\UserStatus;
use App\Models\User;
use App\Notifications\Invitation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class UserManagementTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->role(Role::Admin)->create();
    }

    public function test_admin_invites_a_user_who_activates_by_setting_a_password(): void
    {
        Notification::fake();
        $this->actingAs($this->admin())->post('/settings/users', [
            'name' => 'Mpho Tau', 'email' => 'M.Tau@wuc.co.bw', 'role' => 'Finance', 'title' => 'Revenue analyst', 'scope' => 'Gaborone',
        ])->assertSessionHas('toast', 'Invitation sent to m.tau@wuc.co.bw');

        $invited = User::firstWhere('email', 'm.tau@wuc.co.bw');
        $this->assertSame(UserStatus::Pending, $invited->status);

        $token = null;
        Notification::assertSentTo($invited, Invitation::class, function (Invitation $n) use (&$token) {
            $token = $n->token;

            return true;
        });

        auth()->logout();
        $this->post('/reset-password', [
            'token' => $token, 'email' => 'm.tau@wuc.co.bw', 'password' => 'Tau-Water-2026', 'password_confirmation' => 'Tau-Water-2026',
        ])->assertRedirect('/login');
        $this->assertSame(UserStatus::Active, $invited->fresh()->status);

        $this->post('/login', ['email' => 'm.tau@wuc.co.bw', 'password' => 'Tau-Water-2026']);
        $this->assertAuthenticatedAs($invited->fresh());
    }

    public function test_invite_rejects_a_taken_email_and_bad_role(): void
    {
        $other = User::factory()->create();

        $this->actingAs($this->admin())->post('/settings/users', ['name' => 'X', 'email' => $other->email, 'role' => 'Boss'])
            ->assertSessionHasErrors(['email', 'role']);
    }

    public function test_admin_suspends_a_user(): void
    {
        $user = User::factory()->role(Role::Field)->create();

        $this->actingAs($this->admin())->put("/settings/users/{$user->id}", [
            'name' => $user->name, 'email' => $user->email, 'role' => 'Field', 'status' => 'Suspended',
        ])->assertSessionHasNoErrors();

        $this->assertSame(UserStatus::Suspended, $user->fresh()->status);
    }

    public function test_admin_cannot_change_their_own_role_or_status(): void
    {
        $admin = $this->admin();
        User::factory()->role(Role::Admin)->create();

        $this->actingAs($admin)->put("/settings/users/{$admin->id}", [
            'name' => $admin->name, 'email' => $admin->email, 'role' => 'Ops', 'status' => 'Active',
        ])->assertSessionHasErrors('role');
        $this->assertSame(Role::Admin, $admin->fresh()->role);
    }

    public function test_resend_invite_only_for_pending_users(): void
    {
        Notification::fake();
        $admin = $this->admin();
        $pending = User::factory()->status(UserStatus::Pending)->create();

        $this->actingAs($admin)->post("/settings/users/{$pending->id}/invite")->assertRedirect();
        Notification::assertSentTo($pending, Invitation::class);
        $this->actingAs($admin)->post("/settings/users/{$admin->id}/invite")->assertStatus(422);
    }
}
