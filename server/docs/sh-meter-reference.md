# SH Meters STS ultrasonic water meter: field guide

Model SH-L-EU868 (DN15, Q3 2.5 m³/h, R250, IP68, STS Edition 2, motorised ball
valve, LoRaWAN EU868 Class A, OTAA). Summarised from the vendor's *STS Ultrasonic
Water Meter User Manual V1.03A* and its C7 protocol decoder. The dashboard shows
these names; `server/web/fields.js` holds the same definitions.

## Identity (meter label)

| Label | Meaning | In ChirpStack / dashboard |
|---|---|---|
| Serial (MeterAddr on the barcode) | Meter number, e.g. `0288260615217` | Device name / `serial` tag |
| ADDR | 10-digit meter address, e.g. `2606001521`. Sent in every frame; binds the CIU keypad; STS tokens are addressed to it | `meter_addr` tag, `address` field |
| DevEUI | LoRaWAN device ID | Device EUI |
| AppEUI | LoRaWAN JoinEUI | Join EUI |
| AppKey | LoRaWAN root key (secret) | Device keys |

## Readings: display pages and data-report fields

Press the touch key (▷) to step through the display. The same values arrive in
the meter's data report (message type `0xC7`, fPort 2).

| Display | Meaning | Report field | Unit |
|---|---|---|---|
| P-0 | Total meter reading | `totalFlow` | m³ |
| P-1 | Instantaneous flow rate | `currentFlow` | m³/h |
| P-2 | Remaining water credit | `totalPurchase − totalConsumption` (`credit_l`) | m³ (dashboard: L) |
| P-3 | Total water consumed against credit | `totalConsumption` | m³ |
| P-4 | Total water purchased | `totalPurchase` | m³ |
| P-5 | Latest recharge volume | `latestRecharge` | m³ |
| P-6 | Maximum recharge limit | (not in the report) | m³ |
| P-7 | Accumulated water limit (most credit the meter holds) | `hoardingAmount` | m³ |
| P-8 | Low-credit alarm volume | `warningWater` | m³ |
| P-9 | Overdraft limit | `creditWater` | m³ |
| P-A | Water temperature | `waterTemperature` | °C |
| P-B | Battery voltage | `voltageRtu` | V |
| P-C / P-D | Meter date / time | `meterTime` | |

Also in the report: reverse volume and flow (`totalFlowReverse`,
`currentFlowReverse`), consumption this hour, the valve state (`valve`: open or
closed), and up to 24 hourly records (stored as back-dated readings).

## Alarms and status icons

| LCD icon | Report flag | Meaning |
|---|---|---|
| Leakage | `leakageStatus` | Continuous small flow over the leak detection period |
| Pipe burst | `burstAnalysis` | Flow above the burst threshold for the burst period |
| Magnetic attack (∩) | `magneticAttackStatus` | A magnet held against the meter: tamper |
| Voltage alarm (battery icon) | `voltageStatus` | Low battery voltage |
| Empty | `emptyPipe` | No water at the sensor |
| On-off valve | `valve` / `valveStatus` | Valve state / valve status bit |
| Network status, signal bars | — | LoRaWAN link |
| Clock anomaly | — | Meter clock not set or invalid |
| Equipment maintenance, alarm triangle | — | General fault / attention |

Leak and burst thresholds and detection periods are set in SQCOMM (ParaSet).

## Prepayment (STS)

* The meter holds water credit in m³. Tokens are 20-digit STS Edition 2 codes,
  entered on the CIU or infrared keypad, or sent remotely (the codec's
  `encodeDownlink` builds the `0xC8` token frame for the meter address).
* At the low-credit volume (P-8) the meter warns. Below zero it keeps supplying
  down to the overdraft limit (P-9), then closes the valve. Display example: `-0.4`.
* Token results on the display:

| Display | Meaning |
|---|---|
| `Ad 0.5` | Recharge accepted, 0.5 m³ added |
| `Accept` | Command or token accepted |
| `1st KCT`, `2nd KCT`, `3rd KCT`, `KEY chAG` | Key change tokens accepted, encryption key changed |
| `LEn Err` | Wrong token length |
| `ovErFLod` | Would exceed the accumulated water limit (P-7) |
| `TID oLd` | Token too old |
| `TID USEd` | Token already used |
| `rEJEct` | Rejected |
| `CRC ERR` (CIU) | Token check failed |

CIU keypad: `00` + Confirm syncs data with the meter; Delete cycles the menu.

## Reporting and maintenance

* **Shipped in Non-Reporting Mode**: the meter sends no data reports until
  reporting is switched on. Enter key code **11111** on the touch key
  (press, release, press, release, press: one LED flash per second held, two quick
  flashes = accepted), or send it over the infrared port.
* Key code **10001** is the test command. Blue LED on = joining the network;
  red LED flashing 3 times = gateway answered.
* Defaults: sample every 1 h, report every 24 h (up to 24 hourly records per
  report). Options: 1, 2, 3, 4, 6, 8 h packages (24 to 3 reports a day).
* SQCOMM (PC, infrared/serial at 9600 8N1): ParaSet page → **Wakeup**, then
  **Read** or **Write** parameters (tick the box beside each one to write);
  **Sample** = sample now, **Report** = send a report now. The device sleeps
  again after 90 s idle. Set the meter **Time** here: an unset clock reads 2022.
* Battery: built-in lithium, replaceable, about 8 years at one report a day.

## Messages seen on the network

| fPort | Message | Dashboard |
|---|---|---|
| 2 | `0xC7` data report | Fully decoded |
| 2 | `0xC2` status frame (every 4 h, also after joining) | Total meter reading and meter clock decoded; other fields shown as unconfirmed, not used as readings |
| 223 | Link message `ff ff .. .. 00 ff` | Labelled, no meter data |
| 0 | LoRaWAN MAC commands | Labelled |

### Status frame (`0xC2`) layout

Not in the vendor decoder; worked out from meter 0288260615217's frames and its display.

| Bytes after the type | Meaning | Status |
|---|---|---|
| 1-4 | Total meter reading, units of 0.1 m³ (197 = 19.7 m³) | Confirmed: display P-0 read 19.7 m³ when this was 197 |
| 5-8 | Unknown (112) | Unconfirmed |
| 9-10 | BCD 3.65 | Unconfirmed; not the battery (P-B read 3.70 V) |
| 11-12 | BCD 3.40 (3.00 before 17 Nov) | Unconfirmed |
| 13 | Flags (`10`, `50`, `08` seen) | Unconfirmed |
| 14-20 | Zero so far | Unconfirmed |
| 21-26 | Meter clock, BCD seconds, minutes, hours, day, month, year | Confirmed against network time |
