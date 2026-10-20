<?php

use App\Enums\Screens;
use App\Http\Controllers\MeterController;
use App\Http\Controllers\ScreenController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\VendingCheckController;
use Illuminate\Support\Facades\Route;

// Sign-in, sign-out, password reset and two-factor routes come from Laravel Fortify.

Route::middleware(['auth', 'active'])->group(function () {
    Route::get('/', [ScreenController::class, 'home'])->name('home');

    Route::post('/vending/check', VendingCheckController::class)->name('vending.check');

    Route::middleware('can:manage-meters')->prefix('meters')->name('meters.')->group(function () {
        Route::post('/', [MeterController::class, 'store'])->name('store');
        Route::put('/{meter:serial}', [MeterController::class, 'update'])->name('update');
        Route::post('/{meter:serial}/simulate', [MeterController::class, 'simulate'])->name('simulate');
    });

    Route::middleware('can:manage-users')->prefix('settings/users')->name('users.')->group(function () {
        Route::post('/', [UserController::class, 'store'])->name('store');
        Route::put('/{user}', [UserController::class, 'update'])->name('update');
        Route::post('/{user}/invite', [UserController::class, 'resendInvite'])->name('invite');
    });

    // Every app screen, e.g. /dash, /map, /domestic/3. Role access is checked in the controller.
    Route::get('/{screen}/{param?}', ScreenController::class)
        ->whereIn('screen', Screens::ALL)
        ->where('param', '[A-Za-z0-9_-]+')
        ->name('screen');
});
