// Provisioning CLI for the ChirpStack server.
//
//   npm run cs -- status
//   npm run cs -- setup                      application + meter device profile (+ codec) + HTTP integration
//   npm run cs -- codec:push                 upload codec/water-meter.js to the device profile
//   npm run cs -- gateway:add --eui 24e124fffef12345 --name "UG67 Leeroy HQ" --lat -24.6282 --lon 25.9231
//   npm run cs -- gateway:list
//   npm run cs -- meters:import secrets/meters.keys.csv [--dry-run]
//   npm run cs -- meters:list

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { config } from './config.js';
import { ChirpStackApi } from './chirpstack/api.js';
import { codecSource } from './decode.js';

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`);

export function cleanHex(v: string | undefined): string {
  return (v ?? '').replace(/^0x/i, '').replace(/[\s:\-_]/g, '').toLowerCase();
}

export interface MeterRow {
  line: number;
  serial: string;
  devAddr: string;
  devEui: string;
  joinEui: string;
  appKey: string;
  latitude?: number;
  longitude?: number;
  description?: string;
}

const HEADER_ALIASES: Record<string, keyof MeterRow> = {
  serial: 'serial', meter: 'serial', meter_no: 'serial', meterno: 'serial', meter_serial: 'serial', name: 'serial',
  addr: 'devAddr', devaddr: 'devAddr', dev_addr: 'devAddr', address: 'devAddr',
  deveui: 'devEui', dev_eui: 'devEui', eui: 'devEui',
  appeui: 'joinEui', app_eui: 'joinEui', joineui: 'joinEui', join_eui: 'joinEui',
  appkey: 'appKey', app_key: 'appKey',
  lat: 'latitude', latitude: 'latitude', lon: 'longitude', lng: 'longitude', long: 'longitude', longitude: 'longitude',
  description: 'description', location: 'description', address_text: 'description',
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Parse the meter key sheet. Returns rows plus per-line errors (keys are never echoed). */
export function parseMeterCsv(text: string): { rows: MeterRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const firstIdx = lines.findIndex((l) => l && !l.startsWith('#'));
  if (firstIdx < 0) return { rows: [], errors: ['file is empty'] };
  const header = splitCsvLine(lines[firstIdx]).map((h) => HEADER_ALIASES[h.toLowerCase().replace(/[\s.]/g, '_')]);
  for (const need of ['devEui', 'joinEui', 'appKey'] as const) {
    if (!header.includes(need)) {
      return { rows: [], errors: [`header row must include a ${need} column (got: ${lines[firstIdx]})`] };
    }
  }

  const rows: MeterRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (let i = firstIdx + 1; i < lines.length; i++) {
    if (!lines[i] || lines[i].startsWith('#')) continue;
    const cells = splitCsvLine(lines[i]);
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => h && (rec[h] = cells[idx] ?? ''));
    const row: MeterRow = {
      line: i + 1,
      serial: (rec.serial ?? '').trim(),
      devAddr: cleanHex(rec.devAddr),
      devEui: cleanHex(rec.devEui),
      joinEui: cleanHex(rec.joinEui),
      appKey: cleanHex(rec.appKey),
      description: rec.description || undefined,
      latitude: rec.latitude ? Number(rec.latitude) : undefined,
      longitude: rec.longitude ? Number(rec.longitude) : undefined,
    };
    const problems: string[] = [];
    if (!HEX(16).test(row.devEui)) problems.push('DevEUI must be 16 hex characters');
    if (!HEX(16).test(row.joinEui)) problems.push('AppEUI/JoinEUI must be 16 hex characters');
    if (!HEX(32).test(row.appKey)) problems.push('AppKey must be 32 hex characters');
    if (row.devAddr && !HEX(8).test(row.devAddr)) problems.push('DevAddr must be 8 hex characters');
    if (row.latitude !== undefined && !(Math.abs(row.latitude) <= 90)) problems.push('bad latitude');
    if (row.longitude !== undefined && !(Math.abs(row.longitude) <= 180)) problems.push('bad longitude');
    if (seen.has(row.devEui)) problems.push(`duplicate DevEUI ${row.devEui}`);
    seen.add(row.devEui);
    if (problems.length) errors.push(`line ${row.line}${row.serial ? ` (${row.serial})` : ''}: ${problems.join('; ')}`);
    else rows.push(row);
  }
  return { rows, errors };
}

function api(): ChirpStackApi {
  if (!config.chirpstack.apiToken) {
    throw new Error('Set CHIRPSTACK_API_TOKEN (ChirpStack > API keys) in server/.env first.');
  }
  return new ChirpStackApi(config.chirpstack.url, config.chirpstack.apiToken);
}

async function context(cs: ChirpStackApi) {
  const tenantId = await cs.resolveTenantId(config.chirpstack.tenantId);
  const applicationId = await cs.findApplication(tenantId, config.chirpstack.applicationName);
  const deviceProfileId = await cs.findDeviceProfile(tenantId, config.chirpstack.deviceProfileName);
  return { tenantId, applicationId, deviceProfileId };
}

function profileSettings() {
  const c = config.chirpstack;
  return {
    name: c.deviceProfileName,
    regionConfigId: c.regionConfigId,
    macVersion: c.macVersion,
    regParamsRevision: c.regParamsRevision,
    uplinkIntervalS: c.uplinkIntervalS,
    codecScript: codecSource(),
  };
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      eui: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      lat: { type: 'string' },
      lon: { type: 'string' },
      alt: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'public-url': { type: 'string' },
    },
  });

  switch (cmd) {
    case 'status': {
      const cs = api();
      const ctx = await context(cs);
      console.log(`ChirpStack     ${config.chirpstack.url}`);
      console.log(`Tenant         ${ctx.tenantId}`);
      console.log(`Application    ${ctx.applicationId ?? '(missing: run setup)'}  "${config.chirpstack.applicationName}"`);
      console.log(`Device profile ${ctx.deviceProfileId ?? '(missing: run setup)'}  "${config.chirpstack.deviceProfileName}"`);
      const gws = await cs.listGateways(ctx.tenantId);
      console.log(`Gateways       ${gws.length}`);
      for (const g of gws) console.log(`  ${g.gatewayId}  ${g.state.padEnd(10)} ${g.name}  last seen ${g.lastSeenAt ?? 'never'}`);
      if (ctx.applicationId) {
        const devs = await cs.listDevices(ctx.applicationId);
        const seen = devs.filter((d) => d.lastSeenAt).length;
        console.log(`Meters         ${devs.length} registered, ${seen} have sent data`);
      }
      return;
    }

    case 'setup': {
      const cs = api();
      const tenantId = await cs.resolveTenantId(config.chirpstack.tenantId);
      const app = await cs.ensureApplication(
        tenantId,
        config.chirpstack.applicationName,
        'Prepaid LoRaWAN water meters, managed by the Amplified IoT MDMS.',
      );
      console.log(`${app.created ? 'Created' : 'Found'} application ${app.id}`);
      const dp = await cs.ensureDeviceProfile(tenantId, profileSettings());
      console.log(`${dp.created ? 'Created' : 'Updated'} device profile ${dp.id} (codec from codec/water-meter.js)`);
      const publicUrl = (values['public-url'] ?? config.publicUrl).replace(/\/$/, '');
      if (publicUrl) {
        if (!config.integrationToken) throw new Error('Set INTEGRATION_TOKEN before registering the HTTP integration.');
        const url = `${publicUrl}/integrations/chirpstack`;
        const res = await cs.ensureHttpIntegration(app.id, url, { 'X-Integration-Token': config.integrationToken });
        console.log(`${res.created ? 'Created' : 'Updated'} HTTP integration -> ${url}`);
      } else {
        console.log('PUBLIC_URL not set: skipped the HTTP integration. Set it (or use MQTT_URL) so uplinks reach this service.');
      }
      return;
    }

    case 'codec:push': {
      const cs = api();
      const tenantId = await cs.resolveTenantId(config.chirpstack.tenantId);
      const dp = await cs.ensureDeviceProfile(tenantId, profileSettings());
      console.log(`Codec uploaded to device profile ${dp.id}`);
      return;
    }

    case 'gateway:add': {
      const eui = cleanHex(values.eui);
      if (!HEX(16).test(eui)) throw new Error('--eui must be the 16-hex-character Gateway EUI (UG67: Packet Forwarder > General)');
      if (!values.name) throw new Error('--name is required');
      const cs = api();
      const tenantId = await cs.resolveTenantId(config.chirpstack.tenantId);
      const res = await cs.upsertGateway(tenantId, {
        gatewayId: eui,
        name: values.name,
        description: values.description ?? 'Milesight UG67 LoRaWAN gateway (Semtech UDP packet forwarder)',
        latitude: values.lat ? Number(values.lat) : undefined,
        longitude: values.lon ? Number(values.lon) : undefined,
        altitude: values.alt ? Number(values.alt) : undefined,
        tags: { model: 'Milesight UG67' },
      });
      console.log(`${res.created ? 'Registered' : 'Updated'} gateway ${eui} "${values.name}"`);
      return;
    }

    case 'gateway:list': {
      const cs = api();
      const tenantId = await cs.resolveTenantId(config.chirpstack.tenantId);
      for (const g of await cs.listGateways(tenantId)) {
        console.log(`${g.gatewayId}  ${g.state.padEnd(10)} ${g.name}  (${g.latitude}, ${g.longitude})  last seen ${g.lastSeenAt ?? 'never'}`);
      }
      return;
    }

    case 'meters:import': {
      const file = positionals[0];
      if (!file) throw new Error('usage: meters:import <file.csv> [--dry-run]');
      const { rows, errors } = parseMeterCsv(readFileSync(file, 'utf8'));
      for (const e of errors) console.error(`skip  ${e}`);
      console.log(`${rows.length} valid meter rows, ${errors.length} rejected`);
      if (values['dry-run'] || rows.length === 0) {
        for (const r of rows) console.log(`  ${r.devEui}  ${r.serial || '(no serial)'}  JoinEUI ${r.joinEui}  AppKey ****${r.appKey.slice(-4)}`);
        return;
      }
      const cs = api();
      const ctx = await context(cs);
      if (!ctx.applicationId || !ctx.deviceProfileId) throw new Error('Run "npm run cs -- setup" first.');
      let created = 0;
      let updated = 0;
      let failed = 0;
      for (const r of rows) {
        const tags: Record<string, string> = {};
        if (r.serial) tags.serial = r.serial;
        if (r.devAddr) tags.label_dev_addr = r.devAddr;
        if (r.latitude !== undefined) tags.latitude = String(r.latitude);
        if (r.longitude !== undefined) tags.longitude = String(r.longitude);
        try {
          const res = await cs.upsertMeter(ctx.applicationId, ctx.deviceProfileId, {
            devEui: r.devEui,
            joinEui: r.joinEui,
            appKey: r.appKey,
            name: r.serial || `WM-${r.devEui.slice(-6).toUpperCase()}`,
            description: r.description,
            tags,
          });
          res.created ? created++ : updated++;
          console.log(`${res.created ? 'added  ' : 'updated'} ${r.devEui}  ${r.serial}`);
        } catch (e) {
          failed++;
          console.error(`FAILED  ${r.devEui}  ${r.serial}: ${(e as Error).message}`);
        }
      }
      console.log(`Done: ${created} added, ${updated} updated, ${failed} failed.`);
      if (failed) process.exitCode = 1;
      return;
    }

    case 'meters:list': {
      const cs = api();
      const ctx = await context(cs);
      if (!ctx.applicationId) throw new Error('Run "npm run cs -- setup" first.');
      for (const d of await cs.listDevices(ctx.applicationId)) {
        console.log(`${d.devEui}  ${d.name.padEnd(16)} last seen ${d.lastSeenAt ?? 'never'}  battery ${d.batteryLevel ?? '-'}%`);
      }
      return;
    }

    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 11).join('\n').replace(/^\/\/ ?/gm, ''));
      if (cmd) process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js')) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  });
}
