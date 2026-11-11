// Amplified IoT live meter dashboard. Plain JS, no build step.

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 0) => (n == null ? '–' : Number(n).toLocaleString('en-BW', { maximumFractionDigits: d, minimumFractionDigits: d }));

const PORTS = [
  [5, 'ACK-ACK'], [37, 'Installation'], [60, 'Midnight data'], [61, 'Live data'],
  [65, 'Tamper alarm'], [66, 'Burst alarm'], [210, 'Credit'], [225, 'Come back'],
];
const ALARM_PORTS = new Set([65, 66]);
const STATUS = {
  online: ['Online', 'var(--good)'],
  offline: ['Offline', 'var(--bad)'],
  never_seen: ['Never seen', 'var(--none)'],
};
const FILTERS = [['', 'All'], ['online', 'Online'], ['offline', 'Offline'], ['never_seen', 'Never seen'], ['low_battery', 'Low battery']];

const state = { meters: [], filter: '', q: '', open: null };

function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
const time = (iso) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
const litres = (l) => (l == null ? '–' : l >= 10000 ? `${fmt(l / 1000, 1)} kL` : `${fmt(l)} L`);
const statusHtml = (s) => `<span class="status"><span class="sdot" style="background:${STATUS[s][1]}"></span>${STATUS[s][0]}</span>`;

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// --- header ------------------------------------------------------------------

function tickClock() {
  $('#clock').textContent = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderSync(cs) {
  const el = $('#ns');
  el.classList.remove('ok', 'err');
  if (!cs || !cs.enabled) {
    el.classList.add('err');
    $('#ns-text').textContent = 'ChirpStack API not configured';
  } else if (cs.ok) {
    el.classList.add('ok');
    $('#ns-text').textContent = 'Network server online';
  } else {
    el.classList.add('err');
    $('#ns-text').textContent = 'Network server unreachable';
  }
  el.title = cs?.error ?? (cs?.at ? `Last sync ${dateTime(cs.at)}` : '');
}

// --- summary -----------------------------------------------------------------

async function loadSummary() {
  const s = await api('/api/summary');
  renderSync(s.chirpstack);
  const alarms = s.openAlarms.reduce((a, b) => a + b.count, 0);
  const k = [
    ['Meters registered', fmt(s.meters.total), `${fmt(s.meters.neverSeen)} not heard from yet`],
    ['Online', fmt(s.meters.online), 'heard within 26 h', 'var(--good)'],
    ['Offline', fmt(s.meters.offline), 'silent over 26 h', 'var(--bad)'],
    ['Low battery', fmt(s.meters.lowBattery), 'at or below threshold', 'var(--warn)'],
    ['Uplinks', fmt(s.uplinks24h), 'last 24 h'],
    ['Open alarms', fmt(alarms), s.openAlarms.map((a) => `${a.count} ${a.type}`).join(', ') || 'none', alarms ? 'var(--bad)' : null],
    ['Gateways online', `${fmt(s.gateways.online ?? 0)} / ${fmt(Object.values(s.gateways).reduce((a, b) => a + b, 0))}`, 'from ChirpStack'],
  ];
  $('#kpis').innerHTML = k
    .map(([label, v, sub, dot]) => `<div class="kpi"><div class="k">${dot ? `<span class="sdot" style="background:${dot}"></span>` : ''}${esc(label)}</div><div class="v">${esc(v)}</div><div class="s">${esc(sub)}</div></div>`)
    .join('');

  const counts = new Map(s.ports.map((p) => [p.fPort, p.count]));
  const others = s.ports.filter((p) => !PORTS.some(([n]) => n === p.fPort));
  const all = [...PORTS.map(([n, l]) => ({ fPort: n, label: l, count: counts.get(n) ?? 0 })), ...others];
  const max = Math.max(1, ...all.map((p) => p.count));
  $('#ports').innerHTML = all
    .map((p) => `<div class="port ${ALARM_PORTS.has(p.fPort) ? 'alarm' : ''}" title="${p.count} uplinks on port ${p.fPort} in the last 24 h">
      <div class="k"><b>${p.fPort}</b>${esc(p.label)}</div><div class="v">${fmt(p.count)}</div>
      <div class="track"><div class="fill" style="width:${(p.count / max) * 100}%"></div></div></div>`)
    .join('');
}

// --- meters --------------------------------------------------------------------

async function loadMeters() {
  state.meters = await api('/api/meters');
  renderMeters();
}

function renderMeters(flashEui) {
  const counts = { '': state.meters.length, low_battery: state.meters.filter((m) => m.lowBattery).length };
  for (const m of state.meters) counts[m.status] = (counts[m.status] ?? 0) + 1;
  $('#chips').innerHTML = FILTERS.map(([v, l]) => `<button class="chip ${state.filter === v ? 'on' : ''}" data-f="${v}">${l}<span class="n">${counts[v] ?? 0}</span></button>`).join('');

  const q = state.q.toLowerCase();
  const rows = state.meters.filter((m) => {
    if (state.filter === 'low_battery' ? !m.lowBattery : state.filter && m.status !== state.filter) return false;
    return !q || [m.name, m.serial, m.devEui, m.devAddr, m.tags?.meter_addr].some((v) => v && String(v).toLowerCase().includes(q));
  });
  $('#meter-rows').innerHTML = rows
    .map((m) => `<tr data-eui="${esc(m.devEui)}" class="${m.devEui === flashEui ? 'flash' : ''}">
      <td><div class="name">${esc(m.name)}</div><div class="sub mono">${esc(m.devEui)}</div></td>
      <td>${statusHtml(m.status)}${m.openAlarms ? `<span class="badge">${m.openAlarms} alarm${m.openAlarms > 1 ? 's' : ''}</span>` : ''}</td>
      <td title="${esc(m.lastSeenAt ?? '')}">${ago(m.lastSeenAt)}</td>
      <td class="r">${litres(m.registerL)}</td>
      <td class="r">${litres(m.creditL)}</td>
      <td class="r" style="${m.lowBattery ? 'color:var(--warn);font-weight:600' : ''}">${m.batteryPct == null ? '–' : `${fmt(m.batteryPct)}%`}</td>
      <td class="r mono">${m.lastRssi == null ? '–' : `${m.lastRssi} / ${fmt(m.lastSnr, 1)}`}</td>
      <td>${m.lastFPort == null ? '<span class="muted">–</span>' : esc(m.lastPortLabel)}</td>
    </tr>`)
    .join('');
  const empty = $('#meters-empty');
  empty.hidden = rows.length > 0;
  empty.innerHTML = state.meters.length
    ? 'No meters match this filter.'
    : 'No meters yet. Register them in ChirpStack with<br><code>npm run cs -- meters:import secrets/meters.keys.csv</code><br>They appear here within a minute, and go live with their first uplink.';
}

$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  state.filter = b.dataset.f;
  renderMeters();
});
$('#q').addEventListener('input', (e) => {
  state.q = e.target.value;
  renderMeters();
});
$('#meter-rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-eui]');
  if (tr) openMeter(tr.dataset.eui);
});

