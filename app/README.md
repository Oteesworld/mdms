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
  and the meter data management (MDM) screens: Pipeline, Vee, Billing, Operations
- `src/data/` — fixtures: fleet (suburbs, gateways, meters, map layers), clients (owner → property → tenant model), admin, mdm
- `src/data/store.ts` — shared in-memory state for work orders and the downlink command queue

## Meter data management

The MDM screens follow the collect → store → validate → analyse → VEE → report → bill cycle:

- **Data pipeline** (`#/mdm`) — stage throughput, hourly interval reads, storage and retention, data quality by zone, downstream integrations
- **Validation (VEE)** (`#/vee`) — validation and estimation rules, an exception queue (accept estimate, edit with a required reason,
  or reject and raise a work order) and an append-only audit trail
- **Billing** (`#/billing`) — postpaid bill run for credit-terms business and government accounts, with reads held on VEE exceptions; tariffs are illustrative
- **Field operations** (`#/operations`) — work orders (assign, start, complete) and LoRaWAN class A downlink commands
  (on-demand read, valve open/close, clock sync, …); the map's meter panel can queue commands too
- `src/styles.css` — design tokens (logo navy `#00468C`, gold `#D89E0E`) and shared classes
