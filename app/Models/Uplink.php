<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A LoRaWAN frame (or join) as received from the network server, kept so it can be decoded again later. */
class Uplink extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['decoded' => 'array', 'received_at' => 'datetime', 'snr' => 'float'];
    }

    public function meter(): BelongsTo
    {
        return $this->belongsTo(Meter::class);
    }
}
