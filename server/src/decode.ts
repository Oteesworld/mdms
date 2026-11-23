// Loads the per-model payload codecs (the same scripts ChirpStack runs) and turns a
// decoded object into the normalised values the dashboard stores.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MODELS, type ModelKey } from './models.js';

export const CODEC_DIR = fileURLToPath(new URL('../codec/', import.meta.url));

export interface Codec {
  decodeUplink(input: { bytes: number[]; fPort: number; variables?: Record<string, string> }): {
    data?: Record<string, unknown>;
    warnings?: string[];
    errors?: string[];
  };
  PORTS: Record<number, { name: string; label: string; alarm?: string; reading?: string }>;
}

/** The complete ChirpStack codec script for a model (its files concatenated in order). */
export function codecSource(model: ModelKey = 'sh'): string {
  return MODELS[model].codecFiles.map((f) => readFileSync(CODEC_DIR + f, 'utf8')).join('\n');
}

export function loadCodec(source = codecSource()): Codec {
  const sandbox = { module: { exports: {} as Codec } };
  vm.runInNewContext(source, sandbox, { filename: 'codec.js', timeout: 1000 });
  return sandbox.module.exports;
}

const codecs = new Map<ModelKey, Codec>();
function getCodec(model: ModelKey): Codec {
  let c = codecs.get(model);
  if (!c) codecs.set(model, (c = loadCodec(codecSource(model))));
  return c;
}

/** Model to decode with when the device profile doesn't say: SH frames start with 0x68. */
function guessModel(bytes: Uint8Array, fPort: number): ModelKey {
  if (bytes.length >= 10 && bytes[0] === 0x68) return 'sh';
  if (fPort === 10 && bytes.length === 49) return 'honeywell';
  return 'sh';
}

export function portLabel(port: number | null | undefined, model: ModelKey = 'sh'): string {
  if (port == null) return '';
  return getCodec(model).PORTS[port]?.label ?? getCodec('sh').PORTS[port]?.label ?? `Port ${port}`;
}

export function decodeLocally(bytes: Uint8Array, fPort: number, model?: ModelKey | null): Record<string, unknown> {
  const m = model ?? guessModel(bytes, fPort);
  try {
    const res = getCodec(m).decodeUplink({ bytes: Array.from(bytes), fPort });
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
