# Amplified IoT — web app

React + TypeScript (Vite) build of the `Amplified IoT.dc.html` design from the Claude Design handoff (`../project`).
It uses mock data taken from the prototype and has no backend yet.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build to dist/
```

- `src/App.tsx` — app shell (sidebar, top bar) and screen switch; hash routes such as `#/map` or `#/domestic` (see `src/routes.ts`)
- `src/screens/` — Dashboard, NetworkMap (Leaflet), Reports, NetworkHealth, Register (client/asset tables + KYC panel), Portal, Settings,
  and the meter data management (MDM) screens: Pipeline, Vee, Vending, Operations
- `src/data/` — fixtures: fleet (suburbs, gateways, meters, map layers), clients (owner → property → tenant model), admin, mdm
- `src/data/store.ts` — shared in-memory state for work orders and the downlink command queue

## Meter data management

The MDM screens follow the collect → store → validate → analyse → VEE → report → bill cycle:

- **Data pipeline** (`#/mdm`) — stage throughput, hourly interval reads, storage and retention, data quality by zone, downstream integrations
- **Validation (VEE)** (`#/vee`) — validation and estimation rules, an exception queue (accept estimate, edit with a required reason,
  or reject and raise a work order) and an append-only audit trail
- **Vending** (`#/vending`) — meter validation for the external vending system: test console, validation log, rules, sales received back, API contract
- **Field operations** (`#/operations`) — work orders (assign, start, complete) and LoRaWAN class A downlink commands
  (on-demand read, valve open/close, clock sync, …); the map's meter panel can queue commands too
- `src/styles.css` — design tokens (logo navy `#00468C`, gold `#D89E0E`) and shared classes

## Sign-in (demo only)

`src/auth.ts` holds demo accounts (password `amplified2026`) and the role → screen access map; `src/screens/Login.tsx` is the sign-in page.
Accounts are checked in the browser, so this gates the UI for demos but **does not secure any data**. Swap in a real identity
provider (e.g. Supabase Auth) before connecting live data.

| Role | Demo account | Can open |
|---|---|---|
| Admin | l.kgosi@amplifiediot.co.bw | everything |
| Ops | k.ramotswe@wuc.co.bw | everything except Settings |
| Finance | t.phiri@wuc.co.bw | dashboard, reports, data pipeline, VEE, vending, client registers, portal |
| Vendor | n.seretse@wuc.co.bw | vending, domestic and business clients, portal |
| Field | k.moloi@wuc.co.bw | map, field operations, meters, bulk meters, LoRaWAN, gateways, sites |

`a.dube@wuc.co.bw` is suspended and shows the blocked-account message.

## Vending validation API

Billing and STS token generation live in the external vending system. Before it issues a token it asks this
app to validate the meter:

```http
POST /api/vending/validate
Authorization: Bearer <VENDING_API_KEY>
Content-Type: application/json

{ "meter": "WM-104091", "purchaser": "occupant", "amount": 100, "vendorRef": "OM-88213" }
```

The response says `APPROVED` or `DECLINED` with a code (`METER_NOT_FOUND`, `ACCOUNT_SUSPENDED`, `KYC_INCOMPLETE`,
`TAMPER_HOLD`, `VENDING_NOT_PERMITTED`, `PURCHASER_NOT_PERMITTED`, `INVALID_FORMAT`), the account (owner,
occupant, who may buy), meter status, STS parameters (SGC, KRN, TI) and the tariff, plus warnings for the cashier
(meter offline, arrears, low battery). `GET /api/vending/validate` is a health check.

- Rules: `src/vending/validate.ts` — used by both the serverless function (`api/vending/validate.ts`) and the
  in-app test console, so they cannot drift apart.
- **Setup:** add `VENDING_API_KEY` in Vercel → Project → Settings → Environment Variables and redeploy.
  Until it is set the endpoint returns `503 not_configured` and validates nothing.
- Data modules reachable from the function import with `.js` extensions so they run as native Node ESM.
- Meter data is still the demo dataset; point `meterIndex()` at the real database when it exists.
