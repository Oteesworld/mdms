/* Meter data management: pipeline, VEE, billing and field operations fixtures. */
import { BIZ, CLIENT_NAMES, GOVT, SUBS_SHORT } from './clients';
import { SUBURBS } from './fleet';
import { rnd } from './format';

/* ---------- Pipeline (collect → store → validate → analyse → VEE → report → bill) ---------- */

export const FLEET = 50412;
/** Hourly interval reads expected per day (port 60 midnight profile carries 24 intervals). */
export const EXPECTED = FLEET * 24;
export const RECEIVED = 1165122;
export const PASSED = 1139489;
export const AUTO_ESTIMATED = 23980;
export const OPEN_EXCEPTIONS = 1653;

export interface Stage {
  key: string;
  name: string;
  value: string;
  sub: string;
  state: 'ok' | 'warn' | 'bad';
  screen?: string;
}

export const STAGES: Stage[] = [
  { key: 'collect', name: 'Collect data', value: '96.3%', sub: '1,165,122 of 1,209,888 intervals', state: 'ok', screen: 'network' },
  { key: 'store', name: 'Data storage', value: '2.91 B', sub: 'interval rows · 1.84 TB', state: 'ok' },
  { key: 'validate', name: 'Validating data', value: '97.8%', sub: 'passed first-pass rules', state: 'ok', screen: 'vee' },
  { key: 'analyze', name: 'Analyze data', value: '1,164', sub: 'bypass suspects · 212 leaks', state: 'warn', screen: 'dash' },
  { key: 'vee', name: 'VEE analytics', value: '1,653', sub: 'exceptions awaiting review', state: 'warn', screen: 'vee' },
  { key: 'report', name: 'Reporting', value: '8', sub: 'reports today · 1 failed', state: 'warn', screen: 'reports' },
  { key: 'bill', name: 'Bill issuance', value: '99.4%', sub: 'accounts billing-ready', state: 'ok', screen: 'billing' },
];

/** Interval reads received vs passing validation, per hour today (thousands). */
export const HOURLY = (() => {
  const r = rnd(1309);
  return Array.from({ length: 24 }, (_, h) => {
    const received = 46 + r() * 4 - (h === 3 ? 9 : 0) - (h === 11 ? 5 : 0);
    const passed = received * (0.965 + r() * 0.025);
    return { h, received: Math.round(received * 10) / 10, passed: Math.round(passed * 10) / 10 };
  });
})();

export interface ZoneQuality {
  zone: string;
  meters: number;
  completeness: number;
  valid: number;
  estimated: number;
  gaps: number;
}

export const ZONE_QUALITY: ZoneQuality[] = SUBURBS.slice()
  .sort((a, b) => b.metersN - a.metersN)
  .slice(0, 10)
  .map((s, i) => {
    const r = rnd(4400 + i);
    const completeness = s.name === 'Old Naledi' ? 71.4 : Math.round((94 + r() * 5.8) * 10) / 10;
    return {
      zone: s.name,
      meters: s.metersN,
      completeness,
      valid: Math.round((96 + r() * 3.6) * 10) / 10,
      estimated: Math.round((0.4 + r() * 2.2 + (100 - completeness) / 10) * 10) / 10,
      gaps: Math.round(s.metersN * (100 - completeness) / 100 * 24 * 0.3),
    };
  });

export const RETENTION: [data: string, store: string, keep: string, size: string][] = [
  ['Raw uplinks (encrypted payloads)', 'Object storage', '13 months', '612 GB'],
  ['Hourly interval reads', 'TimescaleDB · hot', '24 months', '884 GB'],
  ['Daily register reads', 'TimescaleDB · compressed', '10 years', '196 GB'],
  ['Events & alarms', 'PostgreSQL', 'Indefinite', '41 GB'],
  ['VEE audit trail', 'PostgreSQL · append-only', 'Indefinite', '3.2 GB'],
];

export const INTEGRATIONS: [name: string, target: string, last: string, status: 'Ready' | 'Queued' | 'Failed'][] = [
  ['Billing-ready reads', 'Postpaid billing', '13:00 · 2,096 accounts', 'Ready'],
  ['Token sales ledger', 'STS vending', 'Live', 'Ready'],
  ['General ledger postings', 'Finance ERP', '06:00 · 1,912 lines', 'Ready'],
  ['Meter & pipe layer', 'GIS', '02:00 · 50,412 points', 'Ready'],
  ['DMA balance', 'Bulk meter balancing', '13:00', 'Queued'],
  ['Customer usage feed', 'Customer portal', '12:58', 'Ready'],
];

