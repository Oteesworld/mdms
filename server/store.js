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
  return null;
}
const num = v => typeof v === 'number' && isFinite(v) ? v : null;

// ev: {devEui, id (deduplicationId), time, fPort, fCnt, object, dataHex, rx:[{gatewayId,rssi,snr}]}
async function storeUplink(ev, source) {
  const p = await db(); if (!p || !ev || !ev.devEui || !ev.time) return false;
  const o = ev.object || {}, rx = (ev.rx || [])[0] || {};
  const id = ev.id || (ev.time + ':' + ev.fCnt);
  const r = await p.query(`INSERT INTO meter_uplinks (dev_eui, dedup_id, received_at, f_port, f_cnt, function_code, reading_m3, consumption_m3, purchase_m3, temperature_c, battery_v, rssi, snr, gateway_id, meter_time, payload_hex, object, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (dev_eui, dedup_id) DO NOTHING`,
    [ev.devEui.toLowerCase(), id, ev.time, ev.fPort, ev.fCnt, o.function_code || null, readingOf(o), num(o.totalConsumption), num(o.totalPurchase), num(o.waterTemperature), num(o.voltageRtu),
      num(rx.rssi), num(rx.snr), rx.gatewayId || null, o.meterTime || null, ev.dataHex || null, JSON.stringify(o), source]);
  return r.rowCount === 1;
}

// Hourly (last N hours) or daily (last N days) consumption from the cumulative reading.
// Each bucket's reading is the highest reading received in it, carried forward when no frame
// arrived; consumption is the rise from the previous bucket. Readings that jump more than
// 1000 m3 from their neighbours are ignored as corrupt frames.
async function consumption(devEui, unit, count) {
  const p = await db(); if (!p) return {enabled: false};
  const step = unit === 'day' ? 'day' : 'hour';
  const rows = (await p.query(`
    SELECT date_trunc($2, received_at AT TIME ZONE $3) AS bucket, max(reading_m3)::float AS reading, min(reading_m3)::float AS low, count(*)::int AS frames
    FROM meter_uplinks WHERE dev_eui = $1 AND reading_m3 IS NOT NULL AND reading_m3 < 1e6
    GROUP BY 1 ORDER BY 1`, [devEui, step, TZ])).rows;
  const first = (await p.query(`SELECT min(received_at) AS since, count(*)::int AS n, max(received_at) AS last FROM meter_uplinks WHERE dev_eui = $1`, [devEui])).rows[0];
  // drop outliers (a reading far from both neighbours)
  const clean = rows.filter((r, i) => { const a = rows[i - 1], b = rows[i + 1]; return !((a && Math.abs(r.reading - a.reading) > 1000) && (!b || Math.abs(r.reading - b.reading) > 1000)); });
  // local "now" in the meter's time zone, as a naive timestamp like Postgres returns
  const nowLocal = new Date(new Date().toLocaleString('en-US', {timeZone: TZ}) + ' UTC');
  const start = new Date(nowLocal); if (step === 'hour') { start.setUTCMinutes(0, 0, 0); start.setUTCHours(start.getUTCHours() - (count - 1)); } else { start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - (count - 1)); }
  const size = step === 'hour' ? 3600e3 : 864e5;
  const idx = d => Math.round((d.getTime() - start.getTime()) / size); // bucket index relative to the window (may be negative)
  const buckets = [];
  for (let i = 0; i < count; i++) {
    const t = new Date(start.getTime() + i * size);
    buckets.push({start: t.toISOString().slice(0, 16).replace('T', ' '), reading_m3: null, used_l: null, estimated: false, frames: 0, state: 'no-data'});
  }
  // The meter reports its cumulative total only every few hours. Usage between two reports is
  // spread evenly over the buckets since the previous report and marked as estimated; buckets
  // after the latest report have no data yet.
  let prev = null;
  clean.forEach(r => {
    const k = idx(r.bucket);
    if (prev) {
      const total = Math.max(0, (r.reading - prev.reading) * 1000), span = k - prev.k;
      if (span >= 1) {
        let left = Math.round(total);
        for (let b = prev.k + 1; b <= k; b++) {
          const share = b === k ? left : Math.round(total / span); left -= b === k ? 0 : share;
          if (b >= 0 && b < count) Object.assign(buckets[b], {used_l: share, estimated: span > 1, state: span > 1 ? 'spread' : 'measured'});
        }
      } else if (k >= 0 && k < count) { // two reports in the same bucket
        const bk = buckets[k]; bk.used_l = (bk.used_l || 0) + Math.round(total);
      }
    } else if (k >= 0 && k < count) { // first report ever: only the rise within its own bucket is known
      Object.assign(buckets[k], {used_l: Math.max(0, Math.round((r.reading - r.low) * 1000)), state: 'measured'});
    }
    if (k >= 0 && k < count) Object.assign(buckets[k], {reading_m3: r.reading, frames: r.frames});
    prev = {k, reading: r.reading};
  });
  const lastK = prev ? prev.k : -1;
  for (let b = Math.max(0, lastK + 1); b < count; b++) buckets[b].state = 'pending';
  return {enabled: true, timeZone: TZ, unit: step, since: first.since, lastStored: first.last, storedFrames: first.n, buckets};
}

module.exports = {enabled: () => !!DATABASE_URL, db, storeUplink, consumption, readingOf};
