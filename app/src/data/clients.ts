/* Client, asset and site registers, including the owner → property → tenant model. */
import { BADGE, PURCHASES } from './admin';
import { GATEWAYS } from './fleet';
import { N, P, initials, rnd, short } from './format';

/* ---------- Cells ---------- */

export interface Cell {
  v: string;
  kind: 'text' | 'bold' | 'mono' | 'badge';
  color?: string;
  bg?: string;
  align?: 'left' | 'right';
}

interface CellOpts {
  color?: string;
  mono?: boolean;
  bold?: boolean;
  align?: 'left' | 'right';
}

const txt = (v: string, o: CellOpts = {}): Cell => ({
  v,
  kind: o.mono ? 'mono' : o.bold ? 'bold' : 'text',
  color: o.color ?? '#181D23',
  align: o.align ?? 'left',
});
const badge = (k: string): Cell => ({ v: k, kind: 'badge', color: BADGE[k][0], bg: BADGE[k][1], align: 'right' });

/* ---------- Ownership model ---------- */

export interface Property {
  plot: string;
  meter: string;
  tenant: string;
  vends: string;
  bal: string;
  tone: string;
}

export const CLIENT_NAMES = [
  'Mpho Sebego', 'Lesego Kgomotso', 'Thato Molefe', 'Boitumelo Ncube', 'Kagiso Mothibi', 'Neo Ramotswe', 'Tshepo Kwelagobe',
  'Dineo Motlhabane', 'Oratile Sekgoma', 'Basimane Tlhage', 'Refilwe Mogapi', 'Karabo Selepeng', 'Goitseone Mmereki', 'Tumelo Baruti',
];
export const SUBS_SHORT = [
  'Block 8', 'Phakalane', 'Block 9', 'Old Naledi', 'Broadhurst', 'Block 5', 'Tsholofelo', 'Phase 4', 'Bontleng', 'CBD', 'Block 10',
  'Kgale View', 'Block 3', 'Gaborone North',
];

/** Domestic client index → number of let properties. */
const LANDLORDS: Record<number, number> = { 0: 14, 4: 6, 7: 3, 12: 9 };
const TENANTS = [1, 3, 6, 9, 10, 13];
const TENANT_NAMES = [
  'Sethunya Mabiletsa', 'Onalenna Kgari', 'Bakang Pilane', 'Larona Segwabe', 'Mosarwa Kebonang', 'Wame Mokgethi', 'Thuso Rankgwe',
  'Kelebogile Motshegwa', 'Jimmy Odirile', 'Pearl Sekonopo', 'Tiro Mmolotsi', 'Chedza Gaboiphiwe', 'Mothusi Kalake', 'Lorato Bogosi',
];

type DomesticRole = 'Landlord' | 'Tenant' | 'Owner-occupier';
const roleOf = (i: number): DomesticRole => (LANDLORDS[i] ? 'Landlord' : TENANTS.includes(i) ? 'Tenant' : 'Owner-occupier');
const metersOf = (i: number) => LANDLORDS[i] || 1;

/** Properties and meters attached to a domestic client. */
export function domesticProperties(i: number): Property[] {
  const role = roleOf(i);
  const r = rnd(31 + i);
  if (role === 'Tenant') {
    return [{ plot: 'Plot ' + (12000 + i * 411) + ', ' + SUBS_SHORT[i], meter: 'WM-' + (104000 + i * 91), tenant: 'You (tenant)', vends: 'Tenant vends', bal: P(Math.round(r() * 300 * 100) / 100), tone: '#00468C' }];
  }
  if (role === 'Owner-occupier') {
    return [{ plot: 'Plot ' + (12000 + i * 411) + ', ' + SUBS_SHORT[i], meter: 'WM-' + (104000 + i * 91), tenant: 'Owner-occupied', vends: 'Owner vends', bal: P(Math.round(r() * 300 * 100) / 100), tone: '#767E89' }];
  }
  return Array.from({ length: Math.min(6, LANDLORDS[i]) }, (_, j) => {
    const bal = Math.round((r() * 380 - 90) * 100) / 100;
    const vacant = j === 4;
    return {
      plot: 'Plot ' + (9000 + i * 311 + j * 47) + ', ' + SUBS_SHORT[(i + j * 3) % SUBS_SHORT.length],
      meter: 'WM-' + (104000 + i * 91 + j * 7),
      tenant: vacant ? 'Vacant' : TENANT_NAMES[(i + j) % TENANT_NAMES.length],
      vends: vacant ? 'No vending' : 'Tenant vends',
      bal: P(bal),
      tone: vacant ? '#A1A8B2' : bal < 0 ? '#B3261E' : '#00468C',
    };
  });
}

