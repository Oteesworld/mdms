<?php

namespace App\Enums;

enum Role: string
{
    case Admin = 'Admin';
    case Ops = 'Ops';
    case Finance = 'Finance';
    case Vendor = 'Vendor';
    case Field = 'Field';

    /** Screens this role may open; the first is where the role lands after signing in. */
    public function screens(): array
    {
        return match ($this) {
            self::Admin => Screens::ALL,
            self::Ops => ['dash', 'map', 'reports', 'mdm', 'vee', 'vending', 'network', 'gateways', 'sites', 'operations', 'domestic', 'business', 'gov', 'meters', 'bulk', 'portal', 'account'],
            self::Finance => ['dash', 'reports', 'vending', 'mdm', 'vee', 'domestic', 'business', 'gov', 'portal', 'account'],
            self::Vendor => ['domestic', 'business', 'vending', 'portal', 'account'],
            self::Field => ['map', 'operations', 'meters', 'bulk', 'network', 'gateways', 'sites', 'account'],
        };
    }

    public function can(string $screen): bool
    {
        return in_array($screen, $this->screens(), true);
    }

    public function home(): string
    {
        return $this->screens()[0];
    }

    public function label(): string
    {
        return match ($this) {
            self::Admin => 'Administrator',
            self::Ops => 'Operations',
            self::Finance => 'Finance',
            self::Vendor => 'Vendor agent',
            self::Field => 'Field',
        };
    }
}
