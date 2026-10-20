<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Kalahari Ultrasonic meter identity, LoRaWAN keys, installation details and the latest
     * decoded values. Account columns become optional so a meter can be registered as stock
     * before it is assigned to a customer.
     */
    public function up(): void
    {
        Schema::table('meters', function (Blueprint $table) {
            $table->string('plot')->nullable()->change();
            $table->string('client_id', 20)->nullable()->change();
            $table->string('client_name')->nullable()->change();
            $table->string('type', 16)->default('domestic')->change();
            $table->string('owner')->nullable()->change();
            $table->string('occupant')->nullable()->change();
            $table->string('vending_party', 16)->default('none')->change();
            $table->string('kyc', 16)->default('Pending')->change();
            $table->string('account_status', 16)->default('Active')->change();

            // Identity: the 13-digit Meter Address is the STS meter number (DRN) and the CIU binding address.
            $table->string('meter_address', 13)->nullable()->unique()->after('serial');
            $table->string('model')->default('Kalahari Ultrasonic DN15')->after('meter_address');
            $table->string('firmware', 32)->nullable()->after('model');

            // LoRaWAN (OTAA).
            $table->string('join_eui', 16)->nullable()->after('dev_eui');
            $table->text('app_key')->nullable()->after('join_eui');
            $table->string('lorawan_region', 12)->default('EU868')->after('app_key');
            $table->char('device_class', 1)->default('A')->after('lorawan_region');
            /** registered → joined → reporting; or decommissioned. */
            $table->string('network_status', 16)->default('reporting')->after('device_class');
            $table->unsignedTinyInteger('reporting_hours')->default(24)->after('network_status');
            $table->unsignedSmallInteger('sampling_minutes')->default(60)->after('reporting_hours');

            // STS prepayment parameters.
            $table->string('sts_sgc', 6)->default('600741');
            $table->unsignedTinyInteger('sts_krn')->default(2);
            $table->string('sts_ti', 2)->default('01');

            // Installation.
            $table->string('suburb')->nullable();
            $table->decimal('lat', 9, 6)->nullable();
            $table->decimal('lng', 9, 6)->nullable();
            $table->date('installed_at')->nullable();
            $table->decimal('initial_reading', 12, 3)->default(0);
            $table->string('seal_no', 32)->nullable();
            $table->json('commissioning')->nullable();
            $table->foreignId('registered_by')->nullable()->constrained('users')->nullOnDelete();

            // Latest decoded state (denormalised for the register and validation).
            $table->timestamp('joined_at')->nullable();
            $table->timestamp('last_uplink_at')->nullable();
            $table->unsignedInteger('last_fcnt')->nullable();
            $table->smallInteger('last_rssi')->nullable();
            $table->decimal('last_snr', 5, 1)->nullable();
            $table->string('last_gateway', 32)->nullable();
            $table->decimal('total_m3', 12, 3)->nullable();
            $table->decimal('remaining_m3', 10, 3)->nullable();
            $table->decimal('flow_m3h', 8, 3)->nullable();
            $table->decimal('battery_v', 4, 2)->nullable();
            $table->decimal('temperature_c', 5, 1)->nullable();
            $table->unsignedSmallInteger('status_code')->nullable();
            $table->string('valve', 8)->default('unknown');
        });

        Schema::create('uplinks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('meter_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('dev_eui', 16)->index();
            /** up | join */
            $table->string('event', 8)->default('up');
            $table->unsignedInteger('f_cnt')->nullable();
            $table->unsignedTinyInteger('f_port')->nullable();
            $table->text('payload_hex')->nullable();
            $table->smallInteger('rssi')->nullable();
            $table->decimal('snr', 5, 1)->nullable();
            $table->string('gateway_id', 32)->nullable();
            $table->unsignedInteger('frequency')->nullable();
            $table->string('data_rate', 16)->nullable();
            /** chirpstack | ttn | simulated */
            $table->string('source', 12);
            /** decoded | undecoded | unknown_device | error | join */
            $table->string('decode_status', 16);
            $table->string('decode_error')->nullable();
            $table->unsignedSmallInteger('records')->default(0);
            $table->json('decoded')->nullable();
            $table->timestamp('received_at')->index();
            $table->timestamps();
        });

        // One row per hourly freeze, as the meter stores it (manual §6).
        Schema::create('meter_readings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('meter_id')->constrained()->cascadeOnDelete();
            $table->foreignId('uplink_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('read_at');
            $table->decimal('total_forward', 12, 3);
            $table->decimal('flow_forward', 8, 3)->default(0);
            $table->decimal('rtu_voltage', 4, 2)->nullable();
            $table->decimal('meter_voltage', 4, 2)->nullable();
            $table->decimal('temperature', 5, 1)->nullable();
            $table->unsignedSmallInteger('status')->nullable();
            $table->decimal('consumption', 10, 3)->default(0);
            $table->decimal('total_reverse', 12, 3)->default(0);
            $table->decimal('flow_reverse', 8, 3)->default(0);
            $table->decimal('remaining', 10, 3)->nullable();
            $table->unique(['meter_id', 'read_at']);
        });

        Schema::create('meter_alarms', function (Blueprint $table) {
            $table->id();
            $table->foreignId('meter_id')->constrained()->cascadeOnDelete();
            $table->string('type', 24);
            /** meter = reported by the device; platform = derived from the readings. */
            $table->string('source', 10);
            $table->string('detail');
            $table->timestamp('raised_at');
            $table->timestamp('cleared_at')->nullable();
            $table->index(['meter_id', 'cleared_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('meter_alarms');
        Schema::dropIfExists('meter_readings');
        Schema::dropIfExists('uplinks');
        Schema::table('meters', function (Blueprint $table) {
            $table->dropConstrainedForeignId('registered_by');
            $table->dropUnique(['meter_address']);
            $table->dropColumn([
                'meter_address', 'model', 'firmware', 'join_eui', 'app_key', 'lorawan_region', 'device_class', 'network_status',
                'reporting_hours', 'sampling_minutes', 'sts_sgc', 'sts_krn', 'sts_ti', 'suburb', 'lat', 'lng', 'installed_at',
                'initial_reading', 'seal_no', 'commissioning', 'joined_at', 'last_uplink_at', 'last_fcnt', 'last_rssi', 'last_snr',
                'last_gateway', 'total_m3', 'remaining_m3', 'flow_m3h', 'battery_v', 'temperature_c', 'status_code', 'valve',
            ]);
        });
    }
};
