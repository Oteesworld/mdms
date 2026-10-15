/* Per-meter device dashboard data: status, radio, alarms, usage, credit and message history.
   Generated deterministically from the meter serial so each meter always shows the same story. */
import { GATEWAYS, SUBURBS } from './fleet';
import { N, P, rnd } from './format';

export type AlarmType = 'Burst alarm' | 'Valve flow' | 'Magnetic tamper' | 'Hardware error' | 'Installation mode';

export interface Alarm {
  type: AlarmType;
  /** Hours before now; used for ordering. */
  h: number;
  at: string;
  detail: string;
  active: boolean;
}

export interface GatewaySeen {
  id: string;
  site: string;
  messages: number;
  rssi: number;
  snr: number;
  last: string;
}

export interface FportLane {
  port: number;
  name: string;
  /** Message times as hours before now (0 = now, 48 = two days ago). */
  hits: number[];
  alarm?: boolean;
}

export interface Device {
  meter: string;
  devEui: string;
  online: boolean;
  lastSeen: string;
  /** Date of the last full day of readings (today when online). */
  lastDay: string;
  lat: number;
  lng: number;
  address: string;
  info: [string, string][];
  connectivity: [string, string][];
  overview: { dailyL: number; costToday: number; costMtd: number; leak30L: number; battPct: number; battV: number; creditP: number; creditL: number; daysLeft: number };
  gateways: GatewaySeen[];
  alarms: Alarm[];
  hourly: number[];
  /** Litres per hour separating low/medium and medium/high use for this meter. */
  bands: [number, number];
  daily: { label: string; l: number }[];
  leak: { label: string; l: number }[];
  credit: { label: string; p: number; topup: number }[];
  timeline: { h: number; t: string; kind: string; text: string; tone?: string }[];
  usage: { t: string; reading: string; l: number; flow: string }[];
  tokens: { h: number; t: string; token: string; units: string; status: string }[];
  sales: { h: number; t: string; receipt: string; channel: string; amount: string; buyer: string }[];
  fports: FportLane[];
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** "now" is the demo clock in the top bar: 19 Aug 2026, 13:01. */
const NOW = new Date(Date.UTC(2026, 7, 19, 13, 1));
const day = (d: number) => new Date(NOW.getTime() - d * 864e5);
const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const agoText = (h: number) => (h < 1 ? Math.max(1, Math.round(h * 60)) + ' min ago' : h < 24 ? Math.round(h) + ' h ago' : Math.floor(h / 24) + ' d ' + Math.round(h % 24) + ' h ago');
const fmtStamp = (hoursAgo: number) => {
  const d = new Date(NOW.getTime() - hoursAgo * 36e5);
  // Older than ~5 months: show the year so it is not mistaken for this year's date.
  return fmtDay(d) + (hoursAgo > 24 * 150 ? ' ' + d.getUTCFullYear() : ', ' + d.toISOString().slice(11, 16));
};

const ALARM_DETAIL: Record<AlarmType, string> = {
  'Burst alarm': 'Flow above burst threshold for more than 10 minutes (port 66)',
  'Valve flow': 'Flow detected while the valve was reported closed',
  'Magnetic tamper': 'Strong magnetic field on the register (port 65)',
  'Hardware error': 'Register self-test failed; reading held from last good value',
  'Installation mode': 'Meter in installation mode; consumption not billed (port 37)',
};

interface Opts {
  plot: string;
  business?: boolean;
  balance?: number;
  /** Domestic tariff per kL by default; business tariff when `business`. */
}

export function makeDevice(meter: string, o: Opts): Device {
  const r = rnd(hash(meter));
  const biz = !!o.business;
  const sub = SUBURBS.find((s) => o.plot.includes(s.name)) ?? SUBURBS[Math.floor(r() * 12)];
  const lat = sub.lat + (r() - 0.5) * 0.012;
  const lng = sub.lng + (r() - 0.5) * 0.014;
  const online = r() > 0.15;
  const lastSeenH = online ? r() * 0.4 : 30 + r() * 60;
  const lastSeen = agoText(lastSeenH);
  const devEui = (0x9cd9cb0000000000n + BigInt(hash(meter) % 0xffffff)).toString(16).toUpperCase();

  // Usage
  const base = biz ? 4000 + r() * 16000 : 320 + r() * 380;
  const shape = [0.2, 0.15, 0.12, 0.12, 0.15, 0.4, 1.4, 2.1, 1.7, 1.0, 0.8, 0.8, 1.0, 0.9, 0.8, 0.8, 1.0, 1.6, 2.0, 1.8, 1.4, 1.0, 0.6, 0.35];
  const shapeSum = shape.reduce((a, b) => a + b, 0);
  const leaking = r() < 0.35;
  const leakPerH = leaking ? (biz ? 30 + r() * 80 : 4 + r() * 18) : 0;
  const hourly = shape.map((s) => Math.round((base * s) / shapeSum * (0.75 + r() * 0.5) + leakPerH));
  const avgH = hourly.reduce((a, b) => a + b, 0) / 24;
  const bands: [number, number] = [Math.round(avgH * 0.6), Math.round(avgH * 1.4)];
  const daily = Array.from({ length: 14 }, (_, i) => ({
    label: fmtDay(day(13 - i)),
    l: Math.round(base * (0.7 + r() * 0.6) * ((13 - i) % 7 >= 5 ? 1.15 : 1) + leakPerH * 24),
  }));
  const leak = Array.from({ length: 30 }, (_, i) => ({
    label: fmtDay(day(29 - i)),
    l: leaking && i > 8 ? Math.round(leakPerH * (6 + r() * 4)) : r() < 0.08 ? Math.round(5 + r() * 20) : 0,
  }));
  const dailyL = Math.round(hourly.reduce((a, b) => a + b, 0));

  // Money and credit
  const rate = biz ? 21.4 : 10.21; // P per kL excl. VAT
  const costPerL = (rate * 1.14) / 1000;
  const creditP = o.balance ?? Math.round((biz ? 5000 + r() * 40000 : 20 + r() * 300) * 100) / 100;
  // Simulate 30 days forward: daily use draws credit down, a top-up lands when it runs low.
  // The curve is then shifted so today's value matches the account balance.
  const low = biz ? 8000 : 45;
  const sim: { p: number; topup: number }[] = [];
  let c = biz ? 25000 + r() * 20000 : 60 + r() * 140;
  for (let i = 0; i < 30; i++) {
    let topup = 0;
    if (c < low) topup = biz ? 20000 : [50, 50, 100, 100, 200][Math.floor(r() * 5)];
    c += topup - (daily[i % 14].l * costPerL);
    sim.push({ p: c, topup });
  }
  const shift = creditP - sim[29].p;
  const credit = sim.map((d, i) => ({ label: fmtDay(day(29 - i)), p: Math.round((d.p + shift) * 100) / 100, topup: d.topup }));
  const costToday = dailyL * costPerL;
  const costMtd = daily.slice(-14).reduce((a, d) => a + d.l, 0) * costPerL * (19 / 14);
  const leak30L = leak.reduce((a, d) => a + d.l, 0);
  const battPct = Math.round(35 + r() * 64);
  const battV = Math.round((3.2 + (battPct / 100) * 0.45) * 100) / 100;

  // Radio
  const near = GATEWAYS.map((g) => ({ g, d: (g.lat - lat) ** 2 + (g.lng - lng) ** 2 })).sort((a, b) => a.d - b.d).slice(0, 3);
  const gateways = near.map(({ g }, i) => {
    const messages = Math.round([1180, 240, 36][i] * (0.7 + r() * 0.6));
    return {
      id: g.id, site: g.site, messages,
      rssi: -Math.round(84 + i * 9 + r() * 8), snr: Math.round((9 - i * 4 + r() * 3) * 10) / 10,
      // An offline meter can't have been heard by any gateway since it went silent.
      last: i === 0 ? lastSeen : online ? (g.state === 'OFFLINE' ? '3 h 12 m ago' : Math.round(2 + r() * 20) + ' h ago') : agoText(lastSeenH + 6 + r() * 40),
    };
  });
  const sf = 'SF' + [7, 8, 9, 10][Math.floor(r() * 4)];
  const fcnt = Math.round(18000 + r() * 30000);

  // Alarms
  // Installation mode is raised once, when the meter is commissioned; the rest are recent field events.
  const installedH = 24 * (400 + Math.floor(r() * 300));
  const recent: AlarmType[] = ['Burst alarm', 'Valve flow', 'Magnetic tamper', 'Hardware error'];
  const alarms: Alarm[] = [{ type: 'Installation mode', h: installedH, at: fmtStamp(installedH), detail: ALARM_DETAIL['Installation mode'], active: false }];
  const nAlarms = 2 + Math.floor(r() * 4);
  for (let i = 0; i < nAlarms; i++) {
    const type = recent[Math.floor(r() * recent.length)];
    const h = r() * 24 * 30;
    alarms.push({ type, h, at: fmtStamp(h), detail: ALARM_DETAIL[type], active: h < 30 && type !== 'Valve flow' });
  }
  if (leaking) {
    const h = 4 + r() * 20;
    alarms.push({ type: 'Valve flow', h, at: fmtStamp(h), detail: 'Continuous night flow of ' + Math.round(leakPerH) + ' L/h — possible leak', active: true });
  }
  alarms.sort((a, b) => a.h - b.h);

  // Credit purchases → tokens and sales
  // Top-ups inside the chart window, plus a few earlier purchases for the history tables.
  const purchases = [
    ...credit.map((d, i) => ({ ago: 29 - i, topup: d.topup })).filter((d) => d.topup > 0),
    ...Array.from({ length: 3 }, (_, k) => ({ ago: 36 + k * 13 + Math.floor(r() * 6), topup: biz ? 20000 : [50, 100, 100][k] })),
  ].sort((a, b) => a.ago - b.ago);
  const sales = purchases.map((d, k) => {
    const amt = d.topup;
    const h = d.ago * 24 + [4.8, 0.35, 19.1, 15.9][k % 4]; // a time of day on that date
    return { h, t: fmtStamp(h), receipt: 'RC-' + (880000 + (hash(meter + k) % 99999)), channel: ['Orange Money', 'Counter · CBD', 'Portal card', 'MyZaka'][Math.floor(r() * 4)], amount: P(amt), buyer: biz ? 'Accounts payable' : r() < 0.5 ? 'Occupant' : 'Owner' };
  });
  const tokens = sales.map((s) => {
    const amt = Number(s.amount.replace(/[P ,]/g, ''));
    return { h: s.h - 0.02, t: fmtStamp(s.h - 0.02), token: Array.from({ length: 5 }, () => String(Math.floor(r() * 9000 + 1000))).join(' '), units: N(Math.round(amt / costPerL)) + ' L', status: 'Accepted by meter' };
  });

  // Register readings (port 60 midnight data)
  let reg = 1_200_000 + Math.round(r() * 400_000);
  const usage = daily.slice().reverse().map((d) => {
    const row = { t: d.label + ', 00:00', reading: N(reg) + ' L', l: d.l, flow: Math.round(d.l / 24) + ' L/h avg' };
    reg -= d.l;
    return row;
  });

  // Fport timeline over the last 48 hours
  const cut = online ? 0 : lastSeenH;
  const keep = (h: number) => h >= cut && h <= 48;
  const live = Array.from({ length: 40 }, (_, i) => i * 1.2 + r() * 0.8).filter(keep);
  const lanes: FportLane[] = [
    { port: 60, name: 'Midnight data', hits: [13.02, 37.02].filter(keep) },
    { port: 61, name: 'Live data', hits: live },
    { port: 5, name: 'ACK-ACK', hits: live.filter(() => r() < 0.12) },
    { port: 210, name: 'Credit', hits: [6 + r() * 30].filter(keep) },
    { port: 225, name: 'Come back', hits: online && r() < 0.4 ? [10 + r() * 20] : [] },
    { port: 65, name: 'Tamper alarm', hits: alarms.some((a) => a.type === 'Magnetic tamper' && a.active) ? [3 + r() * 20].filter(keep) : [], alarm: true },
    { port: 66, name: 'Burst alarm', hits: alarms.some((a) => a.type === 'Burst alarm' && a.active) ? [2 + r() * 20].filter(keep) : [], alarm: true },
    { port: 37, name: 'Installation', hits: [] },
  ];

  const timeline = [
    ...alarms.map((a) => ({ h: a.h, t: a.at, kind: 'Alarm', text: a.type + ' — ' + a.detail, tone: a.active ? '#B3261E' : '#767E89' })),
    ...sales.map((s) => ({ h: s.h, t: s.t, kind: 'Sale', text: s.amount + ' via ' + s.channel + ' · ' + s.receipt })),
    ...tokens.map((tk) => ({ h: tk.h, t: tk.t, kind: 'Token', text: tk.units + ' token ' + tk.status.toLowerCase() })),
    { h: lastSeenH, t: fmtStamp(lastSeenH), kind: 'Uplink', text: 'Last uplink via ' + gateways[0].id + ' · RSSI ' + gateways[0].rssi + ' dBm' },
    ...(online ? [] : [{ h: lastSeenH - 0.01, t: fmtStamp(lastSeenH - 0.01), kind: 'Status', text: 'Meter went offline — no uplink since', tone: '#B3261E' }]),
  ].sort((a, b) => a.h - b.h);

  const installed = fmtStamp(installedH);
  return {
    meter, devEui, online, lastSeen, lat, lng,
    lastDay: fmtDay(new Date(NOW.getTime() - lastSeenH * 36e5)),
    address: o.plot + ', Gaborone',
    info: [
      ['Meter serial', meter], ['Make / model', 'Lesira YWM 255C'], ['Type', biz ? 'Ultrasonic DN40, prepaid' : 'Ultrasonic DN15, prepaid'],
      ['Meter class', 'Class C · H'], ['Rated flow (Q3)', biz ? '16 m³/h' : '1.5 m³/h'], ['Max pressure', '1,400 kPa'],
      ['Firmware', ['16', '17', '7'][Math.floor(r() * 3)]], ['Valve', online ? 'Open' : 'Unknown'], ['STS key revision', 'KRN 2 · TI 07'],
      ['Installed', installed],
    ],
    connectivity: [
      ['Network', 'LoRaWAN · ChirpStack'], ['DevEUI', devEui], ['Device class', 'A (battery)'], ['Activation', 'OTAA'],
      ['Spreading factor', sf + ' · ADR on'], ['Frame counter', N(fcnt)], ['Report interval', '1 h live · daily profile'],
      ['Last RSSI / SNR', gateways[0].rssi + ' dBm / ' + gateways[0].snr + ' dB'], ['Last uplink', lastSeen],
    ],
    overview: { dailyL, costToday, costMtd, leak30L, battPct, battV, creditP, creditL: Math.max(0, Math.round(creditP / costPerL)), daysLeft: Math.max(0, Math.round(creditP / Math.max(1, costToday))) },
    gateways, alarms, hourly, bands, daily, leak, credit, timeline, usage, tokens, sales, fports: lanes,
  };
}
