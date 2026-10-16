/*
 * Every meter attached to a domestic or business client, built from the client fixtures.
 * The browser uses it for search and duplicate checks; `npm run fixtures` exports it (with
 * device state) to database/data/meters.json, which seeds the meters table that the
 * server-side vending validation reads.
 *
 * Imports use explicit .js extensions so the export script runs under plain Node ESM.
 */
import { BIZ, CLIENT_NAMES, TABLES } from './clients.js';

export interface MeterRecord {
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
