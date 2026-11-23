// Provisioning CLI for the ChirpStack server.
//
//   npm run cs -- status
//   npm run cs -- setup                      application + one device profile (+ codec) per meter model + HTTP integration
//   npm run cs -- codec:push                 upload each model's codec to its device profile
//   npm run cs -- gateway:add --eui 24e124fffef12345 --name "UG67 Leeroy HQ" --lat -24.6282 --lon 25.9231
//   npm run cs -- gateway:list
//   npm run cs -- meters:import secrets/meters.keys.csv [--model sh|kalahari|honeywell] [--dry-run]
//   npm run cs -- meters:set-model <devEui> sh|kalahari|honeywell   move a meter to that model's device profile
//   npm run cs -- meters:list
//   npm run cs -- gateway:frames [--eui <gateway eui>] [--minutes 10]
//                                            live LoRaWAN frames heard by a gateway (joins, uplinks), for diagnosis
//   npm run cs -- events:import <file.json>  load exported ChirpStack events (array or JSON lines) into the dashboard DB
//   npm run cs -- mdp:gateways               gateways on Milesight Development Platform + forwarder settings
//   npm run cs -- mdp:forward [--device <id|sn|eui>] [--dry-run]
//                                            point the UG67 packet forwarder at ChirpStack (Semtech UDP 1700)
//                                            and register the gateway in ChirpStack

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { config } from './config.js';
import internalPb from '@chirpstack/chirpstack-api/api/internal_pb.js';
import { ChirpStackApi } from './chirpstack/api.js';
import { streamCall } from './chirpstack/grpcweb.js';
import { codecSource, tzOffsetMin } from './decode.js';
import { MODELS, modelForProfile, parseModel, type ModelKey } from './models.js';
import { FORWARDER_KEYS, MilesightApi, PKT_TYPE_NAMES, pick, semtechForwarderValues, type MdpDevice } from './milesight.js';

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
  model?: string;
}

const HEADER_ALIASES: Record<string, keyof MeterRow> = {
  serial: 'serial', meter: 'serial', meter_no: 'serial', meterno: 'serial', meter_serial: 'serial', name: 'serial',
  addr: 'devAddr', devaddr: 'devAddr', dev_addr: 'devAddr', address: 'devAddr',
  deveui: 'devEui', dev_eui: 'devEui', eui: 'devEui',
  appeui: 'joinEui', app_eui: 'joinEui', joineui: 'joinEui', join_eui: 'joinEui',
  appkey: 'appKey', app_key: 'appKey',
  lat: 'latitude', latitude: 'latitude', lon: 'longitude', lng: 'longitude', long: 'longitude', longitude: 'longitude',
  description: 'description', location: 'description', address_text: 'description',
  model: 'model', type: 'model', meter_model: 'model',
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
      model: rec.model || undefined,
      latitude: rec.latitude ? Number(rec.latitude) : undefined,
      longitude: rec.longitude ? Number(rec.longitude) : undefined,
    };
    const problems: string[] = [];
    if (!HEX(16).test(row.devEui)) problems.push('DevEUI must be 16 hex characters');
    if (!HEX(16).test(row.joinEui)) problems.push('AppEUI/JoinEUI must be 16 hex characters');
    if (!HEX(32).test(row.appKey)) problems.push('AppKey must be 32 hex characters');
    // The label "ADDR" is often the meter's own address (e.g. 10 digits), not a
    // LoRaWAN DevAddr; OTAA assigns the DevAddr at join, so it is only kept as a tag.
    if (row.devAddr && !/^[0-9a-f]{1,20}$/.test(row.devAddr)) problems.push('ADDR must be hex/decimal digits');
    if (row.latitude !== undefined && !(Math.abs(row.latitude) <= 90)) problems.push('bad latitude');
    if (row.longitude !== undefined && !(Math.abs(row.longitude) <= 180)) problems.push('bad longitude');
    if (row.model && !parseModel(row.model)) problems.push(`unknown model "${row.model}" (sh, kalahari, honeywell)`);
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

