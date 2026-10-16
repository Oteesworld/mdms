<?php

namespace Database\Seeders;

use App\Enums\Role;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Database\Seeder;

/** Sample staff accounts, one per role plus a suspended one. Only seeded when MDMS_DEMO=true. */
class DemoUserSeeder extends Seeder
{
    public function run(): void
    {
        $accounts = [
            ['Leeroy Kgosi', 'l.kgosi@amplifiediot.co.bw', Role::Admin, 'Network administrator', 'All zones', UserStatus::Active],
            ['Kefilwe Ramotswe', 'k.ramotswe@wuc.co.bw', Role::Ops, 'Operations controller', 'All zones', UserStatus::Active],
            ['Tebogo Phiri', 't.phiri@wuc.co.bw', Role::Finance, 'Finance controller', 'All zones', UserStatus::Active],
            ['Naledi Seretse', 'n.seretse@wuc.co.bw', Role::Vendor, 'Vendor agent · CBD counter', 'CBD counter', UserStatus::Active],
            ['Kabelo Moloi', 'k.moloi@wuc.co.bw', Role::Field, 'Field supervisor', 'Gaborone', UserStatus::Active],
            ['Amogelang Dube', 'a.dube@wuc.co.bw', Role::Field, 'Field technician', 'Old Naledi', UserStatus::Suspended],
        ];
        foreach ($accounts as [$name, $email, $role, $title, $scope, $status]) {
            User::updateOrCreate(['email' => $email], [
                'name' => $name, 'role' => $role, 'title' => $title, 'scope' => $scope, 'status' => $status,
                'password' => config('mdms.demo_password'), 'email_verified_at' => now(),
            ]);
        }
    }
}