const BIZ: [name: string, sector: string][] = [
  ['Choppies Broadhurst', 'Retail'], ['Riverwalk Mall', 'Property'], ['Kgale Hub Facilities', 'Property'], ['Sefalana Cash & Carry', 'Wholesale'],
  ['Botswana Breweries', 'Manufacturing'], ['Cresta Lodge Gaborone', 'Hospitality'], ['Debswana Corporate', 'Mining'], ['Bokamoso Private Hospital', 'Healthcare'],
  ['Gaborone Motors', 'Automotive'], ['Botswana Craft', 'Retail'], ['Fairgrounds Holdings', 'Events'], ['Sandalwood Apartments', 'Residential'],
];
/** Business index → number of lettable units. */
const BIZ_OWNERS: Record<number, number> = { 1: 22, 2: 14, 10: 9, 11: 26 };
const BIZ_TENANTS = [0, 5, 8, 9];
type BusinessRole = 'Property owner' | 'Tenant' | 'Owner-occupier';
const bizRole = (i: number): BusinessRole => (BIZ_OWNERS[i] ? 'Property owner' : BIZ_TENANTS.includes(i) ? 'Tenant' : 'Owner-occupier');
const bizUnits = (i: number) => BIZ_OWNERS[i] || (BIZ_TENANTS.includes(i) ? 1 : 2 + (i % 5));
const UNIT_TENANTS = ['Choppies Supermarket', 'Woolworths', 'Nando’s', 'Standard Chartered', 'Cash Bazaar', 'Mr Price', 'Pep Stores', 'Debonairs Pizza', 'Clicks', 'Barcelos'];

function businessProperties(i: number): Property[] {
  const role = bizRole(i);
  const r = rnd(61 + i);
  if (role === 'Tenant') {
    const oi = [1, 2, 10, 11][i % 4];
    return [{ plot: 'Unit ' + (10 + i) + ', ' + BIZ[oi][0], meter: 'WM-' + (206000 + i * 31), tenant: 'You (lessee)', vends: 'Tenant vends', bal: P(Math.round(r() * 40000 * 100) / 100), tone: '#00468C' }];
  }
  if (role === 'Owner-occupier') {
    return Array.from({ length: Math.min(4, bizUnits(i)) }, (_, j) => ({
      plot: ['Main plant', 'Admin block', 'Staff housing', 'Warehouse'][j] + ' · ' + BIZ[i][0],
      meter: 'WM-' + (206000 + i * 31 + j * 5),
      tenant: 'Own operation',
      vends: 'Owner vends',
      bal: P(Math.round(r() * 30000 * 100) / 100),
      tone: '#767E89',
    }));
  }
  return Array.from({ length: Math.min(6, BIZ_OWNERS[i]) }, (_, j) => {
    const bal = Math.round((r() * 60000 - 9000) * 100) / 100;
    const vacant = j === 3;
    return {
      plot: 'Unit ' + (101 + j * 7) + ', ' + BIZ[i][0],
      meter: 'WM-' + (206000 + i * 31 + j * 5),
      tenant: vacant ? 'Vacant unit' : UNIT_TENANTS[(i + j) % UNIT_TENANTS.length],
      vends: vacant ? 'Landlord vends' : 'Tenant vends',
      bal: P(bal),
      tone: vacant ? '#A1A8B2' : bal < 0 ? '#B3261E' : '#00468C',
    };
  });
}

