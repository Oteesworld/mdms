import { useEffect, useRef, useState } from 'react';
import { Link } from '@inertiajs/react';
import L from 'leaflet';
import { Icon, type IconName } from '../components/Icon';
import { Card, Switch } from '../components/ui';
import {
  DEFAULT_LAYERS, GATEWAYS, HEAT, LAYERS, STATUS, meters, visibleMeters,
  type LayerState, type Meter,
} from '../data/fleet';
import { N, P, litres } from '../data/format';
import { queueCommand, useStore } from '../data/store';
import { COMMANDS, type CommandType } from '../data/mdm';
import { Field, Modal, toast } from '../components/overlay';
import { downloadCsv } from '../lib/csv';

export type Basemap = 'satellite' | 'streets' | 'osm';

const HOME: L.LatLngTuple = [-24.645, 25.918];
const HOME_ZOOM = 13;
/** Below this zoom meters are clustered. */
const CLUSTER_BELOW = 15;

const NOTIFICATIONS = [
  { text: 'Burst alarm · WM-104473, Block 8 (port 66)', tone: '#D6452E', t: '12:58' },
  { text: 'Tamper alarm · WM-118920, Old Naledi', tone: '#D6452E', t: '12:51' },
  { text: 'GW-GAB-06 unreachable for 3 h 12 m', tone: '#D6452E', t: '12:44' },
  { text: 'Low battery · 14 meters crossed 25% in Phase 4', tone: '#E0A00B', t: '12:30' },
  { text: 'Negative credit · 62 meters below −P 1,000', tone: '#E0A00B', t: '12:05' },
];

export function addBasemap(map: L.Map, basemap: Basemap) {
  if (basemap === 'osm') {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors · Amplified IoT' }).addTo(map);
  } else if (basemap === 'streets') {
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© OpenStreetMap · © CARTO · Amplified IoT' }).addTo(map);
  } else {
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri · © OpenStreetMap · Amplified IoT' }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', { maxZoom: 19, opacity: 0.92 }).addTo(map);
  }
}

const gwStateDot = (state: string) => (state === 'OFFLINE' ? '#D6452E' : state === 'DEGRADED' ? '#E0A00B' : '#2E9D5B');

/** Cluster: white disc with the count, ringed green/amber/red by status share. */
function clusterIcon(group: Meter[]) {
  const off = group.filter((m) => m.status === 'offline').length / group.length;
  const amb = group.filter((m) => m.status === 'amber').length / group.length;
  const okP = (1 - off - amb) * 100;
  const lateP = okP + amb * 100;
  const d = Math.min(52, 28 + Math.round(Math.sqrt(group.length) * 2.2));
  const ring = `conic-gradient(#2E9D5B 0 ${okP}%,#E0A00B ${okP}% ${lateP}%,#D6452E ${lateP}% 100%)`;
  return {
    online: okP,
    icon: L.divIcon({
      className: '',
      iconSize: [d, d],
      iconAnchor: [d / 2, d / 2],
      html: `<div class="map-cluster" style="width:${d}px;height:${d}px;background:${ring}"><div style="font-size:${d > 40 ? 12.5 : 11}px">${group.length}</div></div>`,
    }),
  };
}

function gatewayIcon(id: string, state: string) {
  return L.divIcon({
    className: '',
    iconSize: [96, 22],
    iconAnchor: [48, 11],
    html: `<div class="map-gw-wrap"><div class="map-gw"><span style="background:${gwStateDot(state)}"></span>${id}</div></div>`,
  });
}

