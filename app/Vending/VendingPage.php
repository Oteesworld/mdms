<?php

namespace App\Vending;

use App\Models\Meter;
use App\Models\VendingValidation;

/** Data for the Vending screen: the validation log, sample meters and the API's state. */
class VendingPage
{
    public function __construct(private MeterValidator $validator) {}

    public function props(): array
    {
        $log = VendingValidation::query()->latest('id')->limit(60)->get();

        return [
            'log' => $log->map(fn (VendingValidation $v) => self::entry($v)),
            'stats' => [
                'checks' => VendingValidation::count(),
                'approved' => VendingValidation::where('result', 'APPROVED')->count(),
            ],
            'samples' => Meter::query()->orderBy('id')->limit(12)->pluck('serial')
                ->filter(fn ($s) => $this->validator->validate(['meter' => $s])['result'] === 'APPROVED')->values()->take(6),
            'rules' => (new ValidationRules)->toArray(),
            'api' => ['configured' => filled(config('mdms.vending_api_key')), 'path' => '/api/vending/validate'],
            'example' => $this->validator->validate(['meter' => 'WM-104091', 'purchaser' => 'occupant', 'amount' => 100, 'vendorRef' => 'OM-88213']),
        ];
    }

    /** A log row as the front end shows it. */
    public static function entry(VendingValidation $v): array
    {
        return [
            'id' => 'VAL-'.str_pad((string) $v->id, 6, '0', STR_PAD_LEFT),
            't' => $v->created_at->format('H:i:s'),
            'date' => $v->created_at->toDateString(),
            'vendor' => $v->vendor ?? 'Vending system',
            'meter' => $v->meter,
            'amount' => $v->amount,
            'source' => $v->source,
            'res' => $v->response,
        ];
    }
}
