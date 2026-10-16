<?php

namespace App\Providers;

use App\Actions\Fortify\ResetUserPassword;
use App\Actions\Fortify\UpdateUserPassword;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Auth\Events\Login;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Laravel\Fortify\Actions\RedirectIfTwoFactorAuthenticatable;
use Laravel\Fortify\Features;
use Laravel\Fortify\Fortify;

class FortifyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        Fortify::updateUserPasswordsUsing(UpdateUserPassword::class);
        Fortify::resetUserPasswordsUsing(ResetUserPassword::class);
        Fortify::redirectUserForTwoFactorAuthenticationUsing(RedirectIfTwoFactorAuthenticatable::class);

        // Check the password first, then refuse accounts that are suspended or not yet activated.
        Fortify::authenticateUsing(function (Request $request) {
            $user = User::where('email', Str::lower($request->input('email')))->first();
            if (! $user || ! Hash::check((string) $request->input('password'), $user->password)) {
                return null;
            }
            $blocked = match ($user->status) {
                UserStatus::Suspended => 'This account is suspended. Ask an administrator to reactivate it.',
                UserStatus::Pending => 'This account is not active yet. Use the link in your invitation email to set a password.',
                default => null,
            };
            if ($blocked) {
                throw ValidationException::withMessages([Fortify::username() => $blocked]);
            }

            return $user;
        });

        Event::listen(Login::class, fn (Login $e) => $e->user instanceof User && $e->user->forceFill(['last_seen_at' => now()])->saveQuietly());

        $this->views();

        RateLimiter::for('login', function (Request $request) {
            $throttleKey = Str::transliterate(Str::lower($request->input(Fortify::username())).'|'.$request->ip());

            return Limit::perMinute(5)->by($throttleKey);
        });

        RateLimiter::for('two-factor', function (Request $request) {
            return Limit::perMinute(5)->by($request->session()->get('login.id'));
        });
    }

    /** Fortify's pages are rendered by the React front end through Inertia. */
    private function views(): void
    {
        Fortify::loginView(fn (Request $request) => Inertia::render('auth/Login', [
            'status' => $request->session()->get('status'),
            'canResetPassword' => Features::enabled(Features::resetPasswords()),
            'demo' => config('mdms.demo') ? [
                'password' => config('mdms.demo_password'),
                'accounts' => User::query()->orderBy('id')->limit(8)->get()->map(fn (User $u) => [
                    'name' => $u->name, 'email' => $u->email, 'role' => $u->role->value, 'status' => $u->status->value,
                ]),
            ] : null,
        ]));

        Fortify::requestPasswordResetLinkView(fn (Request $request) => Inertia::render('auth/ForgotPassword', [
            'status' => $request->session()->get('status'),
        ]));

        Fortify::resetPasswordView(fn (Request $request) => Inertia::render('auth/ResetPassword', [
            'email' => (string) $request->query('email', ''),
            'token' => $request->route('token'),
            'invite' => $request->boolean('invite'),
        ]));

        Fortify::twoFactorChallengeView(fn () => Inertia::render('auth/TwoFactorChallenge'));

        Fortify::confirmPasswordView(fn () => Inertia::render('auth/ConfirmPassword'));
    }
}
