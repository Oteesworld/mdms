<?php

use App\Http\Controllers\Api\LorawanUplinkController;
use App\Http\Controllers\Api\VendingValidationController;
use Illuminate\Support\Facades\Route;

// Called by the external vending system before it issues an STS token.
Route::post('/vending/validate', [VendingValidationController::class, 'validate'])->middleware('throttle:600,1');
Route::get('/vending/validate', [VendingValidationController::class, 'health']);

// Uplinks and joins forwarded by the LoRaWAN network server (ChirpStack or The Things Stack).
Route::post('/lorawan/uplink', LorawanUplinkController::class)->middleware('throttle:1200,1');
