<?php

namespace Database\Seeders;

use App\Models\Meter;
use Illuminate\Database\Seeder;

/** Client meters from database/data/meters.json (regenerate with `npm run fixtures`). */
class MeterSeeder extends Seeder
{
    public function run(): void
    {
        $rows = json_decode(file_get_contents(database_path('data/meters.json')), true, flags: JSON_THROW_ON_ERROR);
        $now = now();
        Meter::upsert(
            array_map(fn ($r) => [...$r, 'created_at' => $now, 'updated_at' => $now], $rows),
            ['serial'],
        );
    }
}
