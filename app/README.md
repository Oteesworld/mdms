# Amplified IoT — web app

React + TypeScript (Vite) build of the `Amplified IoT.dc.html` design from the Claude Design handoff (`../project`).
It uses mock data taken from the prototype and has no backend yet.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build to dist/
```

- `src/App.tsx` — app shell (sidebar, top bar) and screen switch; hash routes such as `#/map` or `#/domestic` (see `src/routes.ts`)
- `src/screens/` — Dashboard, NetworkMap (Leaflet), Reports, NetworkHealth, Register (client/asset tables + KYC panel), Portal, Settings
- `src/data/` — fixtures: fleet (suburbs, gateways, meters, map layers), clients (owner → property → tenant model), admin
- `src/styles.css` — design tokens (logo navy `#00468C`, gold `#D89E0E`) and shared classes
