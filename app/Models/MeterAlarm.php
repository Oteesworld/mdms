<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MeterAlarm extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['raised_at' => 'datetime', 'cleared_at' => 'datetime'];
    }
}
