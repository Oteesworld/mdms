<?php

namespace Database\Seeders;

use App\Models\Meter;
use App\Models\VendingValidation;
use App\Vending\MeterValidator;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

/** A morning's worth of calls from the vending system, run through the real rules. */
class VendingLogSeeder extends Seeder
{
    private const VENDORS = ['Orange Money', 'MyZaka', 'CBD counter', 'Portal card', 'Block 8 kiosk'];

    public function run(MeterValidator $validator): void
    {
        if (VendingValidation::exists()) {
            return;
        }
        mt_srand(5150);
        $good = Meter::orderBy('id')->limit(40)->pluck('serial')
            ->filter(fn ($s) => $validator->validate(['meter' => $s])['result'] === 'APPROVED')->values();
        $bad = ['WM-104273', 'WM-104455', 'WM-104028', 'WM-999120', 'WM-10488'];
        $now = Carbon::now();

        for ($i = 13; $i >= 0; $i--) {
            $meter = $i % 5 === 3 ? $bad[intdiv($i, 5)] : $good[mt_rand(0, $good->count() - 1)];
            $amount = [50, 100, 100, 200, 500][mt_rand(0, 4)];
            Carbon::setTestNow($now->copy()->subSeconds($i * 420 + mt_rand(0, 360)));
            $validator->validateAndLog(['meter' => $meter, 'amount' => $amount, 'vendorRef' => 'SEED-'.$i], 'API', null, self::VENDORS[mt_rand(0, 4)]);
        }
        Carbon::setTestNow();
    }
}
