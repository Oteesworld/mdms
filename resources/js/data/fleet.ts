import { N, rnd } from './format.js';

export interface Suburb {
  name: string;
  tokens: number;
  salesN: number;
  usageN: number;
  txN: number;
  metersN: number;
  lat: number;
  lng: number;
}

const titleCase = (s: string) =>
  s
    .split(' ')
    .map((w) => (/^(CBD|BBS)$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');

// name, tokens, sales (P), usage (L), transactions, meters, lat, lng
export const SUBURBS: Suburb[] = (
  [
    ['PHAKALANE', 1571, 779240.99, 55461439, 1371, 2267, -24.5637, 25.952],
    ['BLOCK 8', 2725, 1455232.76, 130123131, 2725, 3170, -24.6273, 25.942],
    ['BLOCK 10', 1307, 399495.4, 23958672, 1307, 1557, -24.621, 25.953],
    ['BLOCK 9', 1369, 288151.3, 10830742, 1369, 2219, -24.618, 25.931],
    ['PHASE 4', 1321, 251146.85, 19346924, 1321, 2033, -24.648, 25.895],
    ['TSHOLOFELO', 1303, 239048.46, 12228669, 1303, 1853, -24.635, 25.95],
    ['BROADHURST BBS MALL AREA', 860, 158718.93, 14177242, 860, 1246, -24.63, 25.94],
    ['OLD NALEDI', 851, 183335.0, 5251353, 851, 1231, -24.672, 25.92],
    ['GOVERNMENT ENCLAVE', 532, 163107.74, 10672385, 532, 883, -24.658, 25.908],
    ['BLOCK 5', 731, 153275.79, 8516845, 731, 1103, -24.648, 25.913],
    ['BLOCK 3', 584, 149943.96, 10225101, 584, 1068, -24.6455, 25.925],
    ['BROADHURST', 559, 116743.13, 5871032, 559, 998, -24.625, 25.935],
    ['KGALE VIEW', 396, 112885.75, 3490240, 396, 909, -24.69, 25.885],
    ['POPINN', 270, 93433.23, 2394938, 270, 500, -24.652, 25.931],
    ['BONTLENG', 297, 61273.0, 3099636, 297, 370, -24.664, 25.907],
    ['AFRICAN MALL', 133, 31214.6, 2784949, 133, 216, -24.654, 25.92],
    ['NEW STANCE', 116, 30987.15, 709821, 116, 134, -24.667, 25.913],
    ['THE VILLAGE', 94, 36689.98, 578142, 94, 163, -24.669, 25.935],
    ['FIRMS', 183, 20428.73, 770739, 183, 319, -24.652, 25.9],
    ['TEBELOPELE', 59, 19700.0, 303176, 59, 95, -24.642, 25.901],
    ['OLD LOBATSE ROAD', 18, 13312.5, 341042, 18, 38, -24.68, 25.93],
    ['GABORONE NORTH', 41, 12016.04, 386376, 41, 82, -24.595, 25.93],
    ['NEW NALEDI', 93, 11569.0, 433870, 93, 129, -24.668, 25.926],
    ['FAIRGROUNDS', 49, 11243.0, 394212, 49, 135, -24.648, 25.928],
    ['MARUAPULA', 1, 150.0, 9575, 1, 2, -24.642, 25.943],
    ['GABORONE WEST', 9, 3150.0, 76036, 9, 6, -24.648, 25.89],
    ['CBD', 3, 1120.0, 51745, 3, 26, -24.656, 25.913],
    ['WHITE CITY', 0, 0, 2662, 0, 1, -24.66, 25.899],
  ] as const
).map((r) => ({
  name: titleCase(r[0]),
  tokens: r[1],
  salesN: r[2],
  usageN: r[3],
  txN: r[4],
  metersN: r[5],
  lat: r[6],
  lng: r[7],
}));

export type GatewayState = 'ONLINE' | 'DEGRADED' | 'OFFLINE';

export interface Gateway {
  id: string;
  site: string;
  lat: number;
  lng: number;
  meters: number;
  rssi: string;
  state: GatewayState;
  dot: string;
  /** Coverage radius, metres. */
  r: number;
}

export const GATEWAYS: Gateway[] = [
  { id: 'GW-GAB-01', site: 'Main Mall rooftop, CBD', lat: -24.6555, lng: 25.912, meters: 9840, rssi: '-97 dBm', state: 'ONLINE', dot: '#2E9D5B', r: 3400 },
  { id: 'GW-GAB-02', site: 'Broadhurst water tower', lat: -24.626, lng: 25.939, meters: 12470, rssi: '-92 dBm', state: 'ONLINE', dot: '#2E9D5B', r: 3800 },
  { id: 'GW-GAB-03', site: 'Phakalane reservoir', lat: -24.568, lng: 25.95, meters: 6310, rssi: '-101 dBm', state: 'ONLINE', dot: '#2E9D5B', r: 4200 },
  { id: 'GW-GAB-04', site: 'Gaborone West depot', lat: -24.65, lng: 25.893, meters: 8150, rssi: '-104 dBm', state: 'DEGRADED', dot: '#D99A2B', r: 3000 },
  { id: 'GW-GAB-05', site: 'Kgale Hill mast', lat: -24.688, lng: 25.888, meters: 5210, rssi: '-88 dBm', state: 'ONLINE', dot: '#2E9D5B', r: 4600 },
  { id: 'GW-GAB-06', site: 'Old Naledi clinic', lat: -24.6725, lng: 25.9215, meters: 3990, rssi: '—', state: 'OFFLINE', dot: '#B3261E', r: 2600 },
];

export type MeterStatus = 'online' | 'amber' | 'offline';

export const STATUS: Record<MeterStatus, { label: string; dot: string }> = {
  online: { label: 'Online', dot: '#2E9D5B' },
  amber: { label: 'Late 12–24h', dot: '#E0A00B' },
  offline: { label: 'Offline', dot: '#D6452E' },
};

export interface Meter {
  id: string;
  lat: number;
  lng: number;
  status: MeterStatus;
  sub: string;
  gw: string;
  gwLat: number;
  gwLng: number;
  rssi: number;
  snr: number;
  sf: string;
  batt: number;
  /** Battery-voltage alarm (port 004/866). */
  bv: boolean;
  fw: string;
  bal: number;
  usage: number;
  loss: number;
  seen: string;
}

const FIRMWARE: [string, number][] = [
  ['1.1', 6], ['2', 1], ['4', 9], ['5', 2], ['7', 8996], ['11', 135], ['16', 8856], ['17', 12133], ['201', 1],
  ['202', 2], ['208', 1], ['212', 35], ['217', 157], ['223', 1], ['252', 52], ['253', 16], ['Unknown', 2101],
];

let meterCache: Meter[] | null = null;

/** Sample of the fleet plotted on the map (~1 in 9 meters per suburb). */
export function meters(): Meter[] {
  if (meterCache) return meterCache;
  const r = rnd(20260819);
  const out: Meter[] = [];
  const rareFw = ['1.1', '2', '4', '5', '11', '201', '202', '208', '212', '217', '223', '252', '253'];
  const fwPick = () => {
    const x = r();
    return x < 0.37 ? '17' : x < 0.64 ? '16' : x < 0.91 ? '7' : x < 0.955 ? 'Unknown' : rareFw[Math.floor(r() * 13)];
  };
  SUBURBS.forEach((s, si) => {
    const n = Math.max(6, Math.round(s.metersN / 9));
    const gw = GATEWAYS.reduce(
      (a, g) => {
        const d = (g.lat - s.lat) ** 2 + (g.lng - s.lng) ** 2;
        return d < a.d ? { d, g } : a;
      },
      { d: 1e9, g: GATEWAYS[0] },
    ).g;
    for (let i = 0; i < n; i++) {
      const x = r();
      const bq = r();
      out.push({
        id: 'WM-' + (100000 + si * 977 + i * 13),
        lat: s.lat + (r() - 0.5) * 0.018,
        lng: s.lng + (r() - 0.5) * 0.022,
        status: x > 0.887 ? 'offline' : x > 0.72 ? 'amber' : 'online',
        sub: s.name,
        gw: gw.id,
        gwLat: gw.lat,
        gwLng: gw.lng,
        rssi: -(78 + Math.round(r() * 40)),
        snr: Math.round((r() * 14 - 3) * 10) / 10,
        sf: 'SF' + [7, 8, 9, 10, 12][Math.floor(r() * 5)],
        batt: bq < 0.03 ? Math.round(r() * 24) : bq < 0.06 ? 25 + Math.round(r() * 24) : Math.round(52 + r() * 48),
        bv: r() < 0.012,
        fw: fwPick(),
        bal: Math.round((r() < 0.17 ? -(r() * 1400) : r() * 420) * 100) / 100,
        usage: Math.round(400 + r() * 9000),
        loss: Math.round(r() * 90) / 10,
        seen: Math.round(r() * 55) + 'm ago',
      });
    }
  });
  meterCache = out;
  return out;
}

/* ---------- Map layers (mirrors the LEEROY layer list) ---------- */

export const LAYERS: [key: string, label: string][] = [
  ['main', 'Main (32,504)'],
  ['online', 'Online (23,394)'],
  ['amber', 'Amber / Late 12-24h (5,428)'],
  ['offline', 'Offline (3,677)'],
  ['lb50', 'Low Battery (<50, WUC) (939)'],
  ['lb25', 'Low Battery (<25, WUC) (733)'],
  ['bv', 'Battery Voltage (004/866) (282)'],
  ['nc1', 'Negative Credit (-1 to -10) (190)'],
  ['nc2', 'Negative Credit (< -10 to -1,000) (236)'],
  ['nc3', 'Negative Credit (< -1,000) (5,043)'],
  ['rssiHeat', 'RSSI Heatmap (73)'],
  ['snrHeat', 'SNR Heatmap (32,503)'],
  ['gwLinks', 'Gateway Links (30d) (0)'],
  ...FIRMWARE.map((f): [string, string] => ['fw' + f[0], 'Firmware ' + f[0] + ' (' + N(f[1]) + ')']),
  ['usageHeat', 'Usage Heatmap (32,504)'],
];

/** Filter layers: a meter is plotted if it matches any active filter. */
export const LAYER_TEST: Record<string, (m: Meter) => boolean> = {
  online: (m) => m.status === 'online',
  amber: (m) => m.status === 'amber',
  offline: (m) => m.status === 'offline',
  lb50: (m) => m.batt < 50,
  lb25: (m) => m.batt < 25,
  bv: (m) => m.bv,
  nc1: (m) => m.bal <= -1 && m.bal > -10,
  nc2: (m) => m.bal <= -10 && m.bal > -1000,
  nc3: (m) => m.bal <= -1000,
};
FIRMWARE.forEach((f) => {
  LAYER_TEST['fw' + f[0]] = (m) => m.fw === f[0];
});

const ramp = (v: number, stops: [number, string][]) => {
  for (const [limit, colour] of stops) if (v <= limit) return colour;
  return stops[stops.length - 1][1];
};

/** Heatmap layers recolour meters on a gradient instead of by status. */
export const HEAT: Record<string, (m: Meter) => string> = {
  rssiHeat: (m) => ramp(m.rssi, [[-112, '#7f1d1d'], [-105, '#D6452E'], [-98, '#E0A00B'], [-90, '#a3d977'], [0, '#1a9850']]),
  snrHeat: (m) => ramp(m.snr, [[-2, '#7f1d1d'], [2, '#D6452E'], [6, '#E0A00B'], [9, '#a3d977'], [99, '#1a9850']]),
  usageHeat: (m) => ramp(m.usage, [[1500, '#fef0d9'], [3500, '#fdcc8a'], [6000, '#fc8d59'], [8000, '#e34a33'], [1e9, '#b30000']]),
};

export type LayerState = Record<string, boolean>;
export const DEFAULT_LAYERS: LayerState = { main: true };

export function visibleMeters(layers: LayerState): Meter[] {
  const on = Object.keys(layers).filter((k) => layers[k] && k !== 'main' && !HEAT[k] && k !== 'gwLinks');
  const all = meters();
  if (!on.length) return layers.main === false ? [] : all;
  return all.filter((m) => on.some((k) => LAYER_TEST[k]?.(m)));
}
