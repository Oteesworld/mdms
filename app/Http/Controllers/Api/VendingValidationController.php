<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Vending\MeterValidator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/vending/validate — meter validation for the external vending system.
 *
 * The vending system calls this before it generates an STS token, with
 * `Authorization: Bearer <VENDING_API_KEY>` (or an `X-Api-Key` header). Until the key is
 * set in .env the endpoint answers 503 and validates nothing.
 */
class VendingValidationController extends Controller
{
    public function validate(Request $request, MeterValidator $validator): JsonResponse
    {
        $key = (string) config('mdms.vending_api_key');
        if ($key === '') {
            return $this->error(503, 'not_configured', 'VENDING_API_KEY is not set on the server.');
        }
        $given = (string) ($request->header('X-Api-Key') ?? $request->bearerToken() ?? '');
        if (! hash_equals($key, $given)) {
            return $this->error(401, 'unauthorised', 'Missing or invalid API key.');
        }

        $body = json_decode($request->getContent(), true);
        if (! is_array($body)) {
            return $this->error(400, 'bad_request', 'Body must be JSON: { "meter": "WM-104882" }');
        }
        if (! is_string($body['meter'] ?? null)) {
            return $this->error(400, 'bad_request', '"meter" (string) is required.');
        }
        if (isset($body['purchaser']) && ! in_array($body['purchaser'], ['occupant', 'owner'], true)) {
            return $this->error(400, 'bad_request', '"purchaser" must be "occupant" or "owner".');
        }
        if (isset($body['amount']) && (! is_int($body['amount']) && ! is_float($body['amount']) || $body['amount'] <= 0)) {
            return $this->error(400, 'bad_request', '"amount" must be a positive number.');
        }

        $req = [
            'meter' => $body['meter'],
            'purchaser' => $body['purchaser'] ?? null,
            'amount' => $body['amount'] ?? null,
            'vendorRef' => is_string($body['vendorRef'] ?? null) ? substr($body['vendorRef'], 0, 64) : null,
        ];
        $vendor = is_string($body['vendor'] ?? null) ? $body['vendor'] : null;

        return $this->json(200, $validator->validateAndLog($req, 'API', null, $vendor)->response);
    }

    /** Health check: tells the vending team whether the endpoint is up and configured. */
    public function health(): JsonResponse
    {
        return $this->json(200, [
            'service' => 'mdms-vending-validation',
            'version' => 1,
            'configured' => filled(config('mdms.vending_api_key')),
            'usage' => 'POST JSON { "meter": "WM-104882" } with Authorization: Bearer <key>',
        ]);
    }

    private function error(int $status, string $error, string $message): JsonResponse
    {
        return $this->json($status, ['error' => $error, 'message' => $message]);
    }

    private function json(int $status, array $body): JsonResponse
    {
        return response()->json($body, $status, ['Cache-Control' => 'no-store'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
