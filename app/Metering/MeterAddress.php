<?php

namespace App\Metering;

/**
 * The 13-digit Meter Address printed on the meter and its CIU. It is also the STS meter
 * number (decoder reference number), whose last digit is a Luhn check digit.
 */
final class MeterAddress
{
    public static function valid(string $address): bool
    {
        return (bool) preg_match('/^\d{13}$/', $address) && self::luhnSum($address) % 10 === 0;
    }

    /** Append the Luhn check digit to 12 digits. */
    public static function withCheckDigit(string $twelve): string
    {
        return $twelve.((10 - self::luhnSum($twelve.'0') % 10) % 10);
    }

    private static function luhnSum(string $digits): int
    {
        $sum = 0;
        foreach (array_reverse(str_split($digits)) as $i => $c) {
            $d = (int) $c;
            if ($i % 2 === 1) {
                $d *= 2;
                $d -= $d > 9 ? 9 : 0;
            }
            $sum += $d;
        }

        return $sum;
    }
}
