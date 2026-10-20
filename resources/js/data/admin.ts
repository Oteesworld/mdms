/* Reports, settings and customer-portal fixtures. */

export const REPORTS: { name: string; desc: string; formats: string[] }[] = [
  { name: 'Sales report', desc: 'Revenue by channel, vendor, suburb and tariff band with VAT split.', formats: ['PDF', 'XLSX', 'CSV'] },
  { name: 'Water usage report', desc: 'Metered volume per suburb, client class and meter, with variance flags.', formats: ['PDF', 'XLSX'] },
  { name: 'Negative credit', desc: 'Meters trading below zero balance, ranked by exposure and age.', formats: ['PDF', 'CSV'] },
  { name: 'Daily report', desc: 'Yesterday: sales, tokens, uplinks, alarms and failed vends.', formats: ['PDF'] },
  { name: 'Weekly report', desc: 'Seven-day rollup with week-on-week movement per zone.', formats: ['PDF', 'XLSX'] },
  { name: 'Monthly report', desc: 'Board pack: revenue, volume, losses, network availability.', formats: ['PDF', 'PPTX'] },
  { name: 'Bypass & tamper', desc: 'Suspected bypass list with risk score and inspection outcome.', formats: ['PDF', 'CSV'] },
  { name: 'Network health', desc: 'Gateway availability, packet loss, SF spread, unseen nodes.', formats: ['PDF', 'CSV'] },
  { name: 'Data quality (VEE)', desc: 'Completeness, validation failures, estimates and manual edits by zone.', formats: ['PDF', 'CSV'] },
  { name: 'Vending reconciliation', desc: 'Provider settlement vs tokens issued, with unmatched entries.', formats: ['XLSX', 'CSV'] },
];

export type JobStatus = 'Ready' | 'Queued' | 'Failed';

export const GENERATED: [name: string, range: string, by: string, status: JobStatus][] = [
  ['Monthly report · July 2026', '1–31 Jul 2026', 'l.kgosi', 'Ready'],
  ['Sales report · Gaborone zones', '1–18 Aug 2026', 'm.tau', 'Ready'],
  ['Negative credit exposure', 'as at 18 Aug 2026', 'finance.bot', 'Ready'],
  ['Water usage · Block 8', '1 Jun – 18 Aug 2026', 'k.moloi', 'Queued'],
  ['Bypass & tamper weekly', '11–17 Aug 2026', 'scheduler', 'Ready'],
  ['Vending reconciliation', '1–17 Aug 2026', 'finance.bot', 'Failed'],
  ['Network health', '12–19 Aug 2026', 'noc.ops', 'Ready'],
  ['Daily report', '18 Aug 2026', 'scheduler', 'Ready'],
];

export const SCHEDULES: [name: string, cron: string, to: string, on: boolean][] = [
  ['Daily sales digest', '06:00 daily', 'revenue@wuc.co.bw', true],
  ['Weekly zone rollup', 'Mon 07:00', 'ops@wuc.co.bw', true],
  ['Monthly board pack', '1st 08:00', 'exec@wuc.co.bw', true],
  ['Negative credit sweep', 'Wed 05:30', 'credit@wuc.co.bw', false],
  ['Network health', '04:00 daily', 'noc@amplifiediot.co.bw', true],
];

export const MODULES: [name: string, desc: string, meta: string, enabled: boolean][] = [
  ['Prepaid vending', 'Token generation, STS meters, counter and online channels.', '3 providers connected', true],
  ['LoRaWAN network server', 'Uplink decoding, ADR, downlink queue, gateway registry.', '6 gateways · ChirpStack', true],
  ['Bypass detection', 'Nightly anomaly detector over midnight and live-data ports.', 'Last run 03:20', true],
  ['Validation & estimation (VEE)', 'Rule engine that flags, estimates and audits interval reads before they are used.', '12 rules · 1,653 open exceptions', true],
  ['Vending integration', 'Meter validation API the external vending system calls before issuing STS tokens.', '18,402 checks today · 97.1% approved', true],
  ['Bulk meter balancing', 'District metered areas: bulk vs sub-meter reconciliation.', '38 DMAs configured', true],
  ['Customer portal', 'Self-service usage, purchases and fault logging.', '18,402 registered', true],
  ['Leak advisories', 'Continuous-flow detection with SMS notification.', 'SMS gateway: Orange', true],
  ['Debt management', 'Arrears ageing, payment plans, restriction workflow.', 'Not configured', false],
  ['Field work orders', 'Technician dispatch, inspection outcomes, photo capture.', 'Pilot · Block 8', true],
  ['Government billing', 'Vote-based consolidated invoicing for ministries.', '11 ministries', false],
];

export const PURCHASES: [date: string, token: string, channel: string, units: string, amount: string][] = [
  ['18 Aug 2026, 14:22', '4823 7719 0042 1188', 'Orange Money', '5,000 L', 'P 50.00'],
  ['04 Aug 2026, 09:10', '1902 5561 8830 4477', 'Portal card', '10,000 L', 'P 100.00'],
  ['21 Jul 2026, 17:45', '7741 2093 5518 6620', 'Counter · CBD', '10,000 L', 'P 100.00'],
  ['06 Jul 2026, 11:03', '3390 8842 1176 9054', 'Orange Money', '5,000 L', 'P 50.00'],
  ['19 Jun 2026, 16:31', '8812 3374 9902 5518', 'Portal card', '20,000 L', 'P 200.00'],
  ['02 Jun 2026, 08:57', '5527 6610 3348 8871', 'Counter · Block 8', '10,000 L', 'P 100.00'],
  ['14 May 2026, 13:12', '9903 1182 7745 2260', 'Orange Money', '5,000 L', 'P 50.00'],
];

/** Shared status-badge palette: [text colour, background]. */
export const BADGE: Record<string, [string, string]> = {
  Active: ['#237A48', '#E6F2EA'],
  Arrears: ['#B3261E', '#FAE8E6'],
  Suspended: ['#49515C', '#F0F2F4'],
  Verified: ['#237A48', '#E6F2EA'],
  Pending: ['#965A00', '#FAF0DC'],
  Expired: ['#B3261E', '#FAE8E6'],
  Online: ['#237A48', '#E6F2EA'],
  Offline: ['#B3261E', '#FAE8E6'],
  'Low batt': ['#965A00', '#FAF0DC'],
  Degraded: ['#965A00', '#FAF0DC'],
  Ready: ['#237A48', '#E6F2EA'],
  Queued: ['#965A00', '#FAF0DC'],
  Failed: ['#B3261E', '#FAE8E6'],
  ONLINE: ['#237A48', '#E6F2EA'],
  DEGRADED: ['#965A00', '#FAF0DC'],
  OFFLINE: ['#B3261E', '#FAE8E6'],
};
