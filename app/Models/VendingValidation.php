<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One validation request, from the vending system (API) or the in-app console/portal. */
class VendingValidation extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['response' => 'array', 'amount' => 'float', 'created_at' => 'datetime'];
    }
}
