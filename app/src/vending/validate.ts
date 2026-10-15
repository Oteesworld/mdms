/*
 * Meter validation for the external vending system.
 *
 * Billing and STS token generation happen in the vending system. Before it issues
 * a token it asks this MDMS whether the meter may be vended against, and to whom.
 * This module is the single source of those rules: the in-app test console and the
 * /api/vending/validate serverless endpoint both call `validateMeter`.
 *
 * Imports use explicit .js extensions so the module also runs as native ESM in the
 * serverless function (TypeScript and Vite resolve them to the .ts sources).
 */
import { BIZ, CLIENT_NAMES, TABLES } from '../data/clients.js';
import { makeDevice } from '../data/device.js';

export type ValidationCode =
  | 'OK'
  | 'INVALID_FORMAT'
  | 'METER_NOT_FOUND'
  | 'ACCOUNT_SUSPENDED'
  | 'KYC_INCOMPLETE'
  | 'TAMPER_HOLD'
  | 'VENDING_NOT_PERMITTED'
  | 'PURCHASER_NOT_PERMITTED';

export interface ValidationRequest {
  /** Meter serial as printed on the meter, e.g. WM-104882. */
  meter: string;
  /** Who is buying: the occupant (tenant) or the property owner. Optional. */
  purchaser?: 'occupant' | 'owner';
  /** Amount the customer intends to pay, Pula incl. VAT. Optional, echoed back. */
  amount?: number;
  /** Vending system's own reference for this attempt. Optional, echoed back. */
  vendorRef?: string;
}

export interface ValidationRules {
  blockKycIncomplete: boolean;
  blockTamper: boolean;
  blockSuspended: boolean;
  /** Warn (not block) when the meter has been silent longer than this. */
  offlineWarnDays: number;
}

export const DEFAULT_RULES: ValidationRules = { blockKycIncomplete: true, blockTamper: true, blockSuspended: true, offlineWarnDays: 2 };

export interface ValidationResponse {
  result: 'APPROVED' | 'DECLINED';
  code: ValidationCode;
  message: string;
  meter?: { serial: string; devEui: string; status: 'online' | 'offline'; lastSeen: string; property: string };
  account?: {
    clientId: string;
    clientName: string;
    type: 'domestic' | 'business';
    owner: string;
    occupant: string;
    /** Who the MDMS allows to buy against this meter. */
    vendingParty: 'occupant' | 'owner' | 'none';
    kyc: string;
    status: string;
  };
  /** STS parameters the vending system needs to generate the token. */
  sts?: { supplyGroupCode: string; keyRevision: number; tariffIndex: string; tokenTech: string; algorithm: string };
  tariff?: { name: string; ratePerKl: number; vatRate: number };
  warnings: string[];
  request: { amount?: number; vendorRef?: string; purchaser?: string };
  validatedAt: string;
}

/* ---------- Meter index ---------- */

interface MeterRecord {
  serial: string;
  plot: string;
  balance: number;
  clientId: string;
  clientName: string;
  type: 'domestic' | 'business';
  owner: string;
  occupant: string;
  vendingParty: 'occupant' | 'owner' | 'none';
  kyc: string;
  status: string;
}

const cellText = (row: { v: string }[], head: [string, ('right' | undefined)?][], name: string) =>
  row[head.findIndex((h) => h[0] === name)]?.v;

let index: Map<string, MeterRecord> | null = null;

