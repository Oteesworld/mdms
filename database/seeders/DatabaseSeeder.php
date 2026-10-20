<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Demo mode seeds sample meters, staff, a vending log and two weeks of simulated
     * uplinks. A live server starts empty: register meters on the Meters screen.
     */
    public function run(): void
    {
        if (config('mdms.demo')) {
            $this->call([MeterSeeder::class, VendingLogSeeder::class, DemoUserSeeder::class, DemoTelemetrySeeder::class]);

            return;
        }
        $this->command?->info('Live mode: nothing to seed. Create the first administrator with `php artisan mdms:create-admin`.');
    }
}
