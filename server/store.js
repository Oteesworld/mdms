// Reading history for Leeroy MDMS: stores meter uplinks in Postgres (DATABASE_URL) and
// turns cumulative meter readings into hourly / daily consumption.
'use strict';
const path = require('path');
const {exec} = require('child_process');

const DATABASE_URL = process.env.DATABASE_URL || '';
const TZ = process.env.METER_TIMEZONE || 'Africa/Gaborone';
let pool = null, ready = null;
const Pool0 = (pg, opts) => new pg.Pool(opts);

// Load the pg driver. The Render service may have been created without an install step, so
// install it on first use if it is missing (set the build command to `cd server && npm install`
// to do this at build time instead).
// The install runs in the background so the API keeps answering requests meanwhile.
function loadPg() {
  try { return Promise.resolve(require('pg')); } catch (e) {
    console.log('pg driver missing; running npm install in ' + __dirname);
    return new Promise((ok, bad) => exec('npm install --omit=dev --no-audit --no-fund', {cwd: __dirname, timeout: 180000}, err => {
      if (err) return bad(err);
      console.log('pg driver installed');
      ok(require(path.join(__dirname, 'node_modules', 'pg')));
    }));
  }
}

function db() {
  if (!DATABASE_URL) return null;
  if (!ready) {
    ready = loadPg().then(pg => {
    // timestamps without zone (bucket starts in the meter's local time) are kept as naive UTC values
    pg.types.setTypeParser(1114, v => new Date(v.replace(' ', 'T') + 'Z'));
    const external = /\.render\.com|sslmode=require/.test(DATABASE_URL);
    pool = Pool0(pg, {connectionString: DATABASE_URL, max: 3, ssl: external ? {rejectUnauthorized: false} : false});
    return pool.query(`
      CREATE TABLE IF NOT EXISTS meter_uplinks (
        id BIGSERIAL PRIMARY KEY,
        dev_eui TEXT NOT NULL,
        dedup_id TEXT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL,
        f_port INT, f_cnt BIGINT,
        function_code TEXT,
        reading_m3 NUMERIC,
        consumption_m3 NUMERIC, purchase_m3 NUMERIC,
        temperature_c NUMERIC, battery_v NUMERIC,
        rssi INT, snr NUMERIC, gateway_id TEXT,
        meter_time TEXT,
        payload_hex TEXT,
        object JSONB,
        source TEXT,
        stored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (dev_eui, dedup_id)
      );
      CREATE INDEX IF NOT EXISTS meter_uplinks_dev_time ON meter_uplinks (dev_eui, received_at);
      -- Every cumulative reading the meter provides, with the time it was taken: the reading in each
      -- uplink (at network receive time) plus readings the meter sends for earlier times (SH hourly
      -- history records, Honeywell sampled readings). Consumption is only ever computed between these.
      CREATE TABLE IF NOT EXISTS meter_readings (
        dev_eui TEXT NOT NULL,
        reading_at TIMESTAMPTZ NOT NULL,
        reading_m3 NUMERIC NOT NULL,
        source TEXT NOT NULL,
        PRIMARY KEY (dev_eui, reading_at, source)
      );
      INSERT INTO meter_readings (dev_eui, reading_at, reading_m3, source)
        SELECT dev_eui, received_at, reading_m3, 'uplink' FROM meter_uplinks WHERE reading_m3 IS NOT NULL AND reading_m3 < 1e6
        ON CONFLICT DO NOTHING;
    `); }).then(() => true).catch(e => { ready = null; throw e; });
  }
  return ready.then(() => pool);
}

// Total meter reading in m3 from a decoded uplink: C7 data report totalFlow, or the C2 status
// frame field A (0.1 m3; the top byte is ignored because it once carried a stray 0x14).
function readingOf(o) {
  if (!o) return null;
  if (o.function_code === '0xC7' && o.crc_ok !== false && typeof o.totalFlow === 'number') return o.totalFlow;
  if (o.function_code === '0xC2' && o.crc_ok !== false && typeof o.payload_hex === 'string' && o.payload_hex.length >= 8) return parseInt(o.payload_hex.slice(2, 8), 16) / 10;
  // Honeywell / 869531-series meters: daily report with the cumulative reading in m3
  if (o.cycleType && typeof o.currentReading === 'number') return o.currentReading;
  return null;
}
const num = v => typeof v === 'number' && isFinite(v) ? v : null;