/** Every meter attached to a domestic or business client, keyed by serial. */
export function meterIndex(): Map<string, MeterRecord> {
  if (index) return index;
  const idx = new Map<string, MeterRecord>();
  index = idx;
  for (const type of ['domestic', 'business'] as const) {
    const cfg = TABLES[type];
    const rows = cfg.rows();
    rows.forEach((row, i) => {
      const k = cfg.kyc!(i);
      const kyc = cellText(row, cfg.head, 'KYC') ?? 'Verified';
      const status = cellText(row, cfg.head, 'Status') ?? 'Active';
      const tenantOf = type === 'domestic' ? CLIENT_NAMES[[0, 4, 7, 12][i % 4]] : BIZ[[1, 2, 10, 11][i % 4]][0];
      for (const p of k.props) {
        const isTenantClient = /^You \(/.test(p.tenant);
        const vacant = /^Vacant/.test(p.tenant);
        const ownerOperated = p.tenant === 'Owner-occupied' || p.tenant === 'Own operation';
        idx.set(p.meter, {
          serial: p.meter,
          plot: p.plot,
          balance: Number(p.bal.replace(/[P ,]/g, '')),
          clientId: k.id,
          clientName: k.name,
          type,
          owner: isTenantClient ? tenantOf : k.name,
          occupant: isTenantClient ? k.name : vacant ? '—' : ownerOperated ? k.name : p.tenant,
          vendingParty: p.vends === 'Tenant vends' ? 'occupant' : p.vends === 'No vending' ? 'none' : 'owner',
          kyc,
          status,
        });
      }
    });
  }
  return index;
}

/** A few real serials for the test console and docs. */
export function sampleMeters(): string[] {
  const all = [...meterIndex().keys()];
  return [all[0], all[1], all[5], all[3], all[30], all[all.length - 1]].filter(Boolean);
}

/* ---------- Validation ---------- */

const SERIAL = /^WM-\d{6}$/;

export function validateMeter(req: ValidationRequest, rules: ValidationRules = DEFAULT_RULES, now = new Date()): ValidationResponse {
  const serial = String(req.meter ?? '').trim().toUpperCase();
  const base = { warnings: [] as string[], request: { amount: req.amount, vendorRef: req.vendorRef, purchaser: req.purchaser }, validatedAt: now.toISOString() };
  const decline = (code: ValidationCode, message: string, extra: Partial<ValidationResponse> = {}): ValidationResponse => ({ ...base, ...extra, result: 'DECLINED', code, message });

  if (!SERIAL.test(serial)) return decline('INVALID_FORMAT', 'Meter number must look like WM- followed by six digits.');
  const m = meterIndex().get(serial);
  if (!m) return decline('METER_NOT_FOUND', `Meter ${serial} is not registered in the MDMS.`);

  const dev = makeDevice(serial, { plot: m.plot, business: m.type === 'business', balance: m.balance });
  const tamper = dev.alarms.some((a) => a.active && a.type === 'Magnetic tamper');
  const offlineDays = dev.online ? 0 : parseInt(dev.lastSeen, 10) || 0;

  const extra: Partial<ValidationResponse> = {
    meter: { serial, devEui: dev.devEui, status: dev.online ? 'online' : 'offline', lastSeen: dev.lastSeen, property: m.plot },
    account: { clientId: m.clientId, clientName: m.clientName, type: m.type, owner: m.owner, occupant: m.occupant, vendingParty: m.vendingParty, kyc: m.kyc, status: m.status },
  };

  if (rules.blockSuspended && m.status === 'Suspended') return decline('ACCOUNT_SUSPENDED', `Account ${m.clientId} is suspended. Refer the customer to the utility office.`, extra);
  if (rules.blockKycIncomplete && m.kyc !== 'Verified') return decline('KYC_INCOMPLETE', `KYC for ${m.clientName} is ${m.kyc.toLowerCase()}; vending is blocked until documents are verified.`, extra);
  if (rules.blockTamper && tamper) return decline('TAMPER_HOLD', 'An active magnetic tamper alarm is open on this meter. A field inspection must clear it first.', extra);
  if (m.vendingParty === 'none') return decline('VENDING_NOT_PERMITTED', 'The property is vacant and the owner has not enabled vending.', extra);
  if (req.purchaser && req.purchaser !== m.vendingParty) {
    return decline('PURCHASER_NOT_PERMITTED', `Only the ${m.vendingParty} may buy against this meter.`, extra);
  }

  const warnings: string[] = [];
  if (!dev.online && offlineDays >= rules.offlineWarnDays) warnings.push(`Meter has been offline ${dev.lastSeen.replace(' ago', '')}; a remote token will apply on its next uplink. Advise the customer to key it in.`);
  if (m.balance < 0) warnings.push(`Account is in arrears (P ${Math.abs(m.balance).toFixed(2)}); 25% of this purchase goes to debt recovery.`);
  if (dev.overview.battPct < 40) warnings.push(`Meter battery is at ${dev.overview.battPct}%; replacement is scheduled.`);

  const biz = m.type === 'business';
  return {
    ...base,
    ...extra,
    warnings,
    result: 'APPROVED',
    code: 'OK',
    message: `Meter ${serial} may be vended. Purchaser: ${m.vendingParty === 'occupant' ? m.occupant : m.owner} (${m.vendingParty}).`,
    sts: { supplyGroupCode: biz ? '600742' : '600741', keyRevision: 2, tariffIndex: biz ? '02' : '01', tokenTech: 'STS6 · numeric 20-digit', algorithm: 'EA07' },
    tariff: biz ? { name: 'Business', ratePerKl: 21.4, vatRate: 0.14 } : { name: 'Domestic block tariff', ratePerKl: 10.21, vatRate: 0.14 },
  };
}
