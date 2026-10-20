<?php

/*
 * Kalahari Ultrasonic Water Meter (User Manual V1.03) and how the platform reads its data.
 */
return [
    'model' => 'Kalahari Ultrasonic DN15',

    'specs' => [
        'Nominal diameter' => 'DN15',
        'Permanent flow (Q3)' => '2.5 m³/h',
        'Dynamic range' => 'R250',
        'Temperature class' => 'T50',
        'Pressure rating' => 'PN16',
        'Protection' => 'IP68',
        'EM environment' => 'E1',
        'Valve' => 'Motorised ball valve',
        'Prepayment' => 'STS Edition 2 · 20-digit tokens',
        'Local token input' => 'CIU / infrared keypad',
        'Battery' => 'Lithium, replaceable · 8+ years at 1 report/day',
        'History' => 'Hourly freeze, 1 year on the meter',
    ],

    /*
     * Multiply decoded volumes and flows by this to get m³ and m³/h. The manual doesn't state
     * the units of its frozen-data sample (Total+ 69.9 → 123.3 with Flow+ 9.99 in one hour is
     * more than a DN15 meter can pass if those are m³), so confirm against the protocol
     * document and set KALAHARI_VOLUME_SCALE=0.001 if the meter reports litres.
     */
    'volume_scale' => (float) env('KALAHARI_VOLUME_SCALE', 1),

    // Permanent flow rate, m³/h. Flow above burst_factor × Q3 is treated as a burst.
    'q3' => 2.5,
    'burst_factor' => 1.25,

    // Flow that never stops for this many hours (each hour above the minimum) is a leak.
    'leak_hours' => 24,
    'leak_min_m3' => 0.002,

    // Lithium cell: ~3.65 V fresh. Below low_battery_v the platform raises an alarm.
    'battery_full_v' => 3.65,
    'battery_empty_v' => 3.30,
    'low_battery_v' => 3.40,

    // Remaining water credit (m³) at which a low-credit alarm is raised when the meter doesn't send its own.
    'low_credit_m3' => 1.0,

    // Reporting: hours of hourly records per uplink package (manual §8). Shipped default: 24.
    'reporting_hours' => [1, 2, 3, 4, 6, 8, 24],
    'sampling_minutes' => [15, 30, 60],
    'regions' => ['EU868', 'AS923-1', 'IN865'],

    /*
     * Meaning of bits in the "Status" field of each hourly record. The bit layout is defined
     * in the "Kalahari Ultrasonic Water Meter Communication Protocol", which we don't have yet;
     * until it is filled in, the dashboard shows the raw status in hex. Example:
     *     0x02 => ['valve_closed', 'Valve closed'],
     */
    'status_bits' => [],
];