/* ---------- VEE ---------- */

export interface Rule {
  name: string;
  kind: 'Validation' | 'Estimation';
  desc: string;
  param: string;
  hits: number;
  on: boolean;
}

export const RULES: Rule[] = [
  { name: 'Missing interval', kind: 'Validation', desc: 'No reading received for an expected hour.', param: 'grace 2 h', hits: 44766, on: true },
  { name: 'High consumption spike', kind: 'Validation', desc: 'Hourly volume far above the meter’s own 30-day profile.', param: '> 5 × p95', hits: 3120, on: true },
  { name: 'Register rollback', kind: 'Validation', desc: 'Cumulative index lower than the previous read.', param: 'any decrease', hits: 412, on: true },
  { name: 'Reverse flow', kind: 'Validation', desc: 'Backflow volume reported by the meter.', param: '> 5 L / h', hits: 188, on: true },
  { name: 'Zero consumption, active account', kind: 'Validation', desc: 'Valve open and credit available but no flow.', param: '7 days', hits: 1306, on: true },
  { name: 'Continuous night flow', kind: 'Validation', desc: 'Flow never drops to zero between 01:00 and 05:00 — likely leak.', param: '> 10 L / h', hits: 212, on: true },
  { name: 'Clock drift', kind: 'Validation', desc: 'Meter timestamp differs from network server time.', param: '> 5 min', hits: 96, on: true },
  { name: 'Duplicate reading', kind: 'Validation', desc: 'Same frame counter received twice via two gateways.', param: 'FCnt match', hits: 19544, on: true },
  { name: 'Tamper-coincident read', kind: 'Validation', desc: 'Reading in the same hour as a port 65 tamper alarm.', param: '± 1 h', hits: 74, on: false },
  { name: 'Linear interpolation', kind: 'Estimation', desc: 'Fill short gaps between two good register reads.', param: 'gaps ≤ 6 h', hits: 21880, on: true },
  { name: 'Historical profile', kind: 'Estimation', desc: 'Same weekday average from the last four weeks.', param: 'gaps ≤ 7 d', hits: 2100, on: true },
  { name: 'Zero fill, valve closed', kind: 'Estimation', desc: 'Record zero while the valve is confirmed closed.', param: 'valve state', hits: 1340, on: true },
];

export type ExceptionStatus = 'Open' | 'Estimated' | 'Approved' | 'Rejected';

export interface VeeException {
  id: string;
  meter: string;
  client: string;
  zone: string;
  rule: string;
  period: string;
  raw: number | null;
  estimate: number;
  method: string;
  status: ExceptionStatus;
  /** 24 hourly litres for the flagged day; the flagged hour index. */
  profile: number[];
  flagged: number;
}

const EX_RULES: [rule: string, method: string][] = [
  ['High consumption spike', 'Historical profile'], ['Missing interval', 'Linear interpolation'], ['Register rollback', 'Historical profile'],
  ['Continuous night flow', 'No estimate — inspect'], ['Missing interval', 'Linear interpolation'], ['Reverse flow', 'Historical profile'],
  ['Zero consumption, active account', 'Historical profile'], ['High consumption spike', 'Historical profile'], ['Missing interval', 'Historical profile'],
  ['Clock drift', 'Re-timestamp'], ['Register rollback', 'Historical profile'], ['Continuous night flow', 'No estimate — inspect'],
];

export const EXCEPTIONS: VeeException[] = EX_RULES.map(([rule, method], i) => {
  const r = rnd(7700 + i);
  const flagged = rule === 'Continuous night flow' ? 3 : 6 + Math.floor(r() * 14);
  const base = Array.from({ length: 24 }, (_, h) => {
    const shape = h < 5 ? 0.15 : h < 9 ? 1.6 : h < 17 ? 0.8 : h < 21 ? 1.3 : 0.5;
    return Math.round(18 * shape * (0.7 + r() * 0.6) + (rule === 'Continuous night flow' && h < 6 ? 34 : 0));
  });
  const estimate = base[flagged];
  const raw =
    rule === 'Missing interval' ? null
      : rule === 'High consumption spike' ? estimate * 9 + 140
        : rule === 'Register rollback' ? -Math.round(80 + r() * 300)
          : rule === 'Reverse flow' ? -Math.round(12 + r() * 30)
            : rule === 'Zero consumption, active account' ? 0
              : rule === 'Clock drift' ? estimate
                : estimate + 34;
  const profile = base.slice();
  if (raw !== null) profile[flagged] = raw;
  return {
    id: 'VX-' + (88120 + i * 7),
    meter: 'WM-' + (104000 + i * 91),
    client: CLIENT_NAMES[i % CLIENT_NAMES.length],
    zone: SUBS_SHORT[i % SUBS_SHORT.length],
    rule,
    period: (i % 3 === 0 ? '18' : '19') + ' Aug, ' + String(flagged).padStart(2, '0') + ':00',
    raw,
    estimate: rule === 'Continuous night flow' ? base[flagged] - 34 : estimate,
    method,
    status: i === 4 ? 'Estimated' : 'Open',
    profile,
    flagged,
  };
});

