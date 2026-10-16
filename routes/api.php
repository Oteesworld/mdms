<?php

use App\Http\Controllers\Api\VendingValidationController;
use Illuminate\Support\Facades\Route;

// Called by the external vending system before it issues an STS token.
Route::post('/vending/validate', [VendingValidationController::class, 'validate'])->middleware('throttle:600,1');
Route::get('/vending/validate', [VendingValidationController::class, 'health']);
