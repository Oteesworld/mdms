<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Settings → Users: administrators invite, edit and suspend staff accounts. */
class UserController extends Controller
{
    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            ...$this->rules(),
            'email' => ['required', 'string', 'email', 'max:255', Rule::unique('users')],
        ]);

        $user = User::create([
            ...$data,
            'email' => Str::lower($data['email']),
            // Unusable until they set their own through the invitation link.
            'password' => Str::random(40),
            'status' => UserStatus::Pending,
        ]);
        $user->sendInvitation();

        return back()->with('toast', "Invitation sent to {$user->email}");
    }

    public function update(Request $request, User $user): RedirectResponse
    {
        $data = $request->validate([
            ...$this->rules(),
            'email' => ['required', 'string', 'email', 'max:255', Rule::unique('users')->ignore($user)],
            'status' => ['required', Rule::enum(UserStatus::class)],
        ]);
        $data['email'] = Str::lower($data['email']);

        // Admins can't demote or suspend themselves, so there is always at least one active admin.
        $self = $request->user()->is($user);
        if ($self && ($data['role'] !== $user->role->value || $data['status'] !== $user->status->value)) {
            throw ValidationException::withMessages(['role' => 'You can’t change your own role or status. Ask another administrator.']);
        }
        if ($data['status'] === UserStatus::Pending->value && $user->status !== UserStatus::Pending) {
            throw ValidationException::withMessages(['status' => 'Only invited users who haven’t signed in yet can be pending.']);
        }
        $user->update($data);

        if ($user->status === UserStatus::Suspended) {
            // Sign them out everywhere straight away (database sessions).
            if (config('session.driver') === 'database') {
                DB::table(config('session.table', 'sessions'))->where('user_id', $user->id)->delete();
            }
            $user->forceFill(['remember_token' => Str::random(60)])->saveQuietly();
        }

        return back()->with('toast', "{$user->name} updated");
    }

    public function resendInvite(User $user): RedirectResponse
    {
        abort_unless($user->status === UserStatus::Pending, 422, 'This user has already activated their account.');
        $user->sendInvitation();

        return back()->with('toast', "Invitation re-sent to {$user->email}");
    }

    private function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'role' => ['required', Rule::enum(Role::class)],
            'title' => ['nullable', 'string', 'max:120'],
            'scope' => ['nullable', 'string', 'max:120'],
        ];
    }
}
