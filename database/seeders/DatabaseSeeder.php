<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([MeterSeeder::class, VendingLogSeeder::class]);

        if (config('mdms.demo')) {
            $this->call(DemoUserSeeder::class);
        } else {
            $this->command?->info('Create the first administrator with: php artisan mdms:create-admin');
        }
    }
}
