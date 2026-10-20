<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Fortify\Contracts\TwoFactorAuthenticationProvider;
use Tests\TestCase;

class TwoFactorTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_turns_on_two_factor_and_is_challenged_at_sign_in(): void
    {
        $user = User::factory()->create(['password' => 'secret-pass-1']);
        $json = ['Accept' => 'application/json'];

        // Changing two-factor settings needs a recent password confirmation.
        $this->actingAs($user)->postJson('/user/two-factor-authentication')->assertStatus(423);
        $this->postJson('/user/confirm-password', ['password' => 'secret-pass-1'])->assertCreated();
        $this->postJson('/user/two-factor-authentication')->assertOk();
        $this->getJson('/user/two-factor-qr-code')->assertOk()->assertJsonStructure(['svg', 'url']);

        $secret = decrypt($user->fresh()->two_factor_secret);
        $code = app(\PragmaRX\Google2FA\Google2FA::class)->getCurrentOtp($secret);
        $this->postJson('/user/confirmed-two-factor-authentication', ['code' => '000000'], $json)->assertStatus(422);
        $this->postJson('/user/confirmed-two-factor-authentication', ['code' => $code], $json)->assertOk();
        $this->assertTrue($user->fresh()->hasEnabledTwoFactorAuthentication());
        $this->assertCount(8, $this->getJson('/user/two-factor-recovery-codes')->json());

        auth()->logout();
        $this->post('/login', ['email' => $user->email, 'password' => 'secret-pass-1'])->assertRedirect('/two-factor-challenge');
        $this->assertGuest();
        $this->get('/two-factor-challenge')->assertOk();

        $recovery = $user->fresh()->recoveryCodes()[0];
        $this->post('/two-factor-challenge', ['recovery_code' => $recovery])->assertRedirect('/');
        $this->assertAuthenticatedAs($user);
        $this->assertNotContains($recovery, $user->fresh()->recoveryCodes());
    }

    public function test_the_challenge_rejects_a_wrong_code(): void
    {
        $user = User::factory()->create(['password' => 'secret-pass-1']);
        $user->forceFill([
            'two_factor_secret' => encrypt(app(TwoFactorAuthenticationProvider::class)->generateSecretKey()),
            'two_factor_recovery_codes' => encrypt(json_encode(['aaaa-bbbb'])),
            'two_factor_confirmed_at' => now(),
        ])->save();

        $this->post('/login', ['email' => $user->email, 'password' => 'secret-pass-1'])->assertRedirect('/two-factor-challenge');
        $this->post('/two-factor-challenge', ['code' => '123456'])->assertRedirect('/two-factor-challenge');
        $this->assertGuest();
    }
}
