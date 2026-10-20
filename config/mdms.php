<?php

return [
    /*
     * Demo mode seeds the sample staff accounts (all sharing one password) and lists
     * them on the sign-in page. Leave it off on a live server.
     */
    'demo' => (bool) env('MDMS_DEMO', false),
    'demo_password' => env('MDMS_DEMO_PASSWORD', 'amplified2026'),

    /* Shared secret the vending system sends to POST /api/vending/validate. */
    'vending_api_key' => env('VENDING_API_KEY'),

    /* Shared secret the LoRaWAN network server sends to POST /api/lorawan/uplink. */
    'lorawan_webhook_token' => env('LORAWAN_WEBHOOK_TOKEN'),
];
