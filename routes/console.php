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

Artisan::command('mdms:redecode {--meter=}', function (App\Lorawan\KalahariDecoder $decoder, App\Lorawan\UplinkIngestor $ingestor) {
    $q = App\Models\Uplink::query()->whereIn('decode_status', ['undecoded', 'error'])->whereNotNull('meter_id')->whereNotNull('payload_hex')->orderBy('received_at');
    if ($serial = $this->option('meter')) {
        $q->whereHas('meter', fn ($m) => $m->where('serial', strtoupper($serial)));
    }
    $done = 0;
    $q->each(function (App\Models\Uplink $u) use ($decoder, $ingestor, &$done) {
        try {
            $decoded = $decoder->decodeBytes((int) $u->f_port, hex2bin($u->payload_hex), $u->received_at);
        } catch (App\Lorawan\DecodeException $e) {
            $u->update(['decode_status' => 'error', 'decode_error' => substr($e->getMessage(), 0, 250)]);

            return;
        }
        if ($decoded === null) {
            return;
        }
        $u->update(['decode_status' => 'decoded', 'decode_error' => null, 'records' => count($decoded['records']), 'decoded' => $decoded]);
        $ingestor->apply($u->meter, $u, $decoded, $u->received_at);
        $done++;
    });
    $this->info("Decoded {$done} stored uplink(s).");
})->purpose('Decode stored uplinks again, e.g. after implementing the Kalahari protocol decoder');