// Meter-local "YYYY-MM-DD HH:MM:SS" (or with "_") to a UTC Date, for a fixed UTC offset in minutes.
const localToUtc = (txt, offsetMin) => { const m = /^(\d{4})-(\d{2})-(\d{2})[ _T](\d{2}):(\d{2}):(\d{2})/.exec(String(txt || '')); if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - offsetMin * 60000); };
const SH_OFFSET_MIN = Number(process.env.SH_METER_UTC_OFFSET_MIN || 120);      // SH meter clocks run on local time (Africa/Gaborone, UTC+2)
const HW_OFFSET_MIN = Number(process.env.HONEYWELL_UTC_OFFSET_MIN || 120);     // device variable timezone = 8 (x 15 min) = UTC+2
// Readings carried by one decoded uplink: [time, m3, source]
function readingsOf(ev, o) {
  const out = [], r = readingOf(o);
  if (r !== null && r < 1e6) out.push([new Date(ev.time), r, 'uplink']);
  (Array.isArray(o.history) && o.function_code === '0xC7' ? o.history : []).forEach(h => {  // SH hourly records
    const t = localToUtc(h.meterTime, SH_OFFSET_MIN); if (t && typeof h.totalFlow === 'number') out.push([t, h.totalFlow, 'meter-history']); });
  (Array.isArray(o.samples) ? o.samples : []).forEach(sm => {                                   // Honeywell sampled readings (fPort 11)
    const t = localToUtc(sm.timestamp, HW_OFFSET_MIN); if (t && typeof sm.reading === 'number') out.push([t, sm.reading, 'meter-samples']); });
  // a meter-dated reading cannot be later than the uplink that carried it (catches a wrong meter clock)
  const rx = new Date(ev.time).getTime() + 300000;
  return out.filter(x => x[2] === 'uplink' || x[0].getTime() <= rx);
}