export interface AuditEntry {
  t: string;
  who: string;
  what: string;
  reason: string;
}

export const AUDIT_SEED: AuditEntry[] = [
  { t: '12:41', who: 'k.moloi', what: 'VX-88085 · WM-104637 · 412 L → 38 L', reason: 'Spike confirmed as meter fault after site visit' },
  { t: '11:58', who: 'vee.engine', what: 'VX-88148 · WM-104364 · gap → 22 L', reason: 'Linear interpolation (auto)' },
  { t: '10:20', who: 'm.tau', what: 'VX-88071 · WM-105184 · rejected', reason: 'Register rollback — meter swap not recorded; WO raised' },
  { t: '09:02', who: 'vee.engine', what: '23,980 intervals estimated', reason: 'Nightly batch, rules v12' },
];

/* ---------- Billing ---------- */

export const BILL_STEPS = ['Read cut-off', 'VEE complete', 'Rate & tariff', 'Review', 'Issue bills', 'Post to ledger'];

export const TARIFFS: [band: string, applies: string, rate: string, fixed: string][] = [
  ['Domestic band 1', '0 – 5 kL / month', 'P 3.58 / kL', 'P 0.00'],
  ['Domestic band 2', '5 – 15 kL', 'P 10.21 / kL', 'P 0.00'],
  ['Domestic band 3', '15 – 25 kL', 'P 19.87 / kL', 'P 0.00'],
  ['Domestic band 4', 'above 25 kL', 'P 27.66 / kL', 'P 0.00'],
  ['Business', 'flat', 'P 21.40 / kL', 'P 45.00'],
  ['Government', 'flat, vote-billed', 'P 19.50 / kL', 'P 45.00'],
  ['Bulk / DMA', 'per bulk meter', 'P 14.05 / kL', 'P 210.00'],
];

export const VAT_RATE = 0.14;

export type InvoiceStatus = 'Draft' | 'Held' | 'Issued' | 'Paid' | 'Overdue';

export interface Invoice {
  no: string;
  account: string;
  name: string;
  kind: 'Business' | 'Government';
  kl: number;
  amountExcl: number;
  readQuality: 'Actual' | 'Estimated' | 'Exception';
  status: InvoiceStatus;
  due: string;
}

export const INVOICES: Invoice[] = [
  ...BIZ.filter((_, i) => i % 3 !== 0).map((b, j): Invoice => {
    const i = BIZ.indexOf(b);
    const r = rnd(5100 + i);
    const kl = Math.round(400 + r() * 8600);
    return {
      no: 'INV-2607-' + String(1201 + j * 3), account: 'BUS-' + (30140 + i * 23), name: b[0], kind: 'Business', kl,
      amountExcl: Math.round((kl * 21.4 + 45) * 100) / 100,
      readQuality: i === 2 ? 'Exception' : i === 7 ? 'Estimated' : 'Actual',
      status: i === 2 ? 'Held' : 'Draft', due: '15 Sep 2026',
    };
  }),
  ...GOVT.slice(0, 6).map((g, i): Invoice => {
    const r = rnd(5300 + i);
    const kl = Math.round(1200 + r() * 18000);
    return {
      no: 'INV-2607-' + String(1301 + i * 3), account: g[0], name: g[2], kind: 'Government', kl,
      amountExcl: Math.round((kl * 19.5 + 45) * 100) / 100,
      readQuality: i === 4 ? 'Estimated' : 'Actual', status: 'Draft', due: '15 Sep 2026',
    };
  }),
];

export const PREVIOUS_RUNS: [cycle: string, accounts: string, billed: string, collected: string, status: string][] = [
  ['Jun 2026', '2,091', 'P 3,412,880.10', '91.6%', 'Posted'],
  ['May 2026', '2,088', 'P 3,288,104.55', '97.2%', 'Posted'],
  ['Apr 2026', '2,079', 'P 3,140,662.00', '98.9%', 'Posted'],
];

