<?php

namespace App\Vending;

use App\Models\Meter;
use App\Models\VendingValidation;

/**
 * Meter validation for the external vending system.
 *
 * Billing and STS token generation happen in the vending system. Before it issues a
 * token it asks the MDMS whether the meter may be vended against, and to whom. This
 * class holds those rules; the API endpoint, the in-app console and the customer
 * portal all go through it.
 */
class MeterValidator
{
    public const SERIAL = '/^WM-\d{6}$/';

    /** The 13-digit Meter Address, which is also the STS meter number. */
    public const ADDRESS = '/^\d{13}$/';

    /**
     * @param  array{meter: string, purchaser?: ?string, amount?: ?float, vendorRef?: ?string}  $req
     */
    public function validate(array $req, ?ValidationRules $rules = null): array
    {
        $rules ??= new ValidationRules;
        $serial = strtoupper(trim((string) ($req['meter'] ?? '')));
        $purchaser = $req['purchaser'] ?? null;
        $base = [
            'warnings' => [],
            'request' => array_filter(['amount' => $req['amount'] ?? null, 'vendorRef' => $req['vendorRef'] ?? null, 'purchaser' => $purchaser], fn ($v) => $v !== null),
            'validatedAt' => now()->toIso8601ZuluString('millisecond'),
        ];
        $decline = fn (string $code, string $message, array $extra = []) => [...$base, ...$extra, 'result' => 'DECLINED', 'code' => $code, 'message' => $message];

        $byAddress = (bool) preg_match(self::ADDRESS, $serial);
        if (! $byAddress && ! preg_match(self::SERIAL, $serial)) {
            return $decline('INVALID_FORMAT', 'Use the 13-digit meter number or the serial (WM- followed by six digits).');
        }
        $m = Meter::firstWhere($byAddress ? 'meter_address' : 'serial', $serial);
        if (! $m) {
            return $decline('METER_NOT_FOUND', "Meter {$serial} is not registered in the MDMS.");
        }
        $serial = $m->serial;
        $online = $m->isOnline();
        $lastSeen = $m->lastSeenText();

        $extra = [
            'meter' => ['serial' => $serial, 'meterNumber' => $m->meter_address, 'devEui' => $m->dev_eui, 'status' => $online ? 'online' : 'offline', 'lastSeen' => $lastSeen, 'property' => $m->plot, 'remainingM3' => $m->remaining_m3],
            'account' => [
                'clientId' => $m->client_id, 'clientName' => $m->client_name, 'type' => $m->type, 'owner' => $m->owner,
                'occupant' => $m->occupant, 'vendingParty' => $m->vending_party, 'kyc' => $m->kyc, 'status' => $m->account_status,
            ],
        ];

        if ($m->network_status === 'decommissioned') {
            return $decline('VENDING_NOT_PERMITTED', "Meter {$serial} has been decommissioned.", $extra);
        }
        if (! $m->isAssigned()) {
            return $decline('VENDING_NOT_PERMITTED', "Meter {$serial} is registered but not yet assigned to a customer account.", $extra);
        }
        if ($rules->blockSuspended && $m->account_status === 'Suspended') {
            return $decline('ACCOUNT_SUSPENDED', "Account {$m->client_id} is suspended. Refer the customer to the utility office.", $extra);
        }
        if ($rules->blockKycIncomplete && $m->kyc !== 'Verified') {
            return $decline('KYC_INCOMPLETE', "KYC for {$m->client_name} is ".strtolower($m->kyc).'; vending is blocked until documents are verified.', $extra);
        }
        if ($rules->blockTamper && $m->tamper) {
            return $decline('TAMPER_HOLD', 'An active magnetic tamper alarm is open on this meter. A field inspection must clear it first.', $extra);
        }
        if ($m->vending_party === 'none') {
            return $decline('VENDING_NOT_PERMITTED', 'The property is vacant and the owner has not enabled vending.', $extra);
        }
        if ($purchaser && $purchaser !== $m->vending_party) {
            return $decline('PURCHASER_NOT_PERMITTED', "Only the {$m->vending_party} may buy against this meter.", $extra);
        }

        $warnings = [];
        if (! $online && $m->offlineDays() >= $rules->offlineWarnDays) {
            $warnings[] = 'Meter has been offline '.str_replace(' ago', '', $lastSeen).'; a remote token will apply on its next uplink. Advise the customer to key it in on the CIU.';
        }
        if ($m->balance < 0) {
            $warnings[] = sprintf('Account is in arrears (P %.2f); 25%% of this purchase goes to debt recovery.', abs($m->balance));
        }
        if (($batt = $m->batteryPercent()) < 40) {
            $warnings[] = "Meter battery is at {$batt}%; replacement is scheduled.";
        }

        $biz = $m->type === 'business';
        $buyer = $m->vending_party === 'occupant' ? $m->occupant : $m->owner;

        return [
            ...$base,
            ...$extra,
            'warnings' => $warnings,
            'result' => 'APPROVED',
            'code' => 'OK',
            'message' => "Meter {$serial} may be vended. Purchaser: {$buyer} ({$m->vending_party}).",
            'sts' => ['meterNumber' => $m->meter_address, 'supplyGroupCode' => $m->sts_sgc, 'keyRevision' => $m->sts_krn, 'tariffIndex' => $m->sts_ti, 'tokenTech' => 'STS Edition 2 · 20-digit', 'algorithm' => 'EA07', 'units' => 'm³'],
            'tariff' => $biz ? ['name' => 'Business', 'ratePerKl' => 21.4, 'vatRate' => 0.14] : ['name' => 'Domestic block tariff', 'ratePerKl' => 10.21, 'vatRate' => 0.14],
        ];
    }

    /** Validate and keep a record in the validation log. */
    public function validateAndLog(array $req, string $source, ?ValidationRules $rules = null, ?string $vendor = null): VendingValidation
    {
        $res = $this->validate($req, $rules);

        return VendingValidation::create([
            'meter' => substr(strtoupper(trim((string) ($req['meter'] ?? ''))), 0, 32),
            'result' => $res['result'],
            'code' => $res['code'],
            'source' => $source,
            'vendor' => $vendor !== null ? substr($vendor, 0, 40) : null,
            'amount' => $req['amount'] ?? null,
            'vendor_ref' => $req['vendorRef'] ?? null,
            'response' => $res,
            'created_at' => now(),
        ]);
    }
}
