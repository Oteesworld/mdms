<?php

namespace App\Http\Middleware;

use App\Enums\Role;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    protected $rootView = 'app';

    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /** @return array<string, mixed> */
    public function share(Request $request): array
    {
        $user = $request->user();

        return [
            ...parent::share($request),
            'auth' => [
                'user' => $user ? [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'handle' => $user->handle(),
                    'role' => $user->role->value,
                    'roleLabel' => $user->role->label(),
                    'title' => $user->title,
                    'scope' => $user->scope,
                    'twoFactor' => $user->hasEnabledTwoFactorAuthentication(),
                ] : null,
                'access' => $user ? $user->role->screens() : [],
            ],
            'flash' => [
                'status' => fn () => $request->session()->get('status'),
                'toast' => fn () => $request->session()->get('toast'),
            ],
        ];
    }
}
