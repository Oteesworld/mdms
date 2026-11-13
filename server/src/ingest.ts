// Turns ChirpStack v4 integration events (HTTP or MQTT, JSON encoding) into
// stored uplinks, readings, alarms and meter state, and tells live listeners.

import { EventEmitter } from 'node:events';
import type { Store } from './db.js';
import { decodeLocally, normalise, portLabel } from './decode.js';

export interface DeviceInfo {
  tenantId?: string;
  applicationId?: string;
  applicationName?: string;
  deviceProfileId?: string;
  deviceProfileName?: string;
  deviceName?: string;
  devEui: string;
  tags?: Record<string, string>;
}

interface RxInfo {
  gatewayId?: string;
  rssi?: number;
  snr?: number;
}

export interface UplinkEvent {
  deduplicationId?: string;
  time?: string;
  deviceInfo: DeviceInfo;
  devAddr?: string;
  dr?: number;
  fCnt?: number;
  fPort?: number;
  confirmed?: boolean;
  data?: string; // base64
  object?: Record<string, unknown>;
  rxInfo?: RxInfo[];
  txInfo?: { frequency?: number; modulation?: { lora?: { spreadingFactor?: number } } };
}

export interface LiveUplink {
  devEui: string;
  name: string;
  receivedAt: string;
  fCnt: number | null;
  fPort: number | null;
  portLabel: string;
  payloadHex: string;
  object: Record<string, unknown>;
  rssi: number | null;
  snr: number | null;
  sf: number | null;
  gatewayId: string | null;
}

