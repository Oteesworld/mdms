// Loads codec/water-meter.js (the same codec ChirpStack runs) and turns a
// decoded object into the normalised values the dashboard stores.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const CODEC_PATH = fileURLToPath(new URL('../codec/water-meter.js', import.meta.url));

export interface Codec {
  decodeUplink(input: { bytes: number[]; fPort: number; variables?: Record<string, string> }): {
    data?: Record<string, unknown>;
    warnings?: string[];
    errors?: string[];
  };
  PORTS: Record<number, { name: string; label: string; alarm?: string; reading?: string }>;
}

export function codecSource(): string {
  return readFileSync(CODEC_PATH, 'utf8');
}

export function loadCodec(source = codecSource()): Codec {
  const sandbox = { module: { exports: {} as Codec } };
  vm.runInNewContext(source, sandbox, { filename: 'water-meter.js', timeout: 1000 });
  return sandbox.module.exports;
}

let codec: Codec | undefined;
function getCodec(): Codec {
  return (codec ??= loadCodec());
}

export function portLabel(port: number | null | undefined): string {
  if (port == null) return '';
  return getCodec().PORTS[port]?.label ?? `Port ${port}`;
}

export function decodeLocally(bytes: Uint8Array, fPort: number): Record<string, unknown> {
  try {
    const res = getCodec().decodeUplink({ bytes: Array.from(bytes), fPort });
    return { ...(res.data ?? {}), ...(res.errors?.length ? { _errors: res.errors } : {}) };
  } catch (e) {
    return { port: fPort, raw_hex: Buffer.from(bytes).toString('hex'), decoded: false, _errors: [String(e)] };
  }
}

/** Values the dashboard understands, pulled out of a decoded object. */
export interface Normalised {
  registerL: number | null;
  flowLph: number | null;
  creditL: number | null;
  batteryPct: number | null;
  batteryV: number | null;
  valve: 'open' | 'closed' | null;
  readingType: string | null;
  alarms: string[];
}

const ALARM_FLAGS = ['tamper', 'burst', 'leak', 'reverse_flow', 'magnetic', 'low_battery'] as const;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function normalise(obj: Record<string, unknown>): Normalised {
  const alarms = new Set<string>();
  if (typeof obj.alarm === 'string') alarms.add(obj.alarm);
  for (const flag of ALARM_FLAGS) if (obj[flag] === true) alarms.add(flag);
  const valve = obj.valve === 'open' || obj.valve === 'closed' ? obj.valve : null;
  return {
    registerL: num(obj.register_l) ?? num(obj.volume_l),
    flowLph: num(obj.flow_lph),
    creditL: num(obj.credit_l) ?? num(obj.balance),
    batteryPct: num(obj.battery_pct),
    batteryV: num(obj.battery_v),
    valve,
    readingType: typeof obj.reading_type === 'string' ? obj.reading_type : null,
    alarms: [...alarms],
  };
}
