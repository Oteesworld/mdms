/*
 * Export the demo meter fleet for the database seeder: `npm run fixtures`.
 * Writes database/data/meters.json with each client meter, its account, and the
 * device state (online, battery, tamper) the vending validation rules look at.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDevice } from '../data/device.js';
import { meterIndex } from '../data/meters.js';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../../database/data/meters.json');

const rows = [...meterIndex().values()].map((m) => {
  const dev = makeDevice(m.serial, { plot: m.plot, business: m.type === 'business', balance: m.balance });
  return {
    serial: m.serial,
    dev_eui: dev.devEui,
    plot: m.plot,
    client_id: m.clientId,
    client_name: m.clientName,
    type: m.type,
    owner: m.owner,
    occupant: m.occupant,
    vending_party: m.vendingParty,
    kyc: m.kyc,
    account_status: m.status,
    balance: m.balance,
    online: dev.online,
    last_seen: dev.lastSeen,
    offline_days: dev.online ? 0 : parseInt(dev.lastSeen, 10) || 0,
    battery_pct: dev.overview.battPct,
    tamper: dev.alarms.some((a) => a.active && a.type === 'Magnetic tamper'),
    suburb: m.plot.split(', ')[1] ?? null,
    lat: dev.lat,
    lng: dev.lng,
    installed_at: dev.installedOn,
  };
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(rows, null, 1) + '\n');
console.log(`Wrote ${rows.length} meters to ${out}`);
