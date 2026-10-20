<?php

namespace Database\Seeders;

use App\Metering\MeterSimulator;
use App\Models\Meter;
use Illuminate\Database\Seeder;

/**
 * Two weeks of simulated uplinks for the demo meters, sent through the ingestion pipeline.
 * Meters the fixtures show as offline stop reporting when they went silent.
 */
class DemoTelemetrySeeder extends Seeder
{
    public function run(MeterSimulator $sim): void
    {
        $now = now()->subMinutes(5);
        foreach (Meter::whereNull('last_uplink_at')->orderBy('id')->get() as $meter) {
            $end = $meter->online ? $now : $now->copy()->subDays(max(1, $meter->offline_days))->subHours(3);
            $sim->run($meter, $end->copy()->subDays(14), $end);
        }
    }
}
