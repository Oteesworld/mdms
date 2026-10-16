<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Meter extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'balance' => 'float',
            'online' => 'boolean',
            'tamper' => 'boolean',
            'offline_days' => 'integer',
            'battery_pct' => 'integer',
        ];
    }
}
