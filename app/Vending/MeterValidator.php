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

        if (! preg_match(self::SERIAL, $serial)) {
            return $decline('INVALID_FORMAT', 'Meter number must look like WM- followed by six digits.');
        }
        $m = Meter::firstWhere('serial', $serial);
        if (! $m) {
            return $decline('METER_NOT_FOUND', "Meter {$serial} is not registered in the MDMS.");
        }

        $extra = [
            'meter' => ['serial' => $serial, 'devEui' => $m->dev_eui, 'status' => $m->online ? 'online' : 'offline', 'lastSeen' => $m->last_seen, 'property' => $m->plot],
            'account' => [
                'clientId' => $m->client_id, 'clientName' => $m->client_name, 'type' => $m->type, 'owner' => $m->owner,
                'occupant' => $m->occupant, 'vendingParty' => $m->vending_party, 'kyc' => $m->kyc, 'status' => $m->account_status,
            ],
        ];

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
        if (! $m->online && $m->offline_days >= $rules->offlineWarnDays) {
            $warnings[] = 'Meter has been offline '.str_replace(' ago', '', $m->last_seen).'; a remote token will apply on its next uplink. Advise the customer to key it in.';
        }
        if ($m->balance < 0) {
            $warnings[] = sprintf('Account is in arrears (P %.2f); 25%% of this purchase goes to debt recovery.', abs($m->balance));
        }
        if ($m->battery_pct < 40) {
            $warnings[] = "Meter battery is at {$m->battery_pct}%; replacement is scheduled.";
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
            'sts' => ['supplyGroupCode' => $biz ? '600742' : '600741', 'keyRevision' => 2, 'tariffIndex' => $biz ? '02' : '01', 'tokenTech' => 'STS6 · numeric 20-digit', 'algorithm' => 'EA07'],
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