// --- gateways ------------------------------------------------------------------

async function loadGateways() {
  const gws = await api('/api/gateways');
  const label = { online: ['Online', 'var(--good)'], offline: ['Offline', 'var(--bad)'], never_seen: ['Never seen', 'var(--none)'] };
  $('#gw-list').innerHTML = gws.length
    ? gws
        .map((g) => {
          const [l, c] = label[g.state] ?? label.never_seen;
          return `<div class="gw"><div><div class="n">${esc(g.name)}</div><div class="m mono">${esc(g.gatewayId)}</div><div class="m">Last seen ${ago(g.lastSeenAt)}</div></div>
          <div class="st"><span class="sdot" style="background:${c}"></span>${l}</div></div>`;
        })
        .join('')
    : '<div class="empty">No gateways synced from ChirpStack yet.</div>';
}

// --- live uplinks ----------------------------------------------------------------

function logRow(u, isNew) {
  const alarm = ALARM_PORTS.has(u.fPort);
  const decoded = Object.entries(u.object || {})
    .filter(([k]) => !['port', 'message', 'message_label', 'raw_hex', 'length', 'decoded'].includes(k) && !k.startsWith('_'))
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
  return `<div class="row ${isNew ? 'new' : ''}" data-eui="${esc(u.devEui)}">
    <span class="t">${time(u.receivedAt)}</span><span class="dev">${esc(u.name || u.devEui)}</span><span class="rs">${u.rssi ?? '–'} dBm${u.sf ? ` · SF${u.sf}` : ''}</span>
    <span class="p"><span class="port-l ${alarm ? 'alarm' : ''}">${esc(u.portLabel || `Port ${u.fPort}`)}</span>${esc(decoded || u.payloadHex || '(empty)')}</span></div>`;
}

async function loadLog() {
  const ups = await api('/api/uplinks?limit=60');
  $('#log').innerHTML = ups.length ? ups.map((u) => logRow(u)).join('') : '<div class="empty">Waiting for the first uplink from ChirpStack…</div>';
}
$('#log').addEventListener('click', (e) => {
  const r = e.target.closest('[data-eui]');
  if (r) openMeter(r.dataset.eui);
});

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => loadSummary().catch(console.error), 800);
}

