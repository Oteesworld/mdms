/*
 * POST /api/vending/validate — meter validation for the external vending system.
 *
 * The vending system calls this before it generates an STS token. Authenticate with
 * `Authorization: Bearer <VENDING_API_KEY>` (or an `x-api-key` header). The key is set as
 * a Vercel environment variable; until it is set the endpoint answers 503 and validates nothing.
 *
 * Request body: { "meter": "WM-104882", "purchaser": "occupant" | "owner", "amount": 100, "vendorRef": "..." }
 * Response: see ValidationResponse in src/vending/validate.ts.
 */
import { timingSafeEqual } from 'node:crypto';
import { validateMeter, type ValidationRequest } from '../../src/vending/validate.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function authorised(req: Request): boolean | 'unconfigured' {
  const key = process.env.VENDING_API_KEY;
  if (!key) return 'unconfigured';
  const given = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  const auth = authorised(req);
  if (auth === 'unconfigured') return json(503, { error: 'not_configured', message: 'VENDING_API_KEY is not set on the server.' });
  if (!auth) return json(401, { error: 'unauthorised', message: 'Missing or invalid API key.' });

  let body: Partial<ValidationRequest>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request', message: 'Body must be JSON: { "meter": "WM-104882" }' });
  }
  if (typeof body?.meter !== 'string') return json(400, { error: 'bad_request', message: '"meter" (string) is required.' });
  if (body.purchaser !== undefined && body.purchaser !== 'occupant' && body.purchaser !== 'owner') {
    return json(400, { error: 'bad_request', message: '"purchaser" must be "occupant" or "owner".' });
  }
  if (body.amount !== undefined && (typeof body.amount !== 'number' || !(body.amount > 0))) {
    return json(400, { error: 'bad_request', message: '"amount" must be a positive number.' });
  }

  const result = validateMeter({ meter: body.meter, purchaser: body.purchaser, amount: body.amount, vendorRef: typeof body.vendorRef === 'string' ? body.vendorRef.slice(0, 64) : undefined });
  return json(200, result);
}

/** Health check: tells the vending team whether the endpoint is up and configured. */
export function GET(): Response {
  return json(200, { service: 'mdms-vending-validation', version: 1, configured: Boolean(process.env.VENDING_API_KEY), usage: 'POST JSON { "meter": "WM-104882" } with Authorization: Bearer <key>' });
}
