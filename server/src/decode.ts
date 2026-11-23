// Loads the per-model payload codecs (the same scripts ChirpStack runs) and turns a
// decoded object into the normalised values the dashboard stores.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { config } from './config.js';
import { MODELS, type ModelKey } from './models.js';

export const CODEC_DIR = fileURLToPath(new URL('../codec/', import.meta.url));

export interface Codec {
  decodeUplink(input: { bytes: number[]; fPort: number; variables?: Record<string, string> }): {
    data?: Record<string, unknown>;
    warnings?: string[];
    errors?: string[];
  };
  /** Port labels; optional (the vendor Honeywell codec has none). */
  PORTS?: Record<number, { name: string; label: string; alarm?: string; reading?: string }>;
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
  return MODELS[model].portLabels?.[port] ?? getCodec(model).PORTS?.[port]?.label ?? getCodec('sh').PORTS?.[port]?.label ?? `Port ${port}`;
}

/** UTC offset of the dashboard time zone now, in minutes (GMT+2 = 120). */
export function tzOffsetMin(): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  const now = new Date();
  now.setUTCSeconds(0, 0);
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - now.getTime()) / 60000);
}

export function decodeLocally(bytes: Uint8Array, fPort: number, model?: ModelKey | null): Record<string, unknown> {
  const m = model ?? guessModel(bytes, fPort);
  try {
    const variables = MODELS[m].variables?.(tzOffsetMin());
    const res = getCodec(m).decodeUplink({ bytes: Array.from(bytes), fPort, variables });
    const data: Record<string, unknown> = { ...(res.data ?? {}), ...(res.errors?.length ? { _errors: res.errors } : {}) };
    return m === 'honeywell' ? withHoneywellFields(data, fPort) : data;
  } catch (e) {
    return { port: fPort, raw_hex: Buffer.from(bytes).toString('hex'), decoded: false, _errors: [String(e)] };
  }
}

/**
 * Adds the dashboard's normalised names to a Honeywell vendor-codec result, keeping
 * every vendor field. Readings and balance are in 0.1 L, as the codec documents for
 * the top-up amount (spec V0.1.8: "0.1 L"); confirm against the meter display.
 */
export function withHoneywellFields(d: Record<string, unknown>, fPort: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...d, model: 'honeywell', port: fPort };
  out.message_label = MODELS.honeywell.portLabels?.[fPort] ?? `Port ${fPort}`;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (fPort !== 10) return { ...out, decoded: !d._errors };
  const reading = num(d.currentReading);
  const balance = num(d.remainingBalance);
  if (reading !== null) {
    out.register_l = Math.round(reading * 10) / 100; // 0.1 L -> L
    out.totalFlow = Math.round(reading * 100) / 1e6; // 0.1 L -> m3
  }
  if (balance !== null) out.credit_l = Math.round(balance * 10) / 100;
  const comm = num(d.communicationBoardVoltage);
  if (comm !== null) out.battery_v = comm;
  const temp = num(d.waterTemperature);
  if (temp !== null) out.temperature_c = temp;
  const valve = d.valve as { openPercentage?: number | null; fault?: boolean; leakFault?: boolean } | undefined;
  if (valve) out.valve_state = valve; // vendor object: openPercentage, fault, leakFault
  if (valve && typeof valve.openPercentage === 'number') {
    out.valve_open_pct = valve.openPercentage;
    out.valve = valve.openPercentage > 0 ? 'open' : 'closed';
  }
  // Vendor alarm flags -> the dashboard's alarm names.
  if (d.magneticInterference === true) out.magnetic = true;
  if (d.lowVoltageLevel1 === true || d.lowVoltageLevel2 === true || d.meterLowVoltageL1 === true || d.meterLowVoltageL2 === true) out.low_battery = true;
  if (d.reverseFlowDetected === true || d.severeReverseFlow === true) out.reverse_flow = true;
  if (d.meterDataTamper === true || d.meterRemoved === true) out.tamper = true;
  if (valve?.leakFault === true) out.leak = true;
  // The vendor "history" holds per-period consumption, not the SH hourly records.
  if (Array.isArray(d.history)) {
    out.usage_history = d.history;
    delete out.history;
  }
  out.decoded = !d._errors;
  return out;
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
