// Local store for meter data received from ChirpStack.
//
// Uses Node's built-in SQLite so the service runs with no database server.
// Table and column names follow project/Database Schema.dc.html (gateways,
// uplinks, readings, alarms), keyed by DevEUI until the full clients /
// properties / meters schema is migrated to PostgreSQL.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gateways (
  gateway_id    TEXT PRIMARY KEY,           -- 16 hex chars, lower case
  name          TEXT NOT NULL,
  description   TEXT,
  latitude      REAL,
  longitude     REAL,
  state         TEXT NOT NULL DEFAULT 'never_seen',  -- never_seen | online | offline
  last_seen_at  TEXT,
  synced_at     TEXT
);

CREATE TABLE IF NOT EXISTS meters (
  dev_eui         TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  serial          TEXT,
  description     TEXT,
  join_eui        TEXT,
  dev_addr        TEXT,
  application_id  TEXT,
  device_profile  TEXT,
  tags_json       TEXT,
  created_at      TEXT NOT NULL,
  joined_at       TEXT,
  last_seen_at    TEXT,
  last_f_cnt      INTEGER,
  last_f_port     INTEGER,
  last_rssi       INTEGER,
  last_snr        REAL,
  last_sf         INTEGER,
  last_gateway_id TEXT,
  register_l      REAL,
  flow_lph        REAL,
  credit_l        REAL,
  battery_pct     REAL,
  battery_v       REAL,
  margin          INTEGER,
  valve           TEXT,
  last_object     TEXT
);

CREATE TABLE IF NOT EXISTS uplinks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  deduplication_id TEXT UNIQUE,
  received_at      TEXT NOT NULL,
  dev_eui          TEXT NOT NULL REFERENCES meters(dev_eui),
  f_cnt            INTEGER,
  f_port           INTEGER,
  payload_hex      TEXT,
  object_json      TEXT,
  decoded          INTEGER NOT NULL DEFAULT 0,
  rssi             INTEGER,
  snr              REAL,
  sf               INTEGER,
  dr               INTEGER,
  frequency_hz     INTEGER,
  gateway_id       TEXT,
  gateway_count    INTEGER
);
CREATE INDEX IF NOT EXISTS uplinks_dev_time ON uplinks (dev_eui, received_at DESC);
CREATE INDEX IF NOT EXISTS uplinks_time ON uplinks (received_at DESC);

CREATE TABLE IF NOT EXISTS readings (
  dev_eui       TEXT NOT NULL REFERENCES meters(dev_eui),
  read_at       TEXT NOT NULL,
  register_l    REAL,
  flow_lph      REAL,
  credit_l      REAL,
  reading_type  TEXT,
  uplink_f_cnt  INTEGER,
  PRIMARY KEY (dev_eui, read_at)
);

CREATE TABLE IF NOT EXISTS alarms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dev_eui     TEXT NOT NULL REFERENCES meters(dev_eui),
  alarm_type  TEXT NOT NULL,
  raised_at   TEXT NOT NULL,
  f_cnt       INTEGER,
  cleared_at  TEXT
);
CREATE INDEX IF NOT EXISTS alarms_open ON alarms (alarm_type) WHERE cleared_at IS NULL;

-- join, status, ack, txack, log and location events from ChirpStack.
CREATE TABLE IF NOT EXISTS device_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  dev_eui   TEXT NOT NULL,
  event     TEXT NOT NULL,
  at        TEXT NOT NULL,
  body_json TEXT
);
CREATE INDEX IF NOT EXISTS device_events_dev ON device_events (dev_eui, at DESC);
`;

export type Row = Record<string, unknown>;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  all(sql: string, ...params: SqlParam[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  get(sql: string, ...params: SqlParam[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }

  run(sql: string, ...params: SqlParam[]) {
    return this.db.prepare(sql).run(...params);
  }

  // --- meters --------------------------------------------------------------

  /** Make sure a meter row exists; refresh name/tags from ChirpStack when given. */
  ensureMeter(m: {
    devEui: string;
    name?: string;
    description?: string;
    applicationId?: string;
    deviceProfile?: string;
    tags?: Record<string, string>;
    lastSeenAt?: string | null;
    batteryPct?: number | null;
    margin?: number | null;
  }) {
    const now = new Date().toISOString();
    this.run(
      `INSERT INTO meters (dev_eui, name, serial, description, application_id, device_profile, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (dev_eui) DO UPDATE SET
         name = COALESCE(excluded.name, meters.name),
         serial = COALESCE(excluded.serial, meters.serial),
         description = COALESCE(excluded.description, meters.description),
         application_id = COALESCE(excluded.application_id, meters.application_id),
         device_profile = COALESCE(excluded.device_profile, meters.device_profile),
         tags_json = COALESCE(excluded.tags_json, meters.tags_json)`,
      m.devEui,
      m.name ?? m.devEui,
      m.tags?.serial ?? null,
      m.description ?? null,
      m.applicationId ?? null,
      m.deviceProfile ?? null,
      m.tags ? JSON.stringify(m.tags) : null,
      now,
    );
    if (m.lastSeenAt) {
      this.run(
        `UPDATE meters SET last_seen_at = ? WHERE dev_eui = ? AND (last_seen_at IS NULL OR last_seen_at < ?)`,
        m.lastSeenAt,
        m.devEui,
        m.lastSeenAt,
      );
    }
    if (m.batteryPct != null || m.margin != null) {
      this.run(
        `UPDATE meters SET battery_pct = COALESCE(?, battery_pct), margin = COALESCE(?, margin) WHERE dev_eui = ?`,
        m.batteryPct ?? null,
        m.margin ?? null,
        m.devEui,
      );
    }
  }

  upsertGateway(g: {
    gatewayId: string;
    name: string;
    description?: string;
    latitude?: number;
    longitude?: number;
    state: string;
    lastSeenAt: string | null;
  }) {
    this.run(
      `INSERT INTO gateways (gateway_id, name, description, latitude, longitude, state, last_seen_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (gateway_id) DO UPDATE SET
         name = excluded.name, description = excluded.description, latitude = excluded.latitude,
         longitude = excluded.longitude, state = excluded.state,
         last_seen_at = COALESCE(excluded.last_seen_at, gateways.last_seen_at), synced_at = excluded.synced_at`,
      g.gatewayId,
      g.name,
      g.description ?? null,
      g.latitude ?? null,
      g.longitude ?? null,
      g.state,
      g.lastSeenAt,
      new Date().toISOString(),
    );
  }
}

export type SqlParam = string | number | bigint | null | Uint8Array;
