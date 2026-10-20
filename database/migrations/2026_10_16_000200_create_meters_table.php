<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** Client meters and the account and device state the vending validation checks. */
    public function up(): void
    {
        Schema::create('meters', function (Blueprint $table) {
            $table->id();
            $table->string('serial', 16)->unique();
            $table->string('dev_eui', 16);
            $table->string('plot');
            $table->string('client_id', 20)->index();
            $table->string('client_name');
            $table->string('type', 16);
            $table->string('owner');
            $table->string('occupant');
            /** Who may buy against the meter: occupant, owner or none. */
            $table->string('vending_party', 16);
            $table->string('kyc', 16);
            $table->string('account_status', 16);
            $table->decimal('balance', 10, 2)->default(0);
            $table->boolean('online')->default(true);
            $table->string('last_seen')->default('');
            $table->unsignedSmallInteger('offline_days')->default(0);
            $table->unsignedTinyInteger('battery_pct')->default(100);
            $table->boolean('tamper')->default(false);
            $table->timestamps();
        });

        Schema::create('vending_validations', function (Blueprint $table) {
            $table->id();
            $table->string('meter', 32)->index();
            $table->string('result', 10);
            $table->string('code', 32);
            $table->string('source', 10);
            $table->string('vendor', 40)->nullable();
            $table->decimal('amount', 10, 2)->nullable();
            $table->string('vendor_ref', 64)->nullable();
            $table->json('response');
            $table->timestamp('created_at')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vending_validations');
        Schema::dropIfExists('meters');
    }
};
