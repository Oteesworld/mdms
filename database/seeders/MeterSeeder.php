<?php

namespace Database\Seeders;

use App\Metering\MeterAddress;
use App\Models\Meter;
use Illuminate\Database\Seeder;

/**
 * Demo client meters from database/data/meters.json (regenerate with `npm run fixtures`).
 * Only adds meters that aren't there yet, so re-running it on deploy never overwrites edits.
 */
class MeterSeeder extends Seeder
{
    public function run(): void
    {
        $rows = json_decode(file_get_contents(database_path('data/meters.json')), true, flags: JSON_THROW_ON_ERROR);
        $now = now();
        Meter::insertOrIgnore(
            array_map(fn ($r) => [
                ...$r,
                // 028826 + the serial's six digits + Luhn check digit, like the address on the meter label.
                'meter_address' => MeterAddress::withCheckDigit('028826'.substr($r['serial'], 3)),
                'model' => config('kalahari.model'),
                'join_eui' => '70B3D57ED00A0000',
                'network_status' => 'reporting',
                'reporting_hours' => 6,
                'sts_sgc' => $r['type'] === 'business' ? '600742' : '600741',
                'sts_ti' => $r['type'] === 'business' ? '02' : '01',
                'valve' => $r['online'] ? 'open' : 'unknown',
                'created_at' => $now,
                'updated_at' => $now,
            ], $rows),
        );
    }
}
