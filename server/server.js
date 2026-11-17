// Leeroy MDMS API: read-only proxy to the ChirpStack v4 gRPC-web API.
// The ChirpStack API token stays on the server (CHIRPSTACK_TOKEN env var) and is never sent to browsers.
'use strict';
const http = require('http');

const PORT = process.env.PORT || 10000;
const CS_URL = (process.env.CHIRPSTACK_URL || 'https://teemane.leeroysystems.co.bw').replace(/\/$/, '');
const CS_TOKEN = process.env.CHIRPSTACK_TOKEN || '';
const TENANT = process.env.CHIRPSTACK_TENANT_ID || '';
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://mdms-pavd.onrender.com').split(',').map(s => s.trim()).filter(Boolean);

// Optional outbound proxy (local development only).
let dispatcher;
if (process.env.HTTPS_PROXY) { try { const {ProxyAgent} = require('undici'); dispatcher = new ProxyAgent(process.env.HTTPS_PROXY); } catch (e) { /* not installed */ } }

// ---------- minimal protobuf ----------
const varint = n => { const out = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v); return Buffer.from(out); };
const tag = (f, wt) => varint((f << 3) | wt);
const fVarint = (f, n) => Buffer.concat([tag(f, 0), varint(n)]);
const fBytes = (f, b) => Buffer.concat([tag(f, 2), varint(b.length), b]);
const fString = (f, s) => fBytes(f, Buffer.from(String(s)));
const fTimestamp = (f, date) => fBytes(f, fVarint(1, Math.floor(date.getTime() / 1000)));

function decode(buf) {
  const out = {}; let i = 0;
  const rv = () => { let r = 0n, s = 0n, b; do { b = buf[i++]; r |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80); return r; };
  while (i < buf.length) {
    const k = Number(rv()), f = k >> 3, wt = k & 7; let val;
    if (wt === 0) val = rv();
    else if (wt === 1) { val = buf.subarray(i, i + 8); i += 8; }
    else if (wt === 2) { const n = Number(rv()); val = buf.subarray(i, i + n); i += n; }
    else if (wt === 5) { val = buf.subarray(i, i + 4); i += 4; }
    else throw new Error('Unsupported wire type ' + wt);
    (out[f] = out[f] || []).push({wt, val});
  }
  return out;
}
const one = (m, f) => (m[f] || [])[0];
const str = (m, f) => { const x = one(m, f); return x ? x.val.toString('utf8') : ''; };
const num = (m, f) => { const x = one(m, f); return x ? Number(x.val) : 0; };
const dbl = (m, f) => { const x = one(m, f); return x ? x.val.readDoubleLE(0) : null; };
const flt = (m, f) => { const x = one(m, f); return x ? x.val.readFloatLE(0) : null; };
const ts = (m, f) => { const x = one(m, f); if (!x) return null; const t = decode(x.val); return new Date((num(t, 1) * 1000) + Math.floor(num(t, 2) / 1e6)).toISOString(); };
const map = (m, f) => { const o = {}; (m[f] || []).forEach(e => { const kv = decode(e.val); o[str(kv, 1)] = str(kv, 2); }); return o; };
const STATE = ['NEVER_SEEN', 'ONLINE', 'OFFLINE'];
const LOC_SRC = ['UNKNOWN', 'GPS', 'CONFIG', 'GEO_RESOLVER_TDOA', 'GEO_RESOLVER_RSSI', 'GEO_RESOLVER_GNSS', 'GEO_RESOLVER_WIFI'];
const location = (m, f) => { const x = one(m, f); if (!x) return null; const l = decode(x.val); return {latitude: dbl(l, 1) || 0, longitude: dbl(l, 2) || 0, altitude: dbl(l, 3) || 0, source: LOC_SRC[num(l, 4)] || 'UNKNOWN', accuracy: flt(l, 5) || 0}; };

async function grpc(method, body) {
  if (!CS_TOKEN) throw Object.assign(new Error('CHIRPSTACK_TOKEN is not configured on the server'), {status: 500});
  const frame = Buffer.concat([Buffer.from([0]), Buffer.alloc(4), body]); frame.writeUInt32BE(body.length, 1);
  const r = await fetch(CS_URL + '/' + method, {method: 'POST', dispatcher, body: frame, signal: AbortSignal.timeout(15000),
    headers: {'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1', authorization: 'Bearer ' + CS_TOKEN}});
  const buf = Buffer.from(await r.arrayBuffer());
  let msg = null, trailers = '';
  for (let i = 0; i + 5 <= buf.length;) { const flag = buf[i], n = buf.readUInt32BE(i + 1), part = buf.subarray(i + 5, i + 5 + n); if (flag & 0x80) trailers += part.toString(); else msg = part; i += 5 + n; }
  const st = /grpc-status:\s*(\d+)/i.exec(trailers + ' ' + (r.headers.get('grpc-status') ? 'grpc-status:' + r.headers.get('grpc-status') : ''));
  if (!r.ok || (st && st[1] !== '0')) {
    const gm = /grpc-message:\s*([^\r\n]*)/i.exec(trailers) || [null, r.headers.get('grpc-message') || 'HTTP ' + r.status];
    throw Object.assign(new Error('ChirpStack ' + method + ': ' + decodeURIComponent(gm[1])), {status: 502});
  }
  return decode(msg || Buffer.alloc(0));
}