export const EVENT_TYPES = ['up', 'join', 'status', 'ack', 'txack', 'log', 'location', 'integration'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export class Ingestor extends EventEmitter {
  constructor(private readonly store: Store) {
    super();
  }

  handle(event: string, body: unknown): { ok: true; duplicate?: boolean } {
    if (!body || typeof body !== 'object' || !('deviceInfo' in body)) {
      throw new BadEvent('missing deviceInfo');
    }
    const ev = body as { deviceInfo: DeviceInfo; time?: string };
    if (!ev.deviceInfo?.devEui || !/^[0-9a-fA-F]{16}$/.test(ev.deviceInfo.devEui)) {
      throw new BadEvent('deviceInfo.devEui must be 16 hex characters');
    }
    const devEui = ev.deviceInfo.devEui.toLowerCase();
    const info = { ...ev.deviceInfo, devEui };
    this.store.ensureMeter({
      devEui,
      name: info.deviceName,
      applicationId: info.applicationId,
      deviceProfile: info.deviceProfileName,
      tags: info.tags,
    });

    switch (event) {
      case 'up':
        return this.uplink({ ...(body as UplinkEvent), deviceInfo: info });
      case 'join':
        return this.join(info, body as { devAddr?: string; time?: string });
      case 'status':
        return this.status(info, body as StatusEvent);
      default:
        this.logEvent(devEui, event, ev.time, body);
        return { ok: true };
    }
  }

  private uplink(ev: UplinkEvent) {
    const s = this.store;
    const devEui = ev.deviceInfo.devEui;
    const receivedAt = ev.time ? new Date(ev.time).toISOString() : new Date().toISOString();
    const bytes = ev.data ? Buffer.from(ev.data, 'base64') : Buffer.alloc(0);
    const fPort = ev.fPort ?? null;

    // Prefer what ChirpStack decoded with the device-profile codec; fall back to
    // running the same codec here (e.g. if the profile has no codec yet).
    const object =
      ev.object && Object.keys(ev.object).length ? ev.object : fPort != null ? decodeLocally(bytes, fPort) : {};
    const n = normalise(object);

    const best = [...(ev.rxInfo ?? [])].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999))[0];
    const rssi = best?.rssi ?? null;
    const snr = best?.snr ?? null;
    const gatewayId = best?.gatewayId?.toLowerCase() ?? null;
    const sf = ev.txInfo?.modulation?.lora?.spreadingFactor ?? null;

    let duplicate = false;
    s.tx(() => {
      const res = s.run(
        `INSERT INTO uplinks (deduplication_id, received_at, dev_eui, f_cnt, f_port, payload_hex, object_json, decoded,
                              rssi, snr, sf, dr, frequency_hz, gateway_id, gateway_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (deduplication_id) DO NOTHING`,
        ev.deduplicationId ?? null,
        receivedAt,
        devEui,
        ev.fCnt ?? null,
        fPort,
        bytes.toString('hex'),
        JSON.stringify(object),
        object.decoded === true ? 1 : 0,
        rssi,
        snr,
        sf,
        ev.dr ?? null,
        ev.txInfo?.frequency ?? null,
        gatewayId,
        ev.rxInfo?.length ?? 0,
      );
      if (res.changes === 0) {
        duplicate = true;
        return;
      }

      s.run(
        `UPDATE meters SET
           last_seen_at = CASE WHEN last_seen_at IS NULL OR last_seen_at < ?1 THEN ?1 ELSE last_seen_at END,
           dev_addr = COALESCE(?2, dev_addr),
           last_f_cnt = ?3, last_f_port = ?4, last_rssi = ?5, last_snr = ?6, last_sf = ?7, last_gateway_id = ?8,
           register_l = COALESCE(?9, register_l), flow_lph = COALESCE(?10, flow_lph),
           credit_l = COALESCE(?11, credit_l), battery_pct = COALESCE(?12, battery_pct),
           battery_v = COALESCE(?13, battery_v), valve = COALESCE(?14, valve), last_object = ?15
         WHERE dev_eui = ?16`,
        receivedAt,
        ev.devAddr ?? null,
        ev.fCnt ?? null,
        fPort,
        rssi,
        snr,
        sf,
        gatewayId,
        n.registerL,
        n.flowLph,
        n.creditL,
        n.batteryPct,
        n.batteryV,
        n.valve,
        JSON.stringify(object),
        devEui,
      );

      // SH meters pack older hourly records into one uplink: store each as a reading,
      // back-dated by its hours_ago from the time the uplink was received.
      const history = Array.isArray(object.history) ? (object.history as Record<string, unknown>[]) : [];
      for (const rec of history) {
        const h = normalise(rec);
        const hoursAgo = typeof rec.hours_ago === 'number' ? rec.hours_ago : null;
        if (hoursAgo == null || (h.registerL == null && h.flowLph == null && h.creditL == null)) continue;
        s.run(
          `INSERT INTO readings (dev_eui, read_at, register_l, flow_lph, credit_l, reading_type, uplink_f_cnt)
           VALUES (?, ?, ?, ?, ?, 'history', ?) ON CONFLICT (dev_eui, read_at) DO NOTHING`,
          devEui,
          new Date(Date.parse(receivedAt) - hoursAgo * 3600_000).toISOString(),
          h.registerL,
          h.flowLph,
          h.creditL,
          ev.fCnt ?? null,
        );
      }

      if (n.registerL != null || n.flowLph != null || n.creditL != null) {
        s.run(
          `INSERT INTO readings (dev_eui, read_at, register_l, flow_lph, credit_l, reading_type, uplink_f_cnt)
           VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dev_eui, read_at) DO NOTHING`,
          devEui,
          receivedAt,
          n.registerL,
          n.flowLph,
          n.creditL,
          n.readingType ?? (fPort === 60 ? 'midnight' : 'live'),
          ev.fCnt ?? null,
        );
      }

      for (const alarm of n.alarms) {
        const open = s.get(
          `SELECT id FROM alarms WHERE dev_eui = ? AND alarm_type = ? AND cleared_at IS NULL`,
          devEui,
          alarm,
        );
        if (!open) {
          s.run(
            `INSERT INTO alarms (dev_eui, alarm_type, raised_at, f_cnt) VALUES (?, ?, ?, ?)`,
            devEui,
            alarm,
            receivedAt,
            ev.fCnt ?? null,
          );
        }
      }
    });

    if (!duplicate) {
      const live: LiveUplink = {
        devEui,
        name: ev.deviceInfo.deviceName ?? devEui,
        receivedAt,
        fCnt: ev.fCnt ?? null,
        fPort,
        portLabel: portLabel(fPort),
        payloadHex: bytes.toString('hex'),
        object,
        rssi,
        snr,
        sf,
        gatewayId,
      };
      this.emit('uplink', live);
    }
    return { ok: true as const, duplicate };
  }

  private join(info: DeviceInfo, ev: { devAddr?: string; time?: string }) {
    const at = ev.time ? new Date(ev.time).toISOString() : new Date().toISOString();
    this.store.run(
      `UPDATE meters SET dev_addr = COALESCE(?, dev_addr), joined_at = ?,
         last_seen_at = CASE WHEN last_seen_at IS NULL OR last_seen_at < ?2 THEN ?2 ELSE last_seen_at END
       WHERE dev_eui = ?`,
      ev.devAddr ?? null,
      at,
      info.devEui,
    );
    this.logEvent(info.devEui, 'join', at, ev);
    this.emit('device', { devEui: info.devEui, event: 'join', at, devAddr: ev.devAddr ?? null });
    return { ok: true as const };
  }

  private status(info: DeviceInfo, ev: StatusEvent) {
    const at = ev.time ? new Date(ev.time).toISOString() : new Date().toISOString();
    const battery = ev.externalPowerSource || ev.batteryLevelUnavailable ? null : (ev.batteryLevel ?? null);
    this.store.run(
      `UPDATE meters SET battery_pct = COALESCE(?, battery_pct), margin = COALESCE(?, margin) WHERE dev_eui = ?`,
      battery,
      ev.margin ?? null,
      info.devEui,
    );
    this.logEvent(info.devEui, 'status', at, ev);
    this.emit('device', { devEui: info.devEui, event: 'status', at, batteryPct: battery, margin: ev.margin ?? null });
    return { ok: true as const };
  }

  private logEvent(devEui: string, event: string, time: string | undefined, body: unknown) {
    this.store.run(
      `INSERT INTO device_events (dev_eui, event, at, body_json) VALUES (?, ?, ?, ?)`,
      devEui,
      event,
      time ? new Date(time).toISOString() : new Date().toISOString(),
      JSON.stringify(body),
    );
  }
}

interface StatusEvent {
  time?: string;
  margin?: number;
  externalPowerSource?: boolean;
  batteryLevelUnavailable?: boolean;
  batteryLevel?: number;
}

export class BadEvent extends Error {}