/** One line per frame from ChirpStack's gateway frame log (JSON body of a LogItem). */
export function describeFrame(description: string, bodyJson: string, known: Set<string>): string {
  let b: Record<string, any> = {};
  try {
    b = JSON.parse(bodyJson);
  } catch {
    /* keep empty */
  }
  const p = b.phy_payload ?? b.phyPayload ?? {};
  const pl = p.payload ?? {};
  const rx = (b.rx_info ?? b.rxInfo ?? [])[0] ?? {};
  const tx = b.tx_info ?? b.txInfo ?? {};
  const lora = tx.modulation?.lora ?? {};
  const radio = `rssi ${rx.rssi ?? '?'} snr ${rx.snr != null ? Number(rx.snr).toFixed(1) : '?'} SF${lora.spreading_factor ?? lora.spreadingFactor ?? '?'} ${((tx.frequency ?? 0) / 1e6).toFixed(1)} MHz`;
  const time = new Date().toISOString().slice(11, 19);
  const devEui = pl.dev_eui ?? pl.devEui;
  if (devEui) {
    const reg = known.has(String(devEui).toLowerCase()) ? 'registered' : 'NOT registered';
    return `${time}  ${description.padEnd(18)} DevEUI ${devEui} JoinEUI ${pl.join_eui ?? pl.joinEui}  (${reg})  ${radio}`;
  }
  const fhdr = pl.fhdr ?? {};
  const addr = fhdr.devaddr ?? fhdr.devAddr;
  if (addr) {
    return `${time}  ${description.padEnd(18)} DevAddr ${addr} fCnt ${fhdr.f_cnt ?? fhdr.fCnt} fPort ${pl.f_port ?? pl.fPort ?? '-'}  ${radio}`;
  }
  return `${time}  ${description}  ${radio}`;
}

function milesight(): MilesightApi {
  return new MilesightApi(config.milesight.url, config.milesight.clientId, config.milesight.clientSecret);
}

async function mdpGateways(mdp: MilesightApi): Promise<MdpDevice[]> {
  const all = await mdp.searchDevices({ deviceType: ['GATEWAY'] });
  return all;
}

async function context(cs: ChirpStackApi) {
  const tenantId = await cs.resolveTenantId(config.chirpstack.tenantId);
  const applicationId = await cs.findApplication(tenantId, config.chirpstack.applicationName);
  const profiles = {} as Record<ModelKey, string | null>;
  for (const m of Object.values(MODELS)) profiles[m.key] = await cs.findDeviceProfile(tenantId, m.profileName);
  return { tenantId, applicationId, profiles };
}

function profileSettings(model: ModelKey) {
  const c = config.chirpstack;
  const m = MODELS[model];
  return {
    name: m.profileName,
    description: m.description,
    regionConfigId: c.regionConfigId,
    macVersion: c.macVersion,
    regParamsRevision: c.regParamsRevision,
    uplinkIntervalS: m.uplinkIntervalS,
    codecScript: codecSource(model),
  };
}