const GOVT: [vote: string, ministry: string, facility: string][] = [
  ['V-0421', 'Ministry of Health', 'Marina Referral Hospital'], ['V-0117', 'Ministry of Education', 'University of Botswana'],
  ['V-0388', 'Ministry of Defence', 'SSKB Camp Area'], ['V-0204', 'Local Government', 'Gaborone City Council'],
  ['V-0512', 'Ministry of Health', 'Princess Marina Clinic'], ['V-0093', 'Office of the President', 'State House'],
  ['V-0741', 'Ministry of Lands', 'Government Enclave'], ['V-0655', 'Ministry of Education', 'Naledi Senior School'],
  ['V-0288', 'Ministry of Health', 'Institute of Health Sciences'], ['V-0333', 'Local Government', 'Old Naledi Ward Office'],
];

/* ---------- Register screens ---------- */

export interface Stat {
  label: string;
  value: string;
  sub: string;
}

export interface KycProfile {
  name: string;
  id: string;
  kind: string;
  initials: string;
  pct: number;
  docs: { label: string; ok: boolean }[];
  fields: { k: string; v: string; tone?: string }[];
  purchases: { date: string; channel: string; amount: string }[];
  propCount: string;
  props: Property[];
}

export interface TableConfig {
  name: string;
  count: string;
  pageInfo: string;
  stats: Stat[];
  chips: string[];
  head: [label: string, align?: 'right'][];
  rows: () => Cell[][];
  kyc?: (i: number) => KycProfile;
}

export type TableScreen = 'domestic' | 'business' | 'gov' | 'meters' | 'bulk' | 'sites' | 'gateways';

const kycDocs = (docs: [string, number][]) => docs.map(([label, ok]) => ({ label, ok: !!ok }));

