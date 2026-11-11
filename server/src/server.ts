// HTTP server: ChirpStack integration webhook, dashboard REST API, live
// server-sent event stream and the static dashboard.

import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Row, Store } from './db.js';
import { portLabel } from './decode.js';
import { BadEvent, EVENT_TYPES, type Ingestor } from './ingest.js';

const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));

export interface ServerDeps {
  config: Config;
  store: Store;
  ingestor: Ingestor;
  /** Last ChirpStack sync result, shown in the dashboard header. */
  syncState?: () => { ok: boolean; at: string | null; error: string | null; enabled: boolean };
}

export function meterStatus(row: Row, config: Config, now = Date.now()): 'online' | 'offline' | 'never_seen' {
  const seen = row.last_seen_at ? Date.parse(String(row.last_seen_at)) : NaN;
  if (!Number.isFinite(seen)) return 'never_seen';
  return now - seen <= config.offlineAfterS * 1000 ? 'online' : 'offline';
}

function meterView(row: Row, config: Config) {
  let lastObject: unknown = null;
  try {
    lastObject = row.last_object ? JSON.parse(String(row.last_object)) : null;
  } catch {
    lastObject = null;
  }
  let tags: Record<string, string> = {};
  try {
    tags = row.tags_json ? JSON.parse(String(row.tags_json)) : {};
  } catch {
    tags = {};
  }
  const battery = row.battery_pct == null ? null : Number(row.battery_pct);
  return {
    devEui: row.dev_eui,
    name: row.name,
    serial: row.serial ?? tags.serial ?? null,
    description: row.description,
    devAddr: row.dev_addr,
    joinEui: row.join_eui,
    deviceProfile: row.device_profile,
    tags,
    status: meterStatus(row, config),
    lowBattery: battery != null && battery <= config.lowBatteryPct,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
    lastFCnt: row.last_f_cnt,
    lastFPort: row.last_f_port,
    lastPortLabel: portLabel(row.last_f_port as number | null),
    lastRssi: row.last_rssi,
    lastSnr: row.last_snr,
    lastSf: row.last_sf,
    lastGatewayId: row.last_gateway_id,
    registerL: row.register_l,
    flowLph: row.flow_lph,
    creditL: row.credit_l,
    batteryPct: battery,
    batteryV: row.battery_v,
    margin: row.margin,
    valve: row.valve,
    openAlarms: row.open_alarms ?? 0,
    lastObject,
  };
}