async function ensureProfiles(cs: ChirpStackApi, tenantId: string) {
  const ids = {} as Record<ModelKey, string>;
  for (const m of Object.values(MODELS)) {
    const dp = await cs.ensureDeviceProfile(tenantId, profileSettings(m.key));
    ids[m.key] = dp.id;
    console.log(`${dp.created ? 'Created' : 'Updated'} device profile "${m.profileName}" ${dp.id} (codec: ${m.codecFiles.join(' + ')})`);
  }
  return ids;
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
      model: { type: 'string' },
      device: { type: 'string' },
      minutes: { type: 'string' },
      host: { type: 'string' },
      port: { type: 'string' },
    },
  });

  switch (cmd) {
    case 'status': {
      const cs = api();
      const ctx = await context(cs);
      console.log(`ChirpStack     ${config.chirpstack.url}`);
      console.log(`Tenant         ${ctx.tenantId}`);
      console.log(`Application    ${ctx.applicationId ?? '(missing: run setup)'}  "${config.chirpstack.applicationName}"`);
      for (const m of Object.values(MODELS)) {
        console.log(`Profile        ${(ctx.profiles[m.key] ?? '(missing: run setup)').padEnd(36)}  "${m.profileName}"`);
      }
      const gws = await cs.listGateways(ctx.tenantId);
      console.log(`Gateways       ${gws.length}`);
      for (const g of gws) console.log(`  ${g.gatewayId}  ${g.state.padEnd(10)} ${g.name}  last seen ${g.lastSeenAt ?? 'never'}`);
      if (ctx.applicationId) {
        const devs = await cs.listDevices(ctx.applicationId);
        const seen = devs.filter((d) => d.lastSeenAt).length;
        console.log(`Meters         ${devs.length} registered, ${seen} have sent data`);
        for (const d of devs) {
          const model = modelForProfile(d.deviceProfileName);
          console.log(`  ${d.devEui}  ${(model ? MODELS[model].label : '?').padEnd(10)} ${d.name.padEnd(22)} last seen ${d.lastSeenAt ?? 'never'}`);
        }
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
      await ensureProfiles(cs, tenantId);
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
      await ensureProfiles(cs, tenantId);
      return;
    }

    case 'meters:set-model': {
      const [eui, modelArg] = positionals;
      const devEui = cleanHex(eui);
      const model = parseModel(modelArg);
      if (!HEX(16).test(devEui) || !model) throw new Error('usage: meters:set-model <devEui> sh|kalahari|honeywell');
      const cs = api();
      const ctx = await context(cs);
      const profileId = ctx.profiles[model];
      if (!profileId) throw new Error(`Profile "${MODELS[model].profileName}" is missing: run setup first.`);
      const dev = await cs.getDevice(devEui);
      if (!dev) throw new Error(`Meter ${devEui} is not registered in ChirpStack.`);
      const vars = MODELS[model].variables?.(tzOffsetMin()) ?? {};
      await cs.setDeviceProfile(devEui, profileId, vars);
      const varText = Object.keys(vars).length ? ` Codec variables: ${JSON.stringify(vars)}.` : '';
      console.log(
        dev.deviceProfileId === profileId
          ? `${devEui} "${dev.name}" is on "${MODELS[model].profileName}".${varText}`
          : `Moved ${devEui} "${dev.name}" to "${MODELS[model].profileName}". Its keys and network session are unchanged.${varText}`,
      );
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

    case 'gateway:frames': {
      const cs = api();
      const tenantId = await cs.resolveTenantId(config.chirpstack.tenantId);
      const eui = cleanHex(values.eui) || (await cs.listGateways(tenantId))[0]?.gatewayId;
      if (!eui) throw new Error('No gateway: pass --eui');
      const minutes = Number(values.minutes ?? 10);
      const known = new Set<string>();
      const ctx = await context(cs);
      if (ctx.applicationId) for (const d of await cs.listDevices(ctx.applicationId)) known.add(d.devEui);
      console.log(`Live frames on gateway ${eui} for ${minutes} min (ChirpStack replays the last few first). Ctrl+C to stop.`);
      const req = new internalPb.StreamGatewayFramesRequest();
      req.setGatewayId(eui);
      for await (const item of streamCall(config.chirpstack.url, config.chirpstack.apiToken, 'api.InternalService/StreamGatewayFrames', req, internalPb.LogItem, AbortSignal.timeout(minutes * 60_000))) {
        console.log(describeFrame(item.getDescription(), item.getBody(), known));
      }
      return;
    }

    case 'events:import': {
      const file = positionals[0];
      if (!file) throw new Error('usage: events:import <file.json>');
      const text = readFileSync(file, 'utf8').trim();
      const events: Record<string, unknown>[] = text.startsWith('[')
        ? JSON.parse(text)
        : text.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
      const { Store } = await import('./db.js');
      const { Ingestor } = await import('./ingest.js');
      const store = new Store(config.dbPath);
      const ingestor = new Ingestor(store);
      let ok = 0;
      let dup = 0;
      let bad = 0;
      // Oldest first, so the meter's "latest" values end up being the newest event.
      events.sort((a, b) => String(a.time ?? '').localeCompare(String(b.time ?? '')));
      for (const ev of events) {
        // An exported event carries no type: uplinks have fPort/data, status has margin, join has devAddr only.
        const type = 'fCnt' in ev || 'data' in ev ? 'up' : 'margin' in ev ? 'status' : 'devAddr' in ev ? 'join' : 'log';
        try {
          const res = ingestor.handle(type, ev) as { duplicate?: boolean };
          res.duplicate ? dup++ : ok++;
        } catch (e) {
          bad++;
          console.error(`skip: ${(e as Error).message}`);
        }
      }
      store.close();
      console.log(`Imported ${ok} events into ${config.dbPath} (${dup} already there, ${bad} rejected).`);
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
      if (!ctx.applicationId) throw new Error('Run "npm run cs -- setup" first.');
      const flagModel = values.model ? parseModel(values.model) : null;
      if (values.model && !flagModel) throw new Error('--model must be sh, kalahari or honeywell');
      let created = 0;
      let updated = 0;
      let failed = 0;
      for (const r of rows) {
        const tags: Record<string, string> = {};
        if (r.serial) tags.serial = r.serial;
        if (r.devAddr) tags.meter_addr = r.devAddr;
        if (r.latitude !== undefined) tags.latitude = String(r.latitude);
        if (r.longitude !== undefined) tags.longitude = String(r.longitude);
        const model = parseModel(r.model) ?? flagModel;
        if (!model) {
          failed++;
          console.error(`FAILED  ${r.devEui}  ${r.serial}: no model (add a model column or pass --model sh|kalahari|honeywell)`);
          continue;
        }
        const profileId = ctx.profiles[model];
        if (!profileId) throw new Error(`Profile "${MODELS[model].profileName}" is missing: run setup first.`);
        tags.model = MODELS[model].label;
        try {
          const res = await cs.upsertMeter(ctx.applicationId, profileId, {
            variables: MODELS[model].variables?.(tzOffsetMin()),
            devEui: r.devEui,
            joinEui: r.joinEui,
            appKey: r.appKey,
            name: r.serial || `WM-${r.devEui.slice(-6).toUpperCase()}`,
            description: r.description,
            tags,
          });
          res.created ? created++ : updated++;
          console.log(`${res.created ? 'added  ' : 'updated'} ${r.devEui}  ${r.serial}  (${MODELS[model].label})`);
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

    case 'mdp:gateways': {
      const mdp = milesight();
      const gws = await mdpGateways(mdp);
      if (!gws.length) console.log('No gateways found for this Development Platform Application.');
      for (const g of gws) {
        const cfg = await mdp.getConfig(g.deviceId).catch((e) => ({ error: (e as Error).message }));
        const fw = 'values' in cfg ? pick(cfg.values, FORWARDER_KEYS) : {};
        console.log(`${g.deviceId}  ${g.model ?? ''}  "${g.name ?? ''}"  SN ${g.sn ?? '-'}  EUI ${g.devEUI ?? '-'}  ${g.connectStatus ?? ''}`);
        if ('error' in cfg) console.log(`  config: ${cfg.error}`);
        else console.log(`  forwarder: type ${fw.pkt_type} (${PKT_TYPE_NAMES[Number(fw.pkt_type)] ?? '?'}), enabled ${fw.pkt_enable}, semtech ${fw.semtech_addr}:${fw.semtech_up_port}/${fw.semtech_down_port}`);
      }
      return;
    }

    case 'mdp:forward': {
      const mdp = milesight();
      const gws = await mdpGateways(mdp);
      const sel = values.device?.toLowerCase();
      const matches = sel
        ? gws.filter((g) => [g.deviceId, g.sn, g.devEUI, g.name].some((v) => v && String(v).toLowerCase() === sel))
        : gws;
      if (matches.length !== 1) {
        for (const g of gws) console.log(`  ${g.deviceId}  ${g.model ?? ''}  "${g.name ?? ''}"  SN ${g.sn ?? '-'}  EUI ${g.devEUI ?? '-'}`);
        throw new Error(matches.length ? 'More than one gateway: pick one with --device <id|sn|eui>.' : 'No matching gateway on the Development Platform.');
      }
      const gw = matches[0];
      const host = values.host ?? new URL(config.chirpstack.url).hostname;
      const port = values.port ? Number(values.port) : 1700;
      const before = pick((await mdp.getConfig(gw.deviceId)).values, FORWARDER_KEYS);
      const next = semtechForwarderValues(host, port, port);
      console.log(`Gateway ${gw.name ?? gw.deviceId} (${gw.model ?? '?'}, EUI ${gw.devEUI ?? '?'})`);
      console.log(`  before: ${JSON.stringify(before)}`);
      console.log(`  after:  ${JSON.stringify(Object.fromEntries(next.map((v) => [v.key, v.value])))}`);
      if (values['dry-run']) return;

      const task = await mdp.createProfileTask(gw.deviceId, next);
      console.log(`Configuration task created: ${JSON.stringify(task.deviceTaskRelations)}`);

      const eui = cleanHex(gw.devEUI);
      if (HEX(16).test(eui)) {
        const cs = api();
        const tenantId = await cs.resolveTenantId(config.chirpstack.tenantId);
        const res = await cs.upsertGateway(tenantId, {
          gatewayId: eui,
          name: values.name ?? gw.name ?? `UG67 ${eui.slice(-6)}`,
          description: `Milesight ${gw.model ?? 'UG67'} SN ${gw.sn ?? '?'}, Semtech UDP via Milesight Development Platform`,
          tags: { model: String(gw.model ?? 'UG67'), sn: String(gw.sn ?? '') },
        });
        console.log(`${res.created ? 'Registered' : 'Updated'} gateway ${eui} in ChirpStack`);
      } else {
        console.log('The Development Platform did not report a Gateway EUI; register it with gateway:add --eui ...');
      }
      return;
    }

    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 15).join('\n').replace(/^\/\/ ?/gm, ''));
      if (cmd) process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js')) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  });
}