function connectStream() {
  const es = new EventSource('/api/stream');
  es.onopen = () => $('#live-dot').classList.add('on');
  es.onerror = () => $('#live-dot').classList.remove('on');
  es.addEventListener('uplink', async (e) => {
    const u = JSON.parse(e.data);
    const log = $('#log');
    if (log.querySelector('.empty')) log.innerHTML = '';
    log.insertAdjacentHTML('afterbegin', logRow(u, true));
    while (log.children.length > 200) log.lastElementChild.remove();
    await loadMeters().catch(console.error);
    renderMeters(u.devEui);
    scheduleRefresh();
    if (state.open === u.devEui) openMeter(u.devEui, true);
  });
  es.addEventListener('device', (e) => {
    const d = JSON.parse(e.data);
    loadMeters().catch(console.error);
    if (state.open === d.devEui) openMeter(d.devEui, true);
  });
}

// --- meter drawer ------------------------------------------------------------------

const HIDDEN_KEYS = new Set(['port', 'message', 'message_label', 'length']);

function decodedTable(obj) {
  const rows = Object.entries(obj || {}).filter(([k]) => !HIDDEN_KEYS.has(k));
  if (!rows.length) return '<div class="muted">Nothing decoded.</div>';
  return `<table class="decoded">${rows
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`)
    .join('')}</table>`;
}

function usageChart(readings) {
  const pts = readings.filter((r) => r.registerL != null).map((r) => ({ t: Date.parse(r.readAt), v: r.registerL }));
  if (pts.length < 2) return '<div class="muted">The register chart appears once the meter has sent two decoded readings.</div>';
  const W = 520, H = 170, L = 52, R = 10, T = 10, B = 24;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  let v0 = Math.min(...pts.map((p) => p.v)), v1 = Math.max(...pts.map((p) => p.v));
  if (v0 === v1) { v0 -= 1; v1 += 1; }
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - v0) / (v1 - v0)) * (H - T - B);
  const ticks = [0, 0.5, 1].map((f) => v0 + f * (v1 - v0));
  const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#ECEEF1" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${esc(litres(v))}</text>`).join('');
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const lab = (t, anchor) => `<text x="${x(t)}" y="${H - 6}" text-anchor="${anchor}">${esc(new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</text>`;
  return `<div class="chart" data-pts='${esc(JSON.stringify(pts))}' data-geo='${JSON.stringify({ W, L, R, T, B, H, t0, t1, v0, v1 })}'>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Cumulative register, last 31 days">
      ${grid}<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#D2D6DC"/>
      ${lab(t0, 'start')}${lab(t1, 'end')}
      <path d="${d}" stroke="#00468C" stroke-width="2"/>
      <line class="xh" y1="${T}" y2="${H - B}" stroke="#A1A8B2" stroke-width="1" visibility="hidden"/>
      <circle class="mk" r="4" fill="#00468C" stroke="#fff" stroke-width="2" visibility="hidden"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" stroke="none"/>
    </svg></div>`;
}

