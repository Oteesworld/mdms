<?php

namespace App\Models;

use App\Enums\Role;
use App\Enums\UserStatus;
use App\Notifications\Invitation;
use App\Notifications\ResetPassword;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Password;
use Laravel\Fortify\TwoFactorAuthenticatable;

#[Fillable(['name', 'email', 'password', 'role', 'title', 'scope', 'status'])]
#[Hidden(['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable, TwoFactorAuthenticatable;

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'two_factor_confirmed_at' => 'datetime',
            'password' => 'hashed',
            'role' => Role::class,
            'status' => UserStatus::class,
        ];
    }

    /** Short handle used in audit trails and the command queue, e.g. "l.kgosi". */
    public function handle(): string
    {
        return strtolower(strstr($this->email, '@', true) ?: $this->email);
    }

    public function canOpen(string $screen): bool
    {
        return $this->role->can($screen);
    }

    public function isAdmin(): bool
    {
        return $this->role === Role::Admin;
    }

    /** Email a link to set their first password. Uses the password-reset broker, so the link expires the same way. */
    public function sendInvitation(): void
    {
        $this->notify(new Invitation(Password::broker()->createToken($this)));
    }

    public function sendPasswordResetNotification($token): void
    {
        $this->notify(new ResetPassword($token));
    }
}
