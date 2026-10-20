<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Lorawan\DecodeException;
use App\Lorawan\UplinkIngestor;
use App\Lorawan\UplinkNormalizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/lorawan/uplink — webhook for the LoRaWAN network server.
 *
 * ChirpStack v4: HTTP integration, event URL `…/api/lorawan/uplink`, header
 * `Authorization: Bearer <LORAWAN_WEBHOOK_TOKEN>`. The Things Stack v3: webhook with the
 * same header, "Uplink message" and "Join accept" enabled.
 */
class LorawanUplinkController extends Controller
{
    public function __invoke(Request $request, UplinkNormalizer $normalizer, UplinkIngestor $ingestor): JsonResponse
    {
        $token = (string) config('mdms.lorawan_webhook_token');
        if ($token === '') {
            return response()->json(['error' => 'not_configured', 'message' => 'LORAWAN_WEBHOOK_TOKEN is not set on the server.'], 503);
        }
        $given = (string) ($request->header('X-Api-Key') ?? $request->bearerToken() ?? '');
        if (! hash_equals($token, $given)) {
            return response()->json(['error' => 'unauthorised', 'message' => 'Missing or invalid token.'], 401);
        }

        $body = json_decode($request->getContent(), true);
        if (! is_array($body)) {
            return response()->json(['error' => 'bad_request', 'message' => 'Body must be JSON.'], 400);
        }
        // ChirpStack sends status/ack/log events to the same URL; only uplinks and joins matter here.
        $event = $request->query('event');
        if ($event !== null && ! in_array($event, ['up', 'join'], true)) {
            return response()->json(['ignored' => $event]);
        }

        try {
            $n = $normalizer->normalize($body, $event);
        } catch (DecodeException $e) {
            return response()->json(['error' => 'bad_request', 'message' => $e->getMessage()], 400);
        }
        if ($n['event'] === 'other') {
            return response()->json(['ignored' => 'event']);
        }
        if (strlen($n['dev_eui']) !== 16) {
            return response()->json(['error' => 'bad_request', 'message' => 'DevEUI missing or not 16 hex digits.'], 400);
        }

        $uplink = $ingestor->ingest($n);

        return response()->json([
            'id' => $uplink->id,
            'meter' => $uplink->meter?->serial,
            'status' => $uplink->decode_status,
            'records' => $uplink->records ?? 0,
            'message' => $uplink->decode_error,
        ], $uplink->decode_status === 'unknown_device' ? 202 : 200);
    }
}