function uplinkView(r: Row) {
  let object: unknown = {};
  try {
    object = r.object_json ? JSON.parse(String(r.object_json)) : {};
  } catch {
    object = {};
  }
  return {
    id: r.id,
    devEui: r.dev_eui,
    name: r.name,
    receivedAt: r.received_at,
    fCnt: r.f_cnt,
    fPort: r.f_port,
    portLabel: portLabel(r.f_port as number | null),
    payloadHex: r.payload_hex,
    decoded: r.decoded === 1,
    object,
    rssi: r.rssi,
    snr: r.snr,
    sf: r.sf,
    dr: r.dr,
    frequencyHz: r.frequency_hz,
    gatewayId: r.gateway_id,
    gatewayCount: r.gateway_count,
  };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const METERS_SQL = `
  SELECT m.*, (SELECT COUNT(*) FROM alarms a WHERE a.dev_eui = m.dev_eui AND a.cleared_at IS NULL) AS open_alarms
  FROM meters m`;

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, store, ingestor } = deps;
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 1024 * 1024 });

  // --- ChirpStack HTTP integration ------------------------------------------
  // ChirpStack POSTs every device event to <url>?event=<type> with a JSON body.
  app.post<{ Querystring: { event?: string } }>('/integrations/chirpstack', async (req, reply) => {
    if (config.integrationToken) {
      const got = String(req.headers['x-integration-token'] ?? '');
      if (!safeEqual(got, config.integrationToken)) return reply.code(401).send({ error: 'bad integration token' });
    }
    const event = String(req.query.event ?? '');
    if (!(EVENT_TYPES as readonly string[]).includes(event)) {
      return reply.code(400).send({ error: `unknown event type "${event}"` });
    }
    try {
      return ingestor.handle(event, req.body);
    } catch (e) {
      if (e instanceof BadEvent) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  // --- dashboard API ---------------------------------------------------------
  app.get('/api/health', async () => ({ ok: true, chirpstack: deps.syncState?.() ?? null }));

  app.get('/api/summary', async () => {
    const meters = store.all(METERS_SQL).map((r) => meterView(r, config));
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const ports = store.all(
      `SELECT f_port, COUNT(*) AS n FROM uplinks WHERE received_at >= ? GROUP BY f_port ORDER BY f_port`,
      since,
    );
    const uplinks24h = store.get(`SELECT COUNT(*) AS n FROM uplinks WHERE received_at >= ?`, since)?.n ?? 0;
    const openAlarms = store.all(
      `SELECT alarm_type, COUNT(*) AS n FROM alarms WHERE cleared_at IS NULL GROUP BY alarm_type`,
    );
    const gateways = store.all(`SELECT state, COUNT(*) AS n FROM gateways GROUP BY state`);
    const volume = store.get(`SELECT SUM(register_l) AS total FROM meters`)?.total ?? null;
    return {
      generatedAt: new Date().toISOString(),
      meters: {
        total: meters.length,
        online: meters.filter((m) => m.status === 'online').length,
        offline: meters.filter((m) => m.status === 'offline').length,
        neverSeen: meters.filter((m) => m.status === 'never_seen').length,
        lowBattery: meters.filter((m) => m.lowBattery).length,
      },
      totalRegisterL: volume,
      uplinks24h,
      ports: ports.map((p) => ({ fPort: p.f_port, label: portLabel(p.f_port as number), count: p.n })),
      openAlarms: openAlarms.map((a) => ({ type: a.alarm_type, count: a.n })),
      gateways: Object.fromEntries(gateways.map((g) => [String(g.state), g.n])),
      chirpstack: deps.syncState?.() ?? null,
    };
  });

  app.get<{ Querystring: { status?: string; q?: string } }>('/api/meters', async (req) => {
    let rows = store.all(`${METERS_SQL} ORDER BY m.last_seen_at IS NULL, m.last_seen_at DESC, m.name`).map((r) =>
      meterView(r, config),
    );
    const { status, q } = req.query;
    if (status === 'low_battery') rows = rows.filter((m) => m.lowBattery);
    else if (status) rows = rows.filter((m) => m.status === status);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((m) =>
        [m.name, m.devEui, m.serial, m.devAddr].some((v) => v && String(v).toLowerCase().includes(needle)),
      );
    }
    return rows;
  });

  app.get<{ Params: { devEui: string } }>('/api/meters/:devEui', async (req, reply) => {
    const devEui = req.params.devEui.toLowerCase();
    const row = store.get(`${METERS_SQL} WHERE m.dev_eui = ?`, devEui);
    if (!row) return reply.code(404).send({ error: 'meter not found' });
    const since = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
    return {
      meter: meterView(row, config),
      uplinks: store
        .all(
          `SELECT u.*, m.name FROM uplinks u JOIN meters m USING (dev_eui)
           WHERE u.dev_eui = ? ORDER BY u.received_at DESC LIMIT 50`,
          devEui,
        )
        .map(uplinkView),
      readings: store.all(
        `SELECT read_at AS readAt, register_l AS registerL, flow_lph AS flowLph, credit_l AS creditL,
                reading_type AS readingType
         FROM readings WHERE dev_eui = ? AND read_at >= ? ORDER BY read_at`,
        devEui,
        since,
      ),
      alarms: store.all(
        `SELECT id, alarm_type AS type, raised_at AS raisedAt, cleared_at AS clearedAt
         FROM alarms WHERE dev_eui = ? ORDER BY raised_at DESC LIMIT 50`,
        devEui,
      ),
      events: store.all(
        `SELECT event, at, body_json AS body FROM device_events WHERE dev_eui = ? ORDER BY at DESC LIMIT 20`,
        devEui,
      ),
    };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/uplinks', async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    return store
      .all(
        `SELECT u.*, m.name FROM uplinks u JOIN meters m USING (dev_eui) ORDER BY u.received_at DESC LIMIT ?`,
        limit,
      )
      .map(uplinkView);
  });

  app.get('/api/gateways', async () =>
    store.all(`SELECT gateway_id AS gatewayId, name, description, latitude, longitude, state,
                      last_seen_at AS lastSeenAt, synced_at AS syncedAt
               FROM gateways ORDER BY name`),
  );

  app.post<{ Params: { id: string } }>('/api/alarms/:id/clear', async (req, reply) => {
    const res = store.run(
      `UPDATE alarms SET cleared_at = ? WHERE id = ? AND cleared_at IS NULL`,
      new Date().toISOString(),
      Number(req.params.id),
    );
    if (res.changes === 0) return reply.code(404).send({ error: 'no open alarm with that id' });
    return { ok: true };
  });

  // --- live stream (server-sent events) --------------------------------------
  app.get('/api/stream', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const send = (type: string) => (data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    const onUplink = send('uplink');
    const onDevice = send('device');
    ingestor.on('uplink', onUplink);
    ingestor.on('device', onDevice);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      ingestor.off('uplink', onUplink);
      ingestor.off('device', onDevice);
    });
  });

  // --- dashboard ---------------------------------------------------------------
  await app.register(fastifyStatic, { root: WEB_DIR, prefix: '/' });

  return app;
}
