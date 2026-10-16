<?php

use App\Enums\Role;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

use function Laravel\Prompts\password;
use function Laravel\Prompts\text;

Artisan::command('mdms:create-admin {--name=} {--email=}', function () {
    $name = $this->option('name') ?: text('Name', required: true);
    $email = Str::lower($this->option('email') ?: text('Email', required: true));
    $pass = password('Password', required: true, hint: 'At least 10 characters with upper and lower case letters and a number.');

    $v = Validator::make(['email' => $email, 'password' => $pass], [
        'email' => ['email', 'unique:users,email'],
        'password' => [Password::defaults()],
    ]);
    if ($v->fails()) {
        foreach ($v->errors()->all() as $e) {
            $this->error($e);
        }

        return 1;
    }

    User::create([
        'name' => $name, 'email' => $email, 'password' => $pass,
        'role' => Role::Admin, 'title' => 'Administrator', 'scope' => 'All zones', 'status' => UserStatus::Active,
    ]);
    $this->info("Administrator {$email} created. Sign in and invite everyone else from Settings → Users.");
})->purpose('Create an administrator account');
