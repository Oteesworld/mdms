<?php

namespace App\Http\Controllers;

use App\Vending\MeterValidator;
use App\Vending\ValidationRules;
use App\Vending\VendingPage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Meter validation from inside the app: the Vending test console and the customer portal. */
class VendingCheckController extends Controller
{
    public function __invoke(Request $request, MeterValidator $validator): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->canOpen('vending') || $user->canOpen('portal'), 403);

        $data = $request->validate([
            'meter' => ['required', 'string', 'max:32'],
            'purchaser' => ['nullable', 'in:occupant,owner'],
            'amount' => ['nullable', 'numeric', 'gt:0', 'max:100000'],
            'vendorRef' => ['nullable', 'string', 'max:64'],
            'source' => ['required', 'in:Console,Portal'],
            'rules' => ['nullable', 'array'],
        ]);

        // Only the Vending console may try rules other than the defaults the API uses.
        $rules = $data['source'] === 'Console' && $user->canOpen('vending') && isset($data['rules'])
            ? ValidationRules::fromArray($data['rules'])
            : null;

        $logged = $validator->validateAndLog($data, $data['source'], $rules, $data['source'] === 'Console' ? 'Test console' : 'Customer portal');

        return response()->json(['entry' => VendingPage::entry($logged)]);
    }
}