function wireChart(root) {
  const el = root.querySelector('.chart');
  if (!el) return;
  const pts = JSON.parse(el.dataset.pts);
  const g = JSON.parse(el.dataset.geo);
  const svg = el.querySelector('svg');
  const xh = svg.querySelector('.xh'), mk = svg.querySelector('.mk'), tip = $('#tip');
  const x = (t) => g.L + ((t - g.t0) / Math.max(1, g.t1 - g.t0)) * (g.W - g.L - g.R);
  const y = (v) => g.T + (1 - (v - g.v0) / (g.v1 - g.v0)) * (g.H - g.T - g.B);
  svg.addEventListener('mousemove', (e) => {
    const box = svg.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * g.W;
    const p = pts.reduce((a, b) => (Math.abs(x(b.t) - sx) < Math.abs(x(a.t) - sx) ? b : a));
    xh.setAttribute('x1', x(p.t)); xh.setAttribute('x2', x(p.t)); xh.setAttribute('visibility', 'visible');
    mk.setAttribute('cx', x(p.t)); mk.setAttribute('cy', y(p.v)); mk.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<div class="muted">${esc(dateTime(new Date(p.t).toISOString()))}</div><b>${esc(fmt(p.v))} L</b> register`;
    tip.style.left = `${Math.min(e.clientX + 12, innerWidth - 180)}px`;
    tip.style.top = `${e.clientY + 12}px`;
  });
  svg.addEventListener('mouseleave', () => {
    tip.hidden = true;
    xh.setAttribute('visibility', 'hidden');
    mk.setAttribute('visibility', 'hidden');
  });
}

async function openMeter(devEui, refresh = false) {
  state.open = devEui;
  const d = await api(`/api/meters/${encodeURIComponent(devEui)}`);
  if (state.open !== devEui) return;
  const m = d.meter;
  const last = d.uplinks[0];
  const notDecoded = last && last.object && last.object.decoded === false;
  const drawer = $('#drawer');
  const scroll = drawer.scrollTop;
  drawer.innerHTML = `
    <div class="dh"><div><div class="muted" style="font-size:11.5px">Meter</div><h3>${esc(m.name)}</h3>
      <div style="margin-top:4px">${statusHtml(m.status)} <span class="muted">· last seen ${ago(m.lastSeenAt)}</span></div></div>
      <button class="close" id="close" aria-label="Close">×</button></div>
    <section><div class="kv">
      <div><span>DevEUI</span><b class="mono">${esc(m.devEui)}</b></div>
      <div><span>DevAddr (session)</span><b class="mono">${esc(m.devAddr || '–')}</b></div>
      <div><span>Meter address</span><b class="mono">${esc(m.tags?.meter_addr || '–')}</b></div>
      <div><span>Serial</span><b class="mono">${esc(m.serial || m.tags?.serial || '–')}</b></div>
      <div><span>Register</span><b>${litres(m.registerL)}</b></div>
      <div><span>Credit</span><b>${litres(m.creditL)}</b></div>
      <div><span>Battery</span><b>${m.batteryPct == null ? (m.batteryV == null ? '–' : `${fmt(m.batteryV, 2)} V`) : `${fmt(m.batteryPct)}%`}</b></div>
      <div><span>Valve</span><b>${esc(m.valve ?? '–')}</b></div>
      <div><span>RSSI / SNR / SF</span><b class="mono">${m.lastRssi ?? '–'} dBm / ${fmt(m.lastSnr, 1)} dB / ${m.lastSf ? `SF${m.lastSf}` : '–'}</b></div>
      <div><span>Gateway</span><b class="mono">${esc(m.lastGatewayId ?? '–')}</b></div>
      <div><span>Joined network</span><b>${dateTime(m.joinedAt)}</b></div>
      <div><span>Frame counter</span><b>${m.lastFCnt ?? '–'}</b></div>
    </div></section>
    <section><h4>Register, last 31 days</h4>${usageChart(d.readings)}</section>
    <section><h4>Last message${last ? ` · ${esc(last.portLabel)} · ${dateTime(last.receivedAt)}` : ''}</h4>
      ${last ? decodedTable(last.object) : '<div class="muted">No uplinks received yet.</div>'}
      ${notDecoded ? `<div class="note">This port has no byte layout yet, so only the raw bytes are shown. Add the vendor's field list for port ${last.fPort} to <code>server/codec/water-meter.js</code> and run <code>npm run cs -- codec:push</code>.</div>` : ''}
    </section>
    ${d.alarms.length ? `<section><h4>Alarms</h4>${d.alarms
      .map((a) => `<div style="display:flex;gap:10px;align-items:center;padding:5px 0"><span class="sdot" style="background:${a.clearedAt ? 'var(--none)' : 'var(--bad)'}"></span>
        <b style="font-weight:600">${esc(a.type)}</b><span class="muted">${dateTime(a.raisedAt)}${a.clearedAt ? ` · cleared ${dateTime(a.clearedAt)}` : ''}</span>
        ${a.clearedAt ? '' : `<button class="btn" data-clear="${a.id}" style="margin-left:auto">Clear</button>`}</div>`)
      .join('')}</section>` : ''}
    <section><h4>Recent uplinks</h4><div class="log" style="max-height:none;margin:0 -18px">${d.uplinks.map((u) => logRow(u)).join('') || '<div class="empty">None yet.</div>'}</div></section>`;
  wireChart(drawer);
  if (refresh) drawer.scrollTop = scroll;
  drawer.hidden = false;
  $('#scrim').hidden = false;
  $('#close').onclick = closeMeter;
  drawer.querySelectorAll('[data-clear]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/alarms/${b.dataset.clear}/clear`, { method: 'POST' });
      openMeter(devEui, true);
      loadMeters();
      loadSummary();
    }),
  );
}

function closeMeter() {
  state.open = null;
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
}
$('#scrim').addEventListener('click', closeMeter);
addEventListener('keydown', (e) => e.key === 'Escape' && closeMeter());

// --- boot ---------------------------------------------------------------------------

tickClock();
setInterval(tickClock, 30_000);
await Promise.all([loadSummary(), loadMeters(), loadGateways(), loadLog()]).catch(console.error);
connectStream();
setInterval(() => {
  loadSummary().catch(console.error);
  loadGateways().catch(console.error);
  loadMeters().catch(console.error);
}, 60_000);
