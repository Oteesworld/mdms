<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Enums\Screens;
use App\Metering\MeterPage;
use App\Models\Meter;
use App\Models\User;
use App\Vending\VendingPage;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** Serves the single-page app at /{screen}, with the data each screen needs from the server. */
class ScreenController extends Controller
{
    public function home(Request $request): RedirectResponse
    {
        return redirect('/'.$request->user()->role->home());
    }

    public function __invoke(Request $request, string $screen, ?string $param = null): Response|RedirectResponse
    {
        $user = $request->user();
        // Screens outside the role (e.g. a pasted link) send the user to their home screen.
        if (! $user->canOpen($screen)) {
            return redirect('/'.$user->role->home());
        }

        return Inertia::render('App', [
            'screen' => $screen,
            'param' => $param,
            ...match ($screen) {
                'meters' => $this->meters($request, $param),
                'vending' => app(VendingPage::class)->props(),
                'settings' => $this->settings(),
                default => [],
            },
        ]);
    }

    private function meters(Request $request, ?string $param): array
    {
        $page = app(MeterPage::class);
        if ($param === null) {
            return $page->register();
        }
        if ($param === 'new') {
            return $page->form();
        }
        $meter = Meter::where('serial', strtoupper($param))->firstOrFail();

        return $request->boolean('edit') ? [...$page->form($meter), 'serial' => $meter->serial] : $page->dashboard($meter);
    }

    private function settings(): array
    {
        return [
            'users' => User::query()->orderByRaw("case status when 'Active' then 0 when 'Pending' then 1 else 2 end")->orderBy('name')->get()
                ->map(fn (User $u) => [
                    'id' => $u->id, 'name' => $u->name, 'email' => $u->email, 'role' => $u->role->value, 'title' => $u->title,
                    'scope' => $u->scope, 'status' => $u->status->value, 'twoFactor' => $u->hasEnabledTwoFactorAuthentication(),
                    'seen' => $u->last_seen_at?->diffForHumans(short: true) ?? ($u->status->value === 'Pending' ? 'Invited' : 'Never'),
                ]),
            'roles' => collect(Role::cases())->map(fn (Role $r) => ['role' => $r->value, 'label' => $r->label(), 'screens' => $r->screens()]),
            'screens' => Screens::ALL,
        ];
    }
}