// ev: {devEui, id (deduplicationId), time, fPort, fCnt, object, dataHex, rx:[{gatewayId,rssi,snr}]}
async function storeUplink(ev, source) {
  const p = await db(); if (!p || !ev || !ev.devEui || !ev.time) return false;
  const o = ev.object || {}, rx = (ev.rx || [])[0] || {};
  const id = ev.id || (ev.time + ':' + ev.fCnt);
  const r = await p.query(`INSERT INTO meter_uplinks (dev_eui, dedup_id, received_at, f_port, f_cnt, function_code, reading_m3, consumption_m3, purchase_m3, temperature_c, battery_v, rssi, snr, gateway_id, meter_time, payload_hex, object, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (dev_eui, dedup_id) DO NOTHING`,
    [ev.devEui.toLowerCase(), id, ev.time, ev.fPort, ev.fCnt, o.function_code || null, readingOf(o), num(o.totalConsumption), num(o.totalPurchase), num(o.waterTemperature), num(o.voltageRtu),
      num(rx.rssi), num(rx.snr), rx.gatewayId || null, o.meterTime || null, ev.dataHex || null, JSON.stringify(o), source]);
  for (const x of readingsOf(ev, o)) await p.query(`INSERT INTO meter_readings (dev_eui, reading_at, reading_m3, source) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [ev.devEui.toLowerCase(), x[0], x[1], x[2]]);
  return r.rowCount === 1;
}

// Consumption computed only between real meter readings, never spread or estimated.
//  unit 'interval': every interval between two consecutive readings that ends in the last `count`
//    hours, with its exact start and end. With hourly meter records these are exact hours.
//  unit 'day': for each local day, the difference between the readings at its two midnights. Exact
//    when the meter reported within ±90 min of both; otherwise the day shows only what was measured
//    between its first and last reading ('partial'), and today runs to the latest reading ('so-far').
// Readings far from both neighbours (corrupt frames) are ignored.
async function consumption(devEui, unit, count) {
  const p = await db(); if (!p) return {enabled: false};
  const raw = (await p.query(`SELECT reading_at, max(reading_m3)::float AS reading, string_agg(DISTINCT source, ',') AS source
    FROM meter_readings WHERE dev_eui = $1 AND reading_m3 < 1e6 GROUP BY reading_at ORDER BY reading_at`, [devEui])).rows
    .map(r => ({t: r.reading_at.getTime(), v: r.reading, src: r.source}));
  const clean = raw.filter((r, i) => { const a = raw[i - 1], b = raw[i + 1]; return !((a && Math.abs(r.v - a.v) > 1000) && (!b || Math.abs(r.v - b.v) > 1000)); });
  // readings less than 2 minutes apart are one reading (e.g. an uplink and its own history record)
  const rd = []; clean.forEach(r => { const l = rd[rd.length - 1]; if (l && r.t - l.t < 120000) { l.v = Math.max(l.v, r.v); l.src += ',' + r.src; } else rd.push(Object.assign({}, r)); });
  const first = (await p.query(`SELECT min(reading_at) AS since, count(*)::int AS n, max(reading_at) AS last FROM meter_readings WHERE dev_eui = $1`, [devEui])).rows[0];
  const now = Date.now(), fmt = t => new Date(t).toISOString();
  const base = {enabled: true, timeZone: TZ, unit, since: first.since, lastReading: first.last, readings: first.n, hourlyRecords: rd.some(r => /meter-history|meter-samples/.test(r.src))};
  if (unit !== 'day') {
    const from = now - count * 3600e3, intervals = [];
    for (let i = 1; i < rd.length; i++) if (rd[i].t > from) intervals.push({from: fmt(rd[i - 1].t), to: fmt(rd[i].t), minutes: Math.round((rd[i].t - rd[i - 1].t) / 60000),
      used_l: Math.max(0, Math.round((rd[i].v - rd[i - 1].v) * 1000)), reading_m3: rd[i].v, source: rd[i].src});
    return Object.assign(base, {intervals});
  }
  // local midnights in the meter's time zone
  const localParts = t => { const s = new Date(t).toLocaleString('en-CA', {timeZone: TZ, hour12: false}); return s; };
  const offsetMin = t => { const l = new Date(new Date(t).toLocaleString('en-US', {timeZone: TZ}) + ' UTC').getTime(); return Math.round((l - t) / 60000); };
  const todayLocal = new Date(now + offsetMin(now) * 60000); todayLocal.setUTCHours(0, 0, 0, 0);
  const midnight = k => { const local = todayLocal.getTime() - k * 864e5; return local - offsetMin(local) * 60000; }; // UTC ms of local midnight k days ago
  const near = (t, tol) => { let best = null; rd.forEach(r => { const d = Math.abs(r.t - t); if (d <= tol && (!best || d < Math.abs(best.t - t))) best = r; }); return best; };
  const TOL = 90 * 60000, buckets = [];
  for (let k = count - 1; k >= 0; k--) {
    const a = midnight(k), b = midnight(k - 1), day = new Date(a + offsetMin(a) * 60000).toISOString().slice(0, 10);
    const ra = near(a, TOL), rb = k === 0 ? null : near(b, TOL), inside = rd.filter(r => r.t >= a - TOL && r.t <= Math.min(b + TOL, now));
    if (ra && rb) buckets.push({start: day, used_l: Math.max(0, Math.round((rb.v - ra.v) * 1000)), state: 'exact', from: fmt(ra.t), to: fmt(rb.t)});
    else if (k === 0 && ra && inside.length) { const l = inside[inside.length - 1]; buckets.push({start: day, used_l: Math.max(0, Math.round((l.v - ra.v) * 1000)), state: 'so-far', from: fmt(ra.t), to: fmt(l.t)}); }
    else if (inside.length >= 2) { const f = inside[0], l = inside[inside.length - 1]; buckets.push({start: day, used_l: Math.max(0, Math.round((l.v - f.v) * 1000)), state: 'partial', from: fmt(f.t), to: fmt(l.t)}); }
    else buckets.push({start: day, used_l: null, state: 'no-data'});
  }
  return Object.assign(base, {buckets});
}

// Newest stored C7 data report with a valid checksum (the ChirpStack event log keeps only ~10 uplinks).
async function latestDataReport(devEui) {
  const p = await db(); if (!p) return null;
  const r = (await p.query(`SELECT received_at, f_cnt, f_port, object FROM meter_uplinks
    WHERE dev_eui = $1 AND function_code = '0xC7' AND object->>'totalFlow' IS NOT NULL AND coalesce(object->>'crc_ok', 'true') <> 'false'
    ORDER BY received_at DESC LIMIT 1`, [devEui])).rows[0];
  return r ? {time: r.received_at.toISOString(), fCnt: Number(r.f_cnt), fPort: r.f_port, object: r.object} : null;
}

// Most recent value of each data-report field, from whichever stored report last carried it
// (a field the meter leaves out of later reports keeps its last known value and date).
const REPORT_KEYS = ['totalFlow', 'currentFlow', 'totalConsumption', 'totalPurchase', 'latestRecharge', 'hoardingAmount',
  'warningWater', 'creditWater', 'waterTemperature', 'voltageRtu', 'valveState', 'signalStrength', 'reportInterval', 'version'];
async function lastKnownValues(devEui) {
  const p = await db(); if (!p) return {};
  const rows = (await p.query(`
    SELECT k AS key, x.v, x.received_at FROM unnest($2::text[]) AS k
    CROSS JOIN LATERAL (
      SELECT object -> k AS v, received_at FROM meter_uplinks
      WHERE dev_eui = $1 AND function_code = '0xC7' AND object ? k AND coalesce(object->>'crc_ok', 'true') <> 'false'
      ORDER BY received_at DESC LIMIT 1) x`, [devEui, REPORT_KEYS])).rows;
  const out = {};
  rows.forEach(r => { out[r.key] = {v: r.v, time: r.received_at.toISOString()}; });
  return out;
}

// Status frames (0xC2) received after a given time, oldest first: used to follow the valve state
// and spot a top-up between data reports.
async function statusFramesSince(devEui, sinceIso) {
  const p = await db(); if (!p) return [];
  const rows = (await p.query(`SELECT received_at, object->>'payload_hex' AS hex FROM meter_uplinks
    WHERE dev_eui = $1 AND function_code = '0xC2' AND received_at > $2 AND object->>'payload_hex' IS NOT NULL
    ORDER BY received_at LIMIT 500`, [devEui, sinceIso])).rows;
  return rows.map(r => ({time: r.received_at.toISOString(), hex: r.hex}));
}

module.exports = {enabled: () => !!DATABASE_URL, db, storeUplink, consumption, readingOf, latestDataReport, lastKnownValues, statusFramesSince};
