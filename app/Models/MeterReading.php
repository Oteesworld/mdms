<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One hourly freeze record from the meter. */
class MeterReading extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'read_at' => 'datetime',
            'total_forward' => 'float', 'flow_forward' => 'float', 'rtu_voltage' => 'float', 'meter_voltage' => 'float',
            'temperature' => 'float', 'consumption' => 'float', 'total_reverse' => 'float', 'flow_reverse' => 'float', 'remaining' => 'float',
        ];
    }
}
