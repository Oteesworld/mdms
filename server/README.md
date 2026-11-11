# Amplified IoT meter data service

Connects the MDMS to the ChirpStack v4 network server at
`https://teemane.leeroysystems.co.bw`, decodes meter uplinks and shows them on a
live meter dashboard.

```
water meter ──LoRa──▶ Milesight UG67 ──Semtech UDP :1700──▶ ChirpStack v4 (teemane)
                                                              │  device-profile codec
                                                              ▼  (codec/water-meter.js)
                       dashboard ◀── SSE ── this service ◀── HTTP integration POST
                                         (SQLite: uplinks,     /integrations/chirpstack?event=up
                                          readings, alarms)    (or MQTT, optional)
```

* **Provisioning CLI** (`npm run cs -- …`): creates the ChirpStack application,
  the meter device profile with its payload codec, and the HTTP integration;
  registers the UG67 gateway and imports meters (DevEUI, AppEUI/JoinEUI, AppKey)
  from a CSV.
* **Ingest**: ChirpStack POSTs every device event (`up`, `join`, `status`, …) to
  `/integrations/chirpstack`. Uplinks are de-duplicated, decoded, and turned into
  readings, alarms and meter state. MQTT ingest is available as an alternative.
* **Sync**: every 60 s the service mirrors gateways (online/offline) and registered
  meters from the ChirpStack API, so meters appear before their first uplink.
* **Dashboard** at `/`: KPIs, LoRaWAN port traffic, meters table with
  online / offline / never-seen / low-battery filters, gateway status, live uplink
  log and a meter drawer with the register chart, decoded fields and alarms.

The ChirpStack API is called over **gRPC-web** on port 443, the same port as the
ChirpStack web UI, so no extra port has to be opened for the API.

## Run it

Needs Node.js 22.13 or later. There is no database server: data goes to `data/mdms.sqlite`.

```bash
cd server
npm install
cp .env.example .env    # then fill CHIRPSTACK_API_TOKEN, INTEGRATION_TOKEN, PUBLIC_URL
npm run build && npm start
```

`npm run dev` runs from source with reload, and `npm test` runs the test suite.

## 1. Set up ChirpStack (one time)

```bash
npm run cs -- setup
```

This creates the **Amplified IoT Water Meters** application and the **Amplified IoT
Water Meter (EU868 OTAA)** device profile (Class A, OTAA, JS codec), and points the
application's HTTP integration at `PUBLIC_URL/integrations/chirpstack` with the
`X-Integration-Token` header. Re-running it is safe: it updates what exists.

`PUBLIC_URL` must be reachable **from the ChirpStack server** over HTTPS. If this
service runs on the same host or LAN as ChirpStack, a private URL works. If it can't
be reached, set `MQTT_URL` to ChirpStack's MQTT broker instead.

Check the result at any time with:

```bash
npm run cs -- status
```

## 2. Add the Milesight UG67 gateway

On the UG67 web UI (default `https://192.168.23.150`, user `admin`):

1. **Packet Forwarder → General**: copy the **Gateway EUI** (16 hex characters,
   usually starting `24E124`).
2. **Packet Forwarder → General → Multi-Destination**: disable the built-in
   destination, then add one:
   * Type **Semtech**, Enabled
   * Server address `teemane.leeroysystems.co.bw`
   * Port Up `1700`, Port Down `1700`
3. **Packet Forwarder → Radios**: Region **EU868** with the default channel plan
   (868.1, 868.3, 868.5 MHz plus 867.1 to 867.9 MHz). This must match ChirpStack's
   `eu868` region config.
4. **Network Server → General**: turn the embedded network server **off** so the
   UG67 only forwards packets.
5. Make sure the gateway has internet access (WAN or cellular) and can resolve the hostname.

**If the UG67 is managed from Milesight Development Platform** (no local web UI
access), let the CLI do steps 1 to 4 and the ChirpStack registration through the
platform's OpenAPI. Put the Application's credentials in `.env` (`MDP_CLIENT_ID`,
`MDP_CLIENT_SECRET`, `MDP_URL`), then run:

```bash
npm run cs -- mdp:gateways                   # list gateways and their current forwarder settings
npm run cs -- mdp:forward --dry-run          # show the before/after forwarder settings
npm run cs -- mdp:forward                    # push the change, register the gateway in ChirpStack
```

This sends a configuration task that changes only `pkt_enable`, `pkt_type` (1 = Semtech),
`semtech_addr` and `semtech_up_port`/`semtech_down_port`. The gateway's Milesight
management connection (`dm_*`) is left on, so it stays manageable from the platform.