export const TABLES: Record<TableScreen, TableConfig> = {
  domestic: {
    name: 'Domestic clients',
    count: '41,208 clients',
    pageInfo: 'Showing 1–14 of 41,208',
    stats: [
      { label: 'Total clients', value: '41,208', sub: '+312 this month' },
      { label: 'Active meters', value: '39,860', sub: '96.7% of base' },
      { label: 'In arrears', value: '3,142', sub: 'P 1.84 M exposure' },
      { label: 'KYC incomplete', value: '218', sub: 'blocks vending' },
    ],
    chips: ['All', 'Active', 'Arrears', 'KYC pending', 'Suspended'],
    head: [['Client ID'], ['Name'], ['Role'], ['Meters', 'right'], ['Plot / suburb'], ['Vends as', 'right'], ['Balance', 'right'], ['Status', 'right'], ['KYC', 'right']],
    rows: () =>
      CLIENT_NAMES.map((n, i) => {
        const r = rnd(900 + i);
        const bal = Math.round((r() * 500 - 120) * 100) / 100;
        const status = bal < 0 ? 'Arrears' : i === 5 ? 'Suspended' : 'Active';
        const kyc = i === 3 || i === 9 ? 'Pending' : i === 11 ? 'Expired' : 'Verified';
        const role = roleOf(i);
        const nm = metersOf(i);
        return [
          txt('DOM-' + (204100 + i * 37), { mono: true }),
          txt(n, { bold: true }),
          txt(role, { color: role === 'Owner-occupier' ? '#767E89' : '#00468C', bold: role !== 'Owner-occupier' }),
          txt(String(nm), { mono: true, align: 'right' }),
          txt(role === 'Landlord' ? nm + ' properties · ' + SUBS_SHORT[i] + ' +' : 'Plot ' + (12000 + i * 411) + ', ' + SUBS_SHORT[i]),
          txt(role === 'Landlord' ? 'tenants' : 'self', { align: 'right', mono: true, color: role === 'Landlord' ? '#00468C' : '#767E89' }),
          txt(P(bal), { mono: true, align: 'right', color: bal < 0 ? '#B3261E' : '#181D23' }),
          badge(status),
          badge(kyc),
        ];
      }),
    kyc: (i) => {
      const n = CLIENT_NAMES[i];
      const r = rnd(900 + i);
      const pct = i === 3 || i === 9 ? 60 : i === 11 ? 80 : 100;
      const role = roleOf(i);
      return {
        name: n,
        id: 'DOM-' + (204100 + i * 37),
        kind: 'Domestic · prepaid',
        initials: initials(n),
        pct,
        docs: kycDocs([
          ['Omang (national ID)', 1], ['Proof of residence', 1], ['Signed service agreement', 1],
          ['Deposit receipt', pct >= 80 ? 1 : 0], ['Landlord consent letter', pct === 100 ? 1 : 0],
        ]),
        fields: [
          { k: 'Meter', v: 'WM-' + (104000 + i * 91) }, { k: 'Tariff', v: 'Domestic Band 2' },
          { k: 'Suburb', v: SUBS_SHORT[i] }, { k: 'Plot', v: String(12000 + i * 411) },
          { k: 'Phone', v: '+267 7' + Math.floor(r() * 9e6 + 1e6) }, { k: 'Connected', v: '14 Mar 2023' },
          { k: 'Occupants', v: '4' }, { k: 'Avg monthly', v: '14.8 kL', tone: '#2A7A7E' },
        ],
        purchases: PURCHASES.slice(0, 4).map((p) => ({ date: p[0].split(',')[0], channel: p[2], amount: p[4] })),
        propCount: role === 'Landlord' ? metersOf(i) + ' properties' : role === 'Tenant' ? 'rented' : '1 property',
        props: domesticProperties(i),
      };
    },
  },

  business: {
    name: 'Business clients',
    count: '1,884 accounts',
    pageInfo: 'Showing 1–12 of 1,884',
    stats: [
      { label: 'Accounts', value: '1,884', sub: '312 on credit terms' },
      { label: 'Metered volume', value: '81.4 ML', sub: 'month to date' },
      { label: 'Revenue MTD', value: 'P 2.41 M', sub: '34% of total' },
      { label: 'KYC / CIPA expiring', value: '46', sub: 'within 30 days' },
    ],
    chips: ['All', 'Prepaid', 'Credit terms', 'KYC expiring'],
    head: [['Account'], ['Trading name'], ['Sector'], ['Role'], ['Meters', 'right'], ['Volume MTD', 'right'], ['Terms', 'right'], ['Balance', 'right'], ['KYC', 'right']],
    rows: () =>
      BIZ.map((x, i) => {
        const r = rnd(500 + i);
        const bal = Math.round((r() * 90000 - 15000) * 100) / 100;
        const role = bizRole(i);
        return [
          txt('BUS-' + (30140 + i * 23), { mono: true }),
          txt(x[0], { bold: true }),
          txt(x[1], { color: '#767E89' }),
          txt(role, { color: role === 'Owner-occupier' ? '#767E89' : '#00468C', bold: role !== 'Owner-occupier' }),
          txt(String(bizUnits(i)), { mono: true, align: 'right' }),
          txt(short(Math.round(r() * 9e6 + 4e5)) + ' L', { mono: true, align: 'right', color: '#2A7A7E' }),
          txt(i % 3 === 0 ? 'Prepaid' : '30 days', { align: 'right', color: '#767E89' }),
          txt(P(bal), { mono: true, align: 'right', color: bal < 0 ? '#B3261E' : '#181D23' }),
          badge(i === 2 || i === 8 ? 'Pending' : i === 10 ? 'Expired' : 'Verified'),
        ];
      }),
    kyc: (i) => {
      const x = BIZ[i];
      const pct = i === 2 || i === 8 ? 55 : i === 10 ? 75 : 100;
      const role = bizRole(i);
      return {
        name: x[0],
        id: 'BUS-' + (30140 + i * 23),
        kind: x[1] + ' · business',
        initials: initials(x[0], 2),
        pct,
        docs: kycDocs([
          ['CIPA registration certificate', 1], ['Directors’ Omang copies', 1], ['Tax clearance (BURS)', pct >= 75 ? 1 : 0],
          ['VAT registration', pct >= 75 ? 1 : 0], ['Bank confirmation letter', pct === 100 ? 1 : 0], ['Signed credit agreement', pct === 100 ? 1 : 0],
        ]),
        fields: [
          { k: 'CIPA no.', v: 'BW0001' + (1000 + i * 7) }, { k: 'VAT no.', v: 'C' + (33100 + i * 11) },
          { k: 'Sector', v: x[1] }, { k: 'Meters', v: String(bizUnits(i)) },
          { k: 'Credit limit', v: 'P 250,000' }, { k: 'Terms', v: i % 3 === 0 ? 'Prepaid' : '30 days' },
          { k: 'Contact', v: 'accounts@…' }, { k: 'Since', v: '2019' },
        ],
        purchases: [
          { date: '18 Aug 2026', channel: 'EFT', amount: 'P 84,200.00' },
          { date: '02 Aug 2026', channel: 'EFT', amount: 'P 71,940.00' },
          { date: '18 Jul 2026', channel: 'Portal card', amount: 'P 66,310.00' },
          { date: '01 Jul 2026', channel: 'EFT', amount: 'P 79,880.00' },
        ],
        propCount: role === 'Property owner' ? bizUnits(i) + ' let units' : role === 'Tenant' ? 'leased unit' : bizUnits(i) + ' own meters',
        props: businessProperties(i),
      };
    },
  },

  gov: {
    name: 'Government accounts',
    count: '212 votes',
    pageInfo: 'Showing 1–10 of 212',
    stats: [
      { label: 'Vote accounts', value: '212', sub: '11 ministries' },
      { label: 'Facilities', value: '1,046', sub: 'schools, clinics, offices' },
      { label: 'Consumption MTD', value: '112.8 ML', sub: '31% of network' },
      { label: 'Unbilled', value: 'P 984,200', sub: 'awaiting vote release' },
    ],
    chips: ['All ministries', 'Health', 'Education', 'Local Government', 'Unbilled'],
    head: [['Vote'], ['Ministry'], ['Facility'], ['Meters', 'right'], ['Bulk', 'right'], ['Consumption MTD', 'right'], ['Budget used', 'right'], ['Status', 'right']],
    rows: () =>
      GOVT.map((x, i) => {
        const r = rnd(300 + i);
        const used = 40 + Math.floor(r() * 58);
        return [
          txt(x[0], { mono: true }),
          txt(x[1], { bold: true }),
          txt(x[2], { color: '#767E89' }),
          txt(String(2 + Math.floor(r() * 40)), { mono: true, align: 'right' }),
          txt(String(1 + Math.floor(r() * 4)), { mono: true, align: 'right' }),
          txt(short(Math.round(r() * 2e7 + 1e6)) + ' L', { mono: true, align: 'right', color: '#2A7A7E' }),
          txt(used + '%', { mono: true, align: 'right', color: used > 90 ? '#B3261E' : '#181D23' }),
          badge(i === 4 || i === 9 ? 'Pending' : 'Active'),
        ];
      }),
  },

  meters: {
    name: 'Meter register',
    count: '50,412 meters',
    pageInfo: 'Showing 1–14 of 50,412',
    stats: [
      { label: 'Registered meters', value: '50,412', sub: 'STS prepaid, LoRaWAN' },
      { label: 'Online now', value: '46,528', sub: '92.3%' },
      { label: 'Low battery', value: '1,406', sub: 'replace within 90 days' },
      { label: 'Unseen 24h', value: '1,842', sub: 'dispatch queue' },
    ],
    chips: ['All', 'Online', 'Offline', 'Low battery', 'Suspected bypass'],
    head: [['Serial'], ['DevEUI'], ['Type'], ['Client'], ['Suburb'], ['Gateway'], ['RSSI / SF', 'right'], ['Battery', 'right'], ['Last uplink', 'right'], ['Status', 'right']],
    rows: () =>
      CLIENT_NAMES.map((n, i) => {
        const r = rnd(700 + i);
        const rs = -(80 + Math.floor(r() * 34));
        const bt = 20 + Math.floor(r() * 80);
        const status = i === 4 ? 'Offline' : bt < 35 ? 'Low batt' : 'Online';
        return [
          txt('WM-' + (104000 + i * 91), { mono: true }),
          txt('A840' + (419000 + i * 137).toString(16).toUpperCase(), { mono: true, color: '#767E89' }),
          txt(i % 7 === 3 ? 'Bulk DN80' : 'Domestic DN15', { color: '#767E89' }),
          txt(n),
          txt(SUBS_SHORT[i], { color: '#767E89' }),
          txt(GATEWAYS[i % GATEWAYS.length].id, { mono: true }),
          txt(rs + ' / SF' + [7, 8, 9, 10, 12][i % 5], { mono: true, align: 'right', color: rs < -105 ? '#965A00' : '#181D23' }),
          txt(bt + '%', { mono: true, align: 'right', color: bt < 35 ? '#965A00' : '#181D23' }),
          txt(status === 'Offline' ? '3 d ago' : Math.floor(r() * 55) + ' min', { mono: true, align: 'right', color: '#767E89' }),
          badge(status),
        ];
      }),
  },

  bulk: {
    name: 'Bulk meters & district metered areas',
    count: '412 bulk meters',
    pageInfo: 'Showing 1–10 of 412',
    stats: [
      { label: 'Bulk meters', value: '412', sub: '38 DMAs' },
      { label: 'Bulk inflow MTD', value: '418.2 ML', sub: 'all zones' },
      { label: 'Non-revenue water', value: '13.7%', sub: 'target < 12%' },
      { label: 'DMAs above target', value: '9', sub: 'investigate' },
    ],
    chips: ['All DMAs', 'Above target', 'Balanced', 'Sensor fault'],
    head: [['Bulk meter'], ['DMA / zone'], ['Size'], ['Inflow MTD', 'right'], ['Sub-meter sum', 'right'], ['Loss', 'right'], ['Daily avg', 'right'], ['Status', 'right']],
    rows: () =>
      ['Block 8 DMA', 'Phakalane DMA', 'Old Naledi DMA', 'Broadhurst DMA', 'Block 5 DMA', 'Phase 4 DMA', 'Tsholofelo DMA', 'CBD DMA', 'Kgale View DMA', 'Bontleng DMA'].map((z, i) => {
        const r = rnd(200 + i);
        const inflow = Math.round(8e6 + r() * 4.2e7);
        const loss = Math.round((6 + r() * 16) * 10) / 10;
        return [
          txt('BM-' + (7100 + i * 17), { mono: true }),
          txt(z, { bold: true }),
          txt(['DN150', 'DN200', 'DN100', 'DN150', 'DN100', 'DN150', 'DN100', 'DN200', 'DN80', 'DN80'][i], { color: '#767E89' }),
          txt(short(inflow) + ' L', { mono: true, align: 'right' }),
          txt(short(Math.round(inflow * (1 - loss / 100))) + ' L', { mono: true, align: 'right', color: '#767E89' }),
          txt(loss + '%', { mono: true, align: 'right', color: loss > 14 ? '#B3261E' : loss > 12 ? '#965A00' : '#237A48' }),
          txt(short(Math.round(inflow / 19)) + ' L', { mono: true, align: 'right', color: '#767E89' }),
          badge(loss > 14 ? 'Arrears' : i === 7 ? 'Pending' : 'Active'),
        ];
      }),
  },

  sites: {
    name: 'Sites & zones',
    count: '38 sites',
    pageInfo: 'Showing 1–10 of 38',
    stats: [
      { label: 'Sites', value: '38', sub: 'reservoirs, depots, masts' },
      { label: 'Gateways deployed', value: '6', sub: '1 offline' },
      { label: 'Meters covered', value: '46,970', sub: '93.2% of fleet' },
      { label: 'Coverage gaps', value: '4', sub: 'SF12 clusters' },
    ],
    chips: ['All sites', 'With gateway', 'Coverage gap', 'Maintenance due'],
    head: [['Site code'], ['Name'], ['Zone'], ['Type'], ['Meters', 'right'], ['Gateways', 'right'], ['Reservoir level', 'right'], ['Status', 'right']],
    rows: () =>
      (
        [
          ['ST-001', 'Main Mall rooftop', 'CBD', 'Gateway mast'], ['ST-002', 'Broadhurst water tower', 'Broadhurst', 'Reservoir'],
          ['ST-003', 'Phakalane reservoir', 'Phakalane', 'Reservoir'], ['ST-004', 'Gaborone West depot', 'Gaborone West', 'Depot'],
          ['ST-005', 'Kgale Hill mast', 'Kgale View', 'Gateway mast'], ['ST-006', 'Old Naledi clinic', 'Old Naledi', 'Gateway mast'],
          ['ST-007', 'Block 8 pump station', 'Block 8', 'Pump station'], ['ST-008', 'Tsholofelo booster', 'Tsholofelo', 'Booster'],
          ['ST-009', 'Naledi ward office', 'Naledi', 'Office'], ['ST-010', 'Fairgrounds valve chamber', 'Fairgrounds', 'Valve chamber'],
        ] as const
      ).map((x, i) => {
        const r = rnd(100 + i);
        const lvl = Math.round(35 + r() * 60);
        return [
          txt(x[0], { mono: true }),
          txt(x[1], { bold: true }),
          txt(x[2], { color: '#767E89' }),
          txt(x[3], { color: '#767E89' }),
          txt(N(Math.round(400 + r() * 12000)), { mono: true, align: 'right' }),
          txt(i < 6 ? '1' : '0', { mono: true, align: 'right' }),
          txt(x[3] === 'Reservoir' ? lvl + '%' : '—', { mono: true, align: 'right', color: x[3] === 'Reservoir' && lvl < 45 ? '#965A00' : '#181D23' }),
          badge(i === 5 ? 'Arrears' : i === 3 ? 'Pending' : 'Active'),
        ];
      }),
  },

  gateways: {
    name: 'Gateway fleet',
    count: '6 gateways',
    pageInfo: 'Showing all 6',
    stats: [
      { label: 'Gateways', value: '6', sub: 'ChirpStack NS' },
      { label: 'Online', value: '4', sub: '1 degraded, 1 offline' },
      { label: 'Uplinks 24h', value: '1.41 M', sub: 'all ports' },
      { label: 'Downlink queue', value: '318', sub: 'credit + config' },
    ],
    chips: ['All', 'Online', 'Degraded', 'Offline'],
    head: [['Gateway'], ['Site'], ['Coordinates'], ['Nodes', 'right'], ['RSSI', 'right'], ['Radius', 'right'], ['Firmware', 'right'], ['State', 'right']],
    rows: () =>
      GATEWAYS.map((g, i) => [
        txt(g.id, { mono: true, bold: true }),
        txt(g.site),
        txt(g.lat.toFixed(4) + ', ' + g.lng.toFixed(4), { mono: true, color: '#767E89' }),
        txt(N(g.meters), { mono: true, align: 'right' }),
        txt(g.rssi, { mono: true, align: 'right', color: '#767E89' }),
        txt((g.r / 1000).toFixed(1) + ' km', { mono: true, align: 'right' }),
        txt('2.8.' + (3 + i), { mono: true, align: 'right', color: '#767E89' }),
        badge(g.state === 'ONLINE' ? 'Online' : g.state === 'DEGRADED' ? 'Degraded' : 'Offline'),
      ]),
  },
};
