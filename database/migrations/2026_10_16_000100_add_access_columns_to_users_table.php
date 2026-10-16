<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('role', 16)->default('Finance')->after('email');
            $table->string('title')->nullable()->after('role');
            $table->string('scope')->nullable()->after('title');
            $table->string('status', 16)->default('Pending')->after('scope');
            $table->timestamp('last_seen_at')->nullable()->after('remember_token');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['role', 'title', 'scope', 'status', 'last_seen_at']);
        });
    }
};