Otherwise, register it in ChirpStack yourself, using the EUI from step 1 and the mast location:

```bash
npm run cs -- gateway:add --eui 24E124FFFEXXXXXX --name "UG67 Leeroy HQ" --lat -24.6282 --lon 25.9231
npm run cs -- gateway:list     # state turns "online" within ~30 s of the first stats packet
```

The ChirpStack server must accept **UDP 1700** from the internet and run the
ChirpStack Gateway Bridge for the Semtech UDP protocol. Check this on the server if
the gateway stays `never_seen`.

## 3. Import the meters

Put the meter keys in a CSV under `secrets/`, which git ignores. AppKeys are
secrets, so never commit them. The header can use the names on the meter labels:

```csv
serial,addr,deveui,appeui,appkey,lat,lon,description
WM-104882,01AB23CD,24E124136B502217,70B3D57ED0000000,2B7E151628AED2A6ABF7158809CF4F3C,-24.65,25.91,Plot 1234 Block 8
```

```bash
npm run cs -- meters:import secrets/meters.keys.csv --dry-run   # validate only, keys masked
npm run cs -- meters:import secrets/meters.keys.csv
```

* Meters are registered for **OTAA**: AppEUI becomes the JoinEUI, and the AppKey
  is stored as the LoRaWAN 1.0.x root key. The network assigns the session DevAddr
  when the meter joins; the `addr` column (on SH meters the 10-digit meter address)
  is kept as the `meter_addr` tag for reference.
* To see what the gateway actually hears, including join requests from meters that
  are not registered yet and uplinks from meters still on an old session, run
  `npm run cs -- gateway:frames --minutes 10`. A meter that keeps sending data with
  a DevAddr but never sends a JoinRequest is still on a session from another
  network server (for example the Milesight Development Platform LNS) and must be
  made to rejoin (magnet or button wake-up, or power cycle).
* Re-importing a DevEUI updates its name, tags and key.
* Confirm `METER_MAC_VERSION` (default `1.0.3`) and `METER_REG_PARAMS_REVISION`
  (default `A`) against the meter datasheet, then run `setup` again if they change.

## 4. Decoding the payload

`codec/water-meter.js` is a standard ChirpStack JavaScript codec (`decodeUplink`).
`setup` and `codec:push` upload it to the device profile, so ChirpStack decodes
every uplink. The service uses ChirpStack's decoded `object`, and runs the same
file itself as a fallback.

The port meanings come from the existing system (5 ACK-ACK, 37 Installation,
60 Midnight data, 61 Live data, 65 Tamper alarm, 66 Burst alarm, 210 Credit,
225 Come back). Tamper and burst alarms work from the port alone. **The byte
layout of each port is not filled in yet**, because it needs the meter vendor's
payload specification. Until then, readings show the port meaning and the raw
bytes. To add a layout, edit `LAYOUTS` in the codec, for example:

```js
var LAYOUTS = {
  60: [
    ['register_l', 'u32le', 1],      // cumulative litres
    ['battery_v',  'u8',    0.02],
    ['status',     'flags8', ['valve_closed', 'tamper', 'leak', 'low_battery']],
  ],
};
```

Then run `npm test` and `npm run cs -- codec:push`. Field names the dashboard
understands: `register_l`, `flow_lph`, `credit_l`, `balance`, `battery_pct`,
`battery_v`, `valve`, `valve_closed`, `tamper`, `burst`, `leak`,
`reverse_flow`, `magnetic`, `low_battery`.

Battery percentage and link margin also arrive from ChirpStack's daily
`DevStatusReq` (`status` events), whatever the payload layout.

## API

| Method | Path | |
|---|---|---|
| POST | `/integrations/chirpstack?event=up\|join\|status\|ack\|txack\|log\|location` | ChirpStack HTTP integration (JSON) |
| GET | `/api/summary` | KPI counts, port traffic (24 h), alarms, gateway states |
| GET | `/api/meters?status=online\|offline\|never_seen\|low_battery&q=` | meters with latest values |
| GET | `/api/meters/:devEui` | meter detail, last 50 uplinks, 31-day readings, alarms, events |
| GET | `/api/uplinks?limit=50` | recent uplinks, all meters |
| GET | `/api/gateways` | gateways synced from ChirpStack |
| POST | `/api/alarms/:id/clear` | clear an open alarm |
| GET | `/api/stream` | server-sent events: `uplink`, `device` |

The dashboard and API have no login yet. Put them behind the MDMS login or a
reverse proxy with authentication before exposing them publicly.