async function listGateways() {
  const res = await grpc('api.GatewayService/List', Buffer.concat([fVarint(1, 1000), fString(4, TENANT)]));
  return {totalCount: num(res, 1), gateways: (res[2] || []).map(x => { const g = decode(x.val); return {
    id: str(g, 2), name: str(g, 3), description: str(g, 4), location: location(g, 5), properties: map(g, 6),
    createdAt: ts(g, 7), updatedAt: ts(g, 8), lastSeenAt: ts(g, 9), state: STATE[num(g, 10)] || 'NEVER_SEEN'}; })};
}

function metric(m) {
  if (!m) return null; const x = decode(m.val);
  return {name: str(x, 1), timestamps: (x[2] || []).map(t => { const d = decode(t.val); return new Date(num(d, 1) * 1000).toISOString(); }),
    datasets: (x[3] || []).map(d => { const ds = decode(d.val), data = [];
      (ds[2] || []).forEach(v => { if (v.wt === 5) data.push(v.val.readFloatLE(0)); else for (let k = 0; k + 4 <= v.val.length; k += 4) data.push(v.val.readFloatLE(k)); });
      return {label: str(ds, 1), data: data.map(v => Math.round(v * 100) / 100)}; })};
}
async function gatewayMetrics(id, hours, aggregation) {
  const end = new Date(), start = new Date(end.getTime() - hours * 3600e3);
  const r = await grpc('api.GatewayService/GetMetrics', Buffer.concat([fString(1, id), fTimestamp(2, start), fTimestamp(3, end), fVarint(4, aggregation)]));
  return {rxPackets: metric(one(r, 1)), txPackets: metric(one(r, 2)), txPerFreq: metric(one(r, 3)), rxPerFreq: metric(one(r, 4)), txPerDr: metric(one(r, 5)), rxPerDr: metric(one(r, 6)), txPerStatus: metric(one(r, 7))};
}
async function getGateway(id) {
  const r = await grpc('api.GatewayService/Get', fString(1, id));
  const g = decode((one(r, 1) || {val: Buffer.alloc(0)}).val);
  const gw = {id: str(g, 1), name: str(g, 2), description: str(g, 3), location: location(g, 4), tenantId: str(g, 5), tags: map(g, 6), metadata: map(g, 7), statsInterval: num(g, 8),
    createdAt: ts(r, 2), updatedAt: ts(r, 3), lastSeenAt: ts(r, 4)};
  if (TENANT && gw.tenantId && gw.tenantId !== TENANT) throw Object.assign(new Error('Gateway not found'), {status: 404});
  const [day, month] = await Promise.all([gatewayMetrics(id, 24, 0).catch(e => ({error: e.message})), gatewayMetrics(id, 24 * 30, 1).catch(e => ({error: e.message}))]);
  const list = await listGateways().catch(() => null);
  const li = list && list.gateways.find(x => x.id === id);
  gw.state = li ? li.state : (gw.lastSeenAt ? 'OFFLINE' : 'NEVER_SEEN');
  return {gateway: gw, metrics24h: day, metrics30d: month};
}

// ---------- tiny cache + HTTP ----------
const cache = new Map();
const cached = (key, ttl, fn) => { const c = cache.get(key); if (c && Date.now() - c.t < ttl) return c.p; const p = fn(); cache.set(key, {t: Date.now(), p}); p.catch(() => cache.delete(key)); return p; };

http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const allow = origin && (ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)) ? origin : ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const send = (code, obj) => { res.writeHead(code, {'content-type': 'application/json', 'cache-control': 'no-store'}); res.end(JSON.stringify(obj)); };
  try {
    const u = new URL(req.url, 'http://x');
    if (req.method !== 'GET') return send(405, {error: 'Method not allowed'});
    if (u.pathname === '/healthz') return send(200, {ok: true});
    if (u.pathname === '/api/gateways') return send(200, Object.assign({fetchedAt: new Date().toISOString(), source: CS_URL}, await cached('list', 15000, listGateways)));
    const m = /^\/api\/gateways\/([0-9a-fA-F]{16})$/.exec(u.pathname);
    if (m) { const id = m[1].toLowerCase(); return send(200, Object.assign({fetchedAt: new Date().toISOString()}, await cached('gw:' + id, 15000, () => getGateway(id)))); }
    send(404, {error: 'Not found'});
  } catch (e) {
    console.error(new Date().toISOString(), req.url, e.message);
    send(e.status || 502, {error: e.message});
  }
}).listen(PORT, () => console.log('Leeroy MDMS API listening on ' + PORT + ' -> ' + CS_URL));