export function NetworkMap({ basemap = 'satellite', showCoverage = true }: { basemap?: Basemap; showCoverage?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const boxingRef = useRef(false);

  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [rings, setRings] = useState(showCoverage);
  const [zoom, setZoom] = useState(HOME_ZOOM);
  const [sel, setSel] = useState<Meter | null>(null);
  const [autoFly, setAutoFly] = useState(false);
  const [notif, setNotif] = useState(false);
  const [boxing, setBoxing] = useState(false);
  const [selection, setSelection] = useState<Meter[]>([]);
  const boxCount = selection.length;
  const setBoxCount = (n: number) => { if (n === 0) setSelection([]); };
  const [bulk, setBulk] = useState(false);

  const visible = visibleMeters(layers);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  // Create the map once.
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { zoomControl: false, preferCanvas: true }).setView(HOME, HOME_ZOOM);
    addBasemap(map, basemap);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on('zoomend', () => setZoom(map.getZoom()));

    // Rectangle selection, active while the Select tool is on.
    let anchor: L.LatLng | null = null;
    let rect: L.Rectangle | null = null;
    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      if (!boxingRef.current || rect) return;
      anchor = e.latlng;
      rect = L.rectangle(L.latLngBounds(anchor, anchor), { color: '#00468C', weight: 1.5, fillColor: '#00468C', fillOpacity: 0.14, dashArray: '4 3' }).addTo(map);
    });
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (rect && anchor) rect.setBounds(L.latLngBounds(anchor, e.latlng));
    });
    map.on('mouseup', () => {
      if (!rect) return;
      const bounds = rect.getBounds();
      const picked = visibleMeters(layersRef.current).filter((m) => bounds.contains([m.lat, m.lng]));
      map.removeLayer(rect);
      rect = null;
      anchor = null;
      setBoxing(false);
      setSelection(picked);
    });

    const t = setTimeout(() => map.invalidateSize(), 60);
    // Re-measure when the container changes width (e.g. the side menu is pinned or unpinned).
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [basemap]);

  // Select tool: lock panning while drawing.
  useEffect(() => {
    boxingRef.current = boxing;
    const map = mapRef.current;
    if (!map) return;
    if (boxing) map.dragging.disable();
    else map.dragging.enable();
  }, [boxing]);

  // Auto Fly To: cycle through offline meters.
  useEffect(() => {
    if (!autoFly) return;
    const offline = meters().filter((m) => m.status === 'offline');
    const id = setInterval(() => {
      const m = offline[Math.floor(Math.random() * offline.length)];
      if (m && mapRef.current) {
        mapRef.current.flyTo([m.lat, m.lng], 17, { duration: 1.8 });
        setSel(m);
      }
    }, 6500);
    return () => clearInterval(id);
  }, [autoFly]);

  // Redraw overlays whenever layers, rings or zoom change.
  useEffect(() => {
    const map = mapRef.current;
    const lg = layerRef.current;
    if (!map || !lg) return;
    lg.clearLayers();

    if (rings) {
      GATEWAYS.forEach((g) =>
        L.circle([g.lat, g.lng], {
          radius: g.r, color: g.state === 'ONLINE' ? '#FFFFFF' : g.dot, weight: 1.2, opacity: 0.8,
          fillColor: '#FFFFFF', fillOpacity: 0.04, dashArray: '4 6', interactive: false,
        }).addTo(lg),
      );
    }

    const pts = visibleMeters(layers);
    const heat = Object.keys(HEAT).find((k) => layers[k]);
    const colour = (m: Meter) => (heat ? HEAT[heat](m) : STATUS[m.status].dot);
    const dot = (m: Meter) =>
      L.circleMarker([m.lat, m.lng], { radius: zoom >= 17 ? 6 : 4.5, color: '#FFFFFF', weight: 1.2, fillColor: colour(m), fillOpacity: 1 })
        .bindTooltip(`${m.id} · ${m.sub}<br>${STATUS[m.status].label} · ${m.rssi} dBm · batt ${m.batt}% · fw ${m.fw}`, { direction: 'top' })
        .on('click', () => setSel(m))
        .addTo(lg);

    if (zoom < CLUSTER_BELOW && !heat) {
      const cell = (0.42 * 360) / Math.pow(2, zoom);
      const grid = new Map<string, Meter[]>();
      pts.forEach((m) => {
        const k = Math.floor(m.lat / cell) + '_' + Math.floor(m.lng / cell);
        const g = grid.get(k);
        if (g) g.push(m);
        else grid.set(k, [m]);
      });
      grid.forEach((g) => {
        if (g.length < 4) {
          g.forEach(dot);
          return;
        }
        const lat = g.reduce((a, m) => a + m.lat, 0) / g.length;
        const lng = g.reduce((a, m) => a + m.lng, 0) / g.length;
        const { icon, online } = clusterIcon(g);
        L.marker([lat, lng], { icon })
          .bindTooltip(`${N(g.length)} meters · ${Math.round(online)}% online`, { direction: 'top' })
          .on('click', () => map.flyTo([lat, lng], Math.min(18, zoom + 3)))
          .addTo(lg);
      });
    } else {
      pts.forEach(dot);
    }

    if (layers.gwLinks) {
      const step = Math.max(1, Math.round(pts.length / 340));
      pts.forEach((m, i) => {
        if (i % step === 0) {
          L.polyline([[m.lat, m.lng], [m.gwLat, m.gwLng]], {
            color: m.rssi > -95 ? '#7ee08a' : m.rssi > -108 ? '#ffd166' : '#ff6b6b', weight: 0.8, opacity: 0.5,
          }).addTo(lg);
        }
      });
    }

    GATEWAYS.forEach((g) =>
      L.marker([g.lat, g.lng], { icon: gatewayIcon(g.id, g.state) })
        .bindTooltip(`<b>${g.id}</b><br>${g.site}<br>${N(g.meters)} nodes · ${g.rssi}`, { direction: 'top' })
        .on('click', () => map.flyTo([g.lat, g.lng], 15))
        .addTo(lg),
    );
  }, [layers, rings, zoom, basemap]);

  const toggleLayer = (k: string) => {
    setLayers((s) => ({ ...s, [k]: !s[k] }));
    setBoxCount(0);
  };

  const tools: { icon: IconName; tip: string; go: () => void }[] = [
    { icon: 'zoomIn', tip: 'Zoom in', go: () => mapRef.current?.zoomIn() },
    { icon: 'zoomOut', tip: 'Zoom out', go: () => mapRef.current?.zoomOut() },
    { icon: 'locate', tip: 'Centre on Gaborone', go: () => mapRef.current?.flyTo(HOME, HOME_ZOOM) },
    {
      icon: 'fit', tip: 'Fit visible meters',
      go: () => visible.length && mapRef.current?.fitBounds(L.latLngBounds(visible.map((m) => [m.lat, m.lng] as L.LatLngTuple))),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="map-frame">
        <div ref={el} className={`map-canvas${boxing ? ' boxing' : ''}`} />

        <div className="map-tools">
          {tools.map((t) => (
            <button key={t.tip} type="button" title={t.tip} aria-label={t.tip} onClick={t.go}><Icon name={t.icon} /></button>
          ))}
        </div>

        <div className="map-right">
          <button type="button" className="map-toggle" onClick={() => setAutoFly((v) => !v)} aria-pressed={autoFly}>
            <Switch on={autoFly} /><span>Auto Fly To</span>
          </button>
          <button type="button" className="map-toggle" onClick={() => setNotif((v) => !v)} aria-pressed={notif}>
            <Switch on={notif} /><span>Notifications</span>
          </button>
          <div className="map-layers">
            <div className="map-layers-head">
              <span className="flex1">Layers</span>
              <button type="button" onClick={() => { setLayers(DEFAULT_LAYERS); setBoxCount(0); }}>Reset</button>
            </div>
            <div className="map-layers-list">
              {LAYERS.map(([k, label]) => {
                const on = !!layers[k];
                return (
                  <button key={k} type="button" className={`map-layer${on ? ' on' : ''}`} onClick={() => toggleLayer(k)} role="checkbox" aria-checked={on}>
                    <span className="map-check">{on ? '✓' : ''}</span>
                    <span className="ellipsis flex1">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button type="button" className={`map-select${boxing ? ' on' : ''}`} onClick={() => { setBoxing((b) => !b); if (!boxing) setBoxCount(0); }} aria-pressed={boxing}>
          <Icon name="select" size={15} /><span>Select</span>
        </button>

        {boxCount > 0 && (
          <div className="map-selection">
            <span className="mono">{N(boxCount)} meters in selection</span>
            <button type="button" style={{ color: '#8ee0c8' }} onClick={() => setBulk(true)}>Queue downlink</button>
            <button type="button" style={{ color: '#9fb4d0' }} onClick={() => {
              downloadCsv('map-selection', ['Meter', 'Suburb', 'Status', 'Latitude', 'Longitude', 'Gateway', 'RSSI', 'SNR', 'Battery %', 'Balance (P)', 'Firmware'],
                selection.map((m) => [m.id, m.sub, STATUS[m.status].label, m.lat.toFixed(5), m.lng.toFixed(5), m.gw, m.rssi, m.snr, m.batt, m.bal.toFixed(2), m.fw]));
              toast(`Exported ${selection.length} meters`);
            }}>Export</button>
            <button type="button" aria-label="Clear selection" style={{ color: '#7d8ba1', fontSize: 11, fontWeight: 400 }} onClick={() => setBoxCount(0)}>✕</button>
          </div>
        )}

        {notif && (
          <div className="map-notifs">
            <div className="map-notifs-head"><span className="dot" style={{ width: 6, height: 6, background: 'var(--ok)' }} /><span className="flex1">Live notifications</span></div>
            {NOTIFICATIONS.map((n) => (
              <div key={n.text} className="map-notif">
                <span className="dot" style={{ width: 6, height: 6, background: n.tone, marginTop: 4 }} />
                <span className="flex1">{n.text}</span>
                <span className="map-notif-t">{n.t}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Card style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 11px' }}>
        <span className="label">Gateways</span>
        {GATEWAYS.map((g) => (
          <button key={g.id} type="button" className="gw-chip" onClick={() => mapRef.current?.flyTo([g.lat, g.lng], 15)}>
            <span className="dot" style={{ background: g.dot }} />
            <span className="mono" style={{ fontWeight: 600, fontSize: 11, color: 'var(--ink)' }}>{g.id}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{N(g.meters)} nodes · {g.rssi}</span>
          </button>
        ))}
        <span className="flex1" />
        <button type="button" className="link" style={{ fontSize: 11.5 }} onClick={() => setRings((r) => !r)}>
          {rings ? 'Hide coverage rings' : 'Show coverage rings'}
        </button>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
          {N(visible.length)} of {N(meters().length)} plotted · zoom {zoom} · {zoom < CLUSTER_BELOW ? 'clustered' : 'individual meters'}
        </span>
      </Card>

      {sel && <MeterPanel m={sel} onClose={() => setSel(null)} />}
      {bulk && <BulkCommand meters={selection} onClose={() => setBulk(false)} onSent={() => { setBulk(false); setSelection([]); }} />}
    </div>
  );
}

function MeterPanel({ m, onClose }: { m: Meter; onClose: () => void }) {
  const last = useStore((s) => s.commands.find((c) => c.meter === m.id));
  const closeValve = () => {
    if (window.confirm(`Close the valve on ${m.id}? The customer loses supply until it is reopened.`)) queueCommand(m.id, 'Close valve');
  };
  const fields = [
    ['Suburb', m.sub], ['Latitude', m.lat.toFixed(5)], ['Longitude', m.lng.toFixed(5)],
    ['Gateway', m.gw], ['RSSI', m.rssi + ' dBm'], ['SNR', m.snr + ' dB'],
    ['Spread factor', m.sf], ['Packet loss', m.loss + '%'], ['Battery', m.batt + '%'],
    ['Balance', P(m.bal)], ['Usage MTD', litres(m.usage)], ['Last uplink', m.seen],
  ];
  return (
    <Card style={{ padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{m.id}</span>
        <span style={{ fontWeight: 600, fontSize: 11, background: STATUS[m.status].dot, color: '#fff', padding: '2px 7px', borderRadius: 4 }}>{STATUS[m.status].label}</span>
        <span className="flex1" />
        {last && <span className="sub">{last.cmd}: {last.status.toLowerCase()} · <Link href="/operations">queue</Link></span>}
        <button type="button" className="btn" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => queueCommand(m.id, 'On-demand read')}>Read now</button>
        <button type="button" className="btn" style={{ fontSize: 11, padding: '5px 10px', color: 'var(--bad)', borderColor: '#F0C4C0' }} onClick={closeValve}>Close valve</button>
        <button type="button" onClick={onClose} style={{ fontSize: 11, color: 'var(--muted)' }}>Close ✕</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 9 }}>
        {fields.map(([k, v]) => (
          <div key={k} style={{ border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 10px', background: 'var(--surface-2)' }}>
            <div className="mono" style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--muted)', marginBottom: 3, letterSpacing: '.05em' }}>{k}</div>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink)' }}>{v}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Queue one downlink command for every meter in the map selection. */
function BulkCommand({ meters, onClose, onSent }: { meters: Meter[]; onClose: () => void; onSent: () => void }) {
  const [cmd, setCmd] = useState<CommandType>('On-demand read');
  const offline = meters.filter((m) => m.status === 'offline').length;
  const send = () => {
    if (cmd === 'Close valve' && !window.confirm(`Close the valve on ${meters.length} meters? Every customer in the selection loses supply.`)) return;
    queueCommand(`${N(meters.length)} meters (bulk)`, cmd);
    toast(`${cmd} queued for ${N(meters.length)} meters`);
    onSent();
  };
  return (
    <Modal title={`Queue downlink · ${N(meters.length)} meters`} onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="button" className="btn-primary" onClick={send}>Queue for {N(meters.length)} meters</button>
    </>}>
      <Field label="Command"><select value={cmd} onChange={(e) => setCmd(e.target.value as CommandType)}>{COMMANDS.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <div className="sub" style={{ lineHeight: 1.5 }}>
        Commands go out on each meter’s next uplink (LoRaWAN class A).{offline > 0 && ` ${N(offline)} of these meters are offline and will receive it when they reconnect.`} Track progress in Field operations → Remote commands.
      </div>
    </Modal>
  );
}
