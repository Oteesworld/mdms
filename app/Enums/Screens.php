<?php

namespace App\Enums;

/** Screen keys of the single-page app; each is served at /{screen}. */
final class Screens
{
    public const ALL = [
        'dash', 'map', 'reports',
        'mdm', 'vee', 'vending',
        'operations', 'network', 'gateways', 'sites',
        'domestic', 'business', 'gov',
        'meters', 'bulk',
        'portal', 'settings', 'account',
    ];
}