/* ---------- Field operations ---------- */

export type WoStatus = 'New' | 'Assigned' | 'In progress' | 'Done';

export interface WorkOrder {
  id: string;
  type: string;
  target: string;
  zone: string;
  source: string;
  assignee: string;
  priority: 'High' | 'Medium' | 'Low';
  due: string;
  status: WoStatus;
}

export const TECHNICIANS = ['Kabelo Moloi', 'Amogelang Dube', 'Onkemetse Rapula', 'Kitso Sebina', 'Unassigned'];

export const WORK_ORDERS: WorkOrder[] = [
  { id: 'WO-31408', type: 'Gateway repair', target: 'GW-GAB-06', zone: 'Old Naledi', source: 'Network alarm', assignee: 'Kitso Sebina', priority: 'High', due: '19 Aug', status: 'In progress' },
  { id: 'WO-31407', type: 'Bypass inspection', target: 'WM-118920', zone: 'Old Naledi', source: 'Bypass detector', assignee: 'Kabelo Moloi', priority: 'High', due: '20 Aug', status: 'Assigned' },
  { id: 'WO-31405', type: 'Leak investigation', target: 'WM-104882', zone: 'Block 8', source: 'VEE · night flow', assignee: 'Kabelo Moloi', priority: 'Medium', due: '21 Aug', status: 'Assigned' },
  { id: 'WO-31402', type: 'Burst response', target: 'WM-104473', zone: 'Block 8', source: 'Port 66 alarm', assignee: 'Onkemetse Rapula', priority: 'High', due: '19 Aug', status: 'In progress' },
  { id: 'WO-31398', type: 'Meter swap record', target: 'WM-105184', zone: 'Block 10', source: 'VEE · rollback', assignee: 'Unassigned', priority: 'Medium', due: '22 Aug', status: 'New' },
  { id: 'WO-31391', type: 'Battery replacement', target: '14 meters', zone: 'Phase 4', source: 'Low battery < 25%', assignee: 'Amogelang Dube', priority: 'Low', due: '28 Aug', status: 'New' },
  { id: 'WO-31387', type: 'Meter installation', target: 'Plot 22918', zone: 'Phakalane', source: 'New connection', assignee: 'Onkemetse Rapula', priority: 'Medium', due: '23 Aug', status: 'Assigned' },
  { id: 'WO-31380', type: 'Valve fault', target: 'WM-109331', zone: 'Tsholofelo', source: 'Command failed', assignee: 'Kitso Sebina', priority: 'Medium', due: '18 Aug', status: 'Done' },
  { id: 'WO-31377', type: 'Customer fault report', target: 'WM-110204', zone: 'Broadhurst', source: 'Customer portal', assignee: 'Amogelang Dube', priority: 'Low', due: '24 Aug', status: 'Done' },
];

export const COMMANDS = [
  'On-demand read',
  'Close valve',
  'Open valve',
  'Sync clock',
  'Set reporting interval · 1 h',
  'Push credit token',
] as const;
export type CommandType = (typeof COMMANDS)[number];

export type CommandStatus = 'Queued' | 'Sent' | 'Acknowledged' | 'Failed';

export interface Command {
  id: string;
  meter: string;
  cmd: CommandType;
  by: string;
  at: string;
  status: CommandStatus;
  note: string;
}

export const COMMAND_SEED: Command[] = [
  { id: 'DL-55120', meter: 'WM-104473', cmd: 'Close valve', by: 'k.moloi', at: '12:59', status: 'Acknowledged', note: 'Burst isolation · valve closed 13:00' },
  { id: 'DL-55118', meter: 'WM-112640', cmd: 'Push credit token', by: 'vending', at: '12:55', status: 'Sent', note: 'Awaiting next uplink (class A)' },
  { id: 'DL-55109', meter: 'WM-118920', cmd: 'On-demand read', by: 'm.tau', at: '12:31', status: 'Failed', note: 'No uplink in 30 min · GW-GAB-06 offline' },
  { id: 'DL-55102', meter: 'WM-109331', cmd: 'Open valve', by: 'credit.bot', at: '12:10', status: 'Acknowledged', note: 'Credit restored · valve open' },
  { id: 'DL-55097', meter: 'WM-104882', cmd: 'Sync clock', by: 'vee.engine', at: '11:48', status: 'Acknowledged', note: 'Drift 7 m 12 s corrected' },
];
