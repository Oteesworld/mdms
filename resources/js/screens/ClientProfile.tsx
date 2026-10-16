import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@inertiajs/react';
import L from 'leaflet';
import { Icon, type IconName } from '../components/Icon';
import { Badge, Card, TableHead } from '../components/ui';
import { TABLES, type TableScreen } from '../data/clients';
import { makeDevice, type AlarmType, type Device } from '../data/device';
import { N, P } from '../data/format';
import { addBasemap } from './NetworkMap';
import { useClientProps } from '../data/store';

const ALARM_ICON: Record<AlarmType, IconName> = {
  'Burst alarm': 'bulk',
  'Valve flow': 'valve',
  'Magnetic tamper': 'magnet',
  'Hardware error': 'chip',
  'Installation mode': 'operations',
};

const USAGE_BAND = { low: '#B8DCD9', medium: '#5FA9A6', high: '#1F5F62' };
const MSG_TABS = ['Timeline', 'Usage', 'Tokens', 'Sales'] as const;
type MsgTab = (typeof MSG_TABS)[number];

const parseP = (s: string) => Number(s.replace(/[P ,]/g, ''));

/** Full client profile with a device dashboard for each of the client's meters. */
export function ClientProfile({ screen, index }: { screen: TableScreen; index: number }) {
  const cfg = TABLES[screen];
  const k = cfg.kyc!(index);
  const props = useClientProps(k.id, k.props);
  const [meterIdx, setMeterIdx] = useState(0);
  const prop = props[Math.min(meterIdx, props.length - 1)];
  const dev = useMemo(
    () => makeDevice(prop.meter, { plot: prop.plot, business: screen === 'business', balance: parseP(prop.bal) }),
    [prop.meter, prop.plot, prop.bal, screen],
  );

  return (
    <div className="profile">
      <Card style={{ padding: '18px 20px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Link className="back-link" href={'/' + screen}><Icon name="back" size={15} />{cfg.name}</Link>
          <span className="flex1" />
          <span className={`status-pill ${dev.online ? 'on' : 'off'}`}>
            <span className="dot" />{dev.online ? 'Online' : 'Offline'}
          </span>
          <span className="sub">Last seen <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{dev.lastSeen}</b></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div className="mono" style={{ width: 42, height: 42, flex: 'none', borderRadius: 8, background: 'var(--navy-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, color: 'var(--navy)' }}>{k.initials}</div>
          <div className="flex1" style={{ minWidth: 200 }}>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.2px' }}>{k.name}</div>
            <div className="meta" style={{ fontSize: 11 }}>{k.id} · {k.kind} · {k.propCount}</div>
          </div>
          <Badge status={k.pct === 100 ? 'Verified' : 'Pending'} label={`KYC ${k.pct}%`} />
        </div>
        {props.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            {props.map((p, i) => (
              <button key={p.meter} type="button" className={`chip${i === meterIdx ? ' on' : ''}`} aria-pressed={i === meterIdx} onClick={() => setMeterIdx(i)}>
                <span className="mono">{p.meter}</span> · {p.plot.split(',')[0]}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Overview dev={dev} business={screen === 'business'} />

      <div className="grid profile-3" style={{ marginBottom: 12 }}>
        <KeyValues title="Device information" icon="meters" rows={dev.info} />
        <KeyValues title="Connectivity" icon="network" rows={dev.connectivity} />
        <LocationCard dev={dev} occupant={prop.tenant} />
      </div>

      <div className="grid profile-2" style={{ marginBottom: 12 }}>
        <Gateways dev={dev} />
        <Notifications dev={dev} />
      </div>

      <div className="grid profile-2" style={{ marginBottom: 12 }}>
        <Panel title={dev.online ? 'Hourly usage · today' : 'Hourly usage · ' + dev.lastDay + ' (last reported)'} note="litres per hour">
          <Bars
            values={dev.hourly}
            labels={dev.hourly.map((_, h) => (h % 3 === 0 ? String(h).padStart(2, '0') : ''))}
            color={(v) => (v < dev.bands[0] ? USAGE_BAND.low : v < dev.bands[1] ? USAGE_BAND.medium : USAGE_BAND.high)}
            tip={(v, i) => `${String(i).padStart(2, '0')}:00 · ${N(v)} L`}
          />
          <div className="legend">
            <Legend color={USAGE_BAND.low} label={`Low < ${N(dev.bands[0])} L`} />
            <Legend color={USAGE_BAND.medium} label={`Medium ${N(dev.bands[0])}–${N(dev.bands[1])} L`} />
            <Legend color={USAGE_BAND.high} label={`High > ${N(dev.bands[1])} L`} />
          </div>
        </Panel>
        <Panel title="Daily usage · last 14 days" note={`${N(Math.round(dev.daily.reduce((a, d) => a + d.l, 0) / 14))} L average`}>
          <Bars values={dev.daily.map((d) => d.l)} labels={dev.daily.map((d, i) => (i % 2 === 1 ? d.label.slice(0, 2) : ''))} color={() => 'var(--teal)'} tip={(v, i) => `${dev.daily[i].label} · ${N(v)} L`} />
        </Panel>
      </div>

      <div className="grid profile-2" style={{ marginBottom: 12 }}>
        <Panel title="Leakage totals · last 30 days" note={`${N(dev.overview.leak30L)} L lost`}>
          {dev.overview.leak30L ? (
            <Bars values={dev.leak.map((d) => d.l)} labels={dev.leak.map((d, i) => (i % 5 === 4 ? d.label.slice(0, 2) : ''))} color={() => '#D99A2B'} tip={(v, i) => `${dev.leak[i].label} · ${N(v)} L leaked`} />
          ) : (
            <div className="empty-chart">No leakage detected in the last 30 days.</div>
          )}
          <div className="sub" style={{ marginTop: 8 }}>Leakage is flow that never drops to zero between 01:00 and 05:00, counted per night.</div>
        </Panel>
        <Panel title="Credit remaining · last 30 days" note={P(dev.overview.creditP) + ' now'}>
          <CreditChart dev={dev} />
        </Panel>
      </div>

      <Messages dev={dev} />
      <FportTimeline dev={dev} />
    </div>
  );
}

/* ---------- Overview ---------- */

function Overview({ dev, business }: { dev: Device; business: boolean }) {
  const o = dev.overview;
  const tiles: { icon: IconName; label: string; value: string; sub: string; tone: string; bg: string }[] = [
    { icon: 'bulk', label: 'Daily usage', value: N(o.dailyL) + ' L', sub: dev.online ? 'today so far' : 'last reported day, ' + dev.lastDay, tone: '#2A7A7E', bg: '#E4F1F0' },
    { icon: 'coin', label: 'Estimated cost', value: P(o.costToday), sub: `${P(o.costMtd)} this month · ${business ? 'business' : 'band 2'} tariff`, tone: '#00468C', bg: 'var(--navy-tint)' },
    { icon: 'leak', label: 'Water loss', value: N(o.leak30L) + ' L', sub: o.leak30L ? 'leakage, last 30 days' : 'no leaks in 30 days', tone: o.leak30L ? '#965A00' : '#237A48', bg: o.leak30L ? '#FAF0DC' : '#E6F2EA' },
    { icon: 'battery', label: 'Battery', value: o.battPct + '%', sub: o.battV.toFixed(2) + ' V' + (o.battPct < 40 ? ' · replace soon' : ''), tone: o.battPct < 40 ? '#965A00' : '#237A48', bg: o.battPct < 40 ? '#FAF0DC' : '#E6F2EA' },
    { icon: 'wallet', label: 'Credit remaining', value: P(o.creditP), sub: o.creditP > 0 ? `≈ ${N(o.creditL)} L · about ${o.daysLeft} days` : 'valve closes at zero credit', tone: o.creditP > 0 ? '#00468C' : '#B3261E', bg: o.creditP > 0 ? 'var(--navy-tint)' : '#FAE8E6' },
  ];
  return (
    <div className="grid g-5" style={{ marginBottom: 12 }}>
      {tiles.map((t) => (
        <Card key={t.label} style={{ padding: '16px 18px', display: 'flex', gap: 11, alignItems: 'flex-start' }}>
          <span className="tile-icon" style={{ color: t.tone, background: t.bg }}><Icon name={t.icon} size={18} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="label" style={{ marginBottom: 5 }}>{t.label}</div>
            <div className="kpi-value" style={{ fontSize: 18, color: t.tone === '#B3261E' ? t.tone : 'var(--ink)' }}>{t.value}</div>
            <div className="sub" style={{ marginTop: 4 }}>{t.sub}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ---------- Building blocks ---------- */

function Panel({ title, note, children, icon }: { title: string; note?: ReactNode; children: ReactNode; icon?: IconName }) {
  return (
    <Card style={{ padding: '18px 20px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 11 }}>
        {icon && <span style={{ color: 'var(--muted)', alignSelf: 'center' }}><Icon name={icon} size={15} /></span>}
        <span className="card-title flex1">{title}</span>
        {note && <span className="meta">{note}</span>}
      </div>
      {children}
    </Card>
  );
}

function KeyValues({ title, icon, rows }: { title: string; icon: IconName; rows: [string, string][] }) {
  return (
    <Panel title={title} icon={icon}>
      <div className="kv">
        {rows.map(([k, v]) => (
          <div key={k}><span>{k}</span><span className="mono">{v}</span></div>
        ))}
      </div>
    </Panel>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />{label}</span>;
}

function Bars({ values, labels, color, tip, height = 130 }: { values: number[]; labels: string[]; color: (v: number, i: number) => string; tip: (v: number, i: number) => string; height?: number }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: values.length > 20 ? 2 : 4, height }}>
      {values.map((v, i) => (
        <div key={i} title={tip(v, i)} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4, height: '100%' }}>
          <div style={{ width: '100%', height: (v / max) * 100 + '%', minHeight: v ? 2 : 0, background: color(v, i), borderRadius: '2px 2px 0 0' }} />
          <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--faint)', height: 12, whiteSpace: 'nowrap' }}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Location ---------- */

function LocationCard({ dev, occupant }: { dev: Device; occupant: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([dev.lat, dev.lng], 16);
    addBasemap(map, 'satellite');
    L.circleMarker([dev.lat, dev.lng], { radius: 8, color: '#fff', weight: 2, fillColor: dev.online ? '#2E9D5B' : '#D6452E', fillOpacity: 1 })
      .bindTooltip(dev.meter, { direction: 'top' }).addTo(map);
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => { clearTimeout(t); map.remove(); };
  }, [dev.lat, dev.lng, dev.meter, dev.online]);
  return (
    <Panel title="Location" icon="sites" note={<Link href="/map">Network map</Link>}>
      <div ref={el} className="profile-map" />
      <div className="kv" style={{ marginTop: 10 }}>
        <div><span>Coordinates</span><span className="mono">{dev.lat.toFixed(5)}, {dev.lng.toFixed(5)}</span></div>
        <div><span>Address</span><span>{dev.address}</span></div>
        <div><span>Occupant</span><span>{occupant}</span></div>
      </div>
    </Panel>
  );
}

/* ---------- Gateways & notifications ---------- */

function Gateways({ dev }: { dev: Device }) {
  return (
    <Card clip style={{ minWidth: 0 }}>
      <div className="card-head">
        <span style={{ color: 'var(--muted)' }}><Icon name="gateways" size={15} /></span>
        <span className="card-title flex1">Gateways · last 3 heard</span>
        <span className="sub">30 days</span>
      </div>
      <div className="table-wrap">
        <table className="tbl compact roomy">
          <TableHead cols={[{ label: 'Gateway' }, { label: 'Messages', align: 'right' }, { label: 'Avg RSSI', align: 'right' }, { label: 'Avg SNR', align: 'right' }, { label: 'Last heard', align: 'right' }]} />
          <tbody>
            {dev.gateways.map((g, i) => (
              <tr key={g.id}>
                <td>
                  <div className="mono" style={{ fontWeight: 600 }}>{g.id}{i === 0 && <span className="badge" style={{ marginLeft: 6, background: 'var(--navy-tint)', color: 'var(--navy)', fontFamily: 'var(--sans)', fontSize: 10 }}>serving</span>}</div>
                  <div className="sub">{g.site}</div>
                </td>
                <td className="mono num">{N(g.messages)}</td>
                <td className="mono num" style={{ color: g.rssi < -105 ? 'var(--warn-ink)' : 'var(--ink)' }}>{g.rssi} dBm</td>
                <td className="mono num" style={{ color: g.snr < 0 ? 'var(--warn-ink)' : 'var(--ink)' }}>{g.snr} dB</td>
                <td className="mono num" style={{ color: 'var(--muted)' }}>{g.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Notifications({ dev }: { dev: Device }) {
  const types: AlarmType[] = ['Burst alarm', 'Valve flow', 'Magnetic tamper', 'Hardware error', 'Installation mode'];
  return (
    <Card clip style={{ minWidth: 0 }}>
      <div className="card-head">
        <span style={{ color: 'var(--muted)' }}><Icon name="network" size={15} /></span>
        <span className="card-title flex1">Meter notifications</span>
        <span className="sub">{dev.alarms.filter((a) => a.active).length} active</span>
      </div>
      <div className="alarm-types">
        {types.map((t) => {
          const n = dev.alarms.filter((a) => a.type === t).length;
          const active = dev.alarms.some((a) => a.type === t && a.active);
          return (
            <span key={t} className={`alarm-type${active ? ' active' : n ? '' : ' none'}`} title={`${n} in history`}>
              <Icon name={ALARM_ICON[t]} size={14} />{t}<b>{n}</b>
            </span>
          );
        })}
      </div>
      <div style={{ maxHeight: 214, overflowY: 'auto' }}>
        {dev.alarms.map((a, i) => (
          <div key={i} className="alarm-row">
            <span className={`alarm-icon${a.active ? ' active' : ''}`}><Icon name={ALARM_ICON[a.type]} size={15} /></span>
            <div className="flex1" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>{a.type} {a.active && <Badge status="Arrears" label="Active" />}</div>
              <div className="sub">{a.detail}</div>
            </div>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{a.at}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Credit ---------- */

function CreditChart({ dev }: { dev: Device }) {
  const W = 520, H = 150, padL = 44, padB = 18, padT = 8;
  const vals = dev.credit.map((d) => d.p);
  const max = Math.max(...vals, 1) * 1.1;
  const min = Math.min(0, ...vals);
  const x = (i: number) => padL + (i / (vals.length - 1)) * (W - padL - 6);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const path = vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const ticks = [0, max / 2, max].map((v) => Math.round(v));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 150, display: 'block' }} role="img" aria-label="Credit remaining over the last 30 days">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - 6} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#D2D6DC' : '#ECEEF1'} />
          <text x={padL - 6} y={y(t) + 3} fontSize={9} textAnchor="end" fill="#A1A8B2" fontFamily="IBM Plex Mono, monospace">{t >= 1000 ? Math.round(t / 1000) + 'k' : t}</text>
        </g>
      ))}
      <path d={`${path} L${x(vals.length - 1)} ${y(min)} L${padL} ${y(min)} Z`} fill="#00468C" fillOpacity={0.07} />
      <path d={path} fill="none" stroke="#00468C" strokeWidth={2} strokeLinejoin="round" />
      {dev.credit.map((d, i) => d.topup > 0 && (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.p)} r={4} fill="#fff" stroke="#2E9D5B" strokeWidth={2} />
          <title>{`${d.label} · top-up ${P(d.topup)} → ${P(d.p)}`}</title>
        </g>
      ))}
      {dev.credit.map((d, i) => (i % 7 === 1 || i === dev.credit.length - 1) && (
        <text key={'l' + i} x={x(i)} y={H - 4} fontSize={9} textAnchor={i === dev.credit.length - 1 ? 'end' : 'middle'} fill="#A1A8B2" fontFamily="IBM Plex Mono, monospace">{d.label}</text>
      ))}
    </svg>
  );
}

/* ---------- Communication & messages ---------- */

function Messages({ dev }: { dev: Device }) {
  const [tab, setTab] = useState<MsgTab>('Timeline');
  return (
    <Card clip style={{ marginBottom: 12 }}>
      <div className="card-head" style={{ flexWrap: 'wrap' }}>
        <span className="card-title flex1">Communication & messages</span>
        <div className="segmented" role="tablist">
          {MSG_TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              style={tab === t ? { background: 'var(--navy)', color: '#fff', fontWeight: 600 } : undefined}>{t}</button>
          ))}
        </div>
      </div>
      <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table className="tbl compact">
          {tab === 'Timeline' && (
            <>
              <TableHead cols={[{ label: 'Time' }, { label: 'Type' }, { label: 'Event' }]} />
              <tbody>{dev.timeline.map((e, i) => (
                <tr key={i}><td className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{e.t}</td><td style={{ fontWeight: 600, color: e.tone ?? 'var(--ink)' }}>{e.kind}</td><td>{e.text}</td></tr>
              ))}</tbody>
            </>
          )}
          {tab === 'Usage' && (
            <>
              <TableHead cols={[{ label: 'Reading time' }, { label: 'Register', align: 'right' }, { label: 'Used', align: 'right' }, { label: 'Flow', align: 'right' }]} />
              <tbody>{dev.usage.map((u, i) => (
                <tr key={i}><td className="mono" style={{ color: 'var(--muted)' }}>{u.t}</td><td className="mono num">{u.reading}</td><td className="mono num" style={{ color: 'var(--teal)' }}>{N(u.l)} L</td><td className="mono num" style={{ color: 'var(--muted)' }}>{u.flow}</td></tr>
              ))}</tbody>
            </>
          )}
          {tab === 'Tokens' && (
            <>
              <TableHead cols={[{ label: 'Issued' }, { label: 'Token' }, { label: 'Units', align: 'right' }, { label: 'Status', align: 'right' }]} />
              <tbody>{dev.tokens.map((t, i) => (
                <tr key={i}><td className="mono" style={{ color: 'var(--muted)' }}>{t.t}</td><td className="mono">{t.token}</td><td className="mono num" style={{ color: 'var(--teal)' }}>{t.units}</td><td className="num"><Badge status="Verified" label={t.status} /></td></tr>
              ))}</tbody>
            </>
          )}
          {tab === 'Sales' && (
            <>
              <TableHead cols={[{ label: 'Date' }, { label: 'Receipt' }, { label: 'Channel' }, { label: 'Bought by' }, { label: 'Amount', align: 'right' }]} />
              <tbody>{dev.sales.map((s, i) => (
                <tr key={i}><td className="mono" style={{ color: 'var(--muted)' }}>{s.t}</td><td className="mono">{s.receipt}</td><td>{s.channel}</td><td style={{ color: 'var(--muted)' }}>{s.buyer}</td><td className="mono num" style={{ fontWeight: 600 }}>{s.amount}</td></tr>
              ))}</tbody>
            </>
          )}
        </table>
      </div>
    </Card>
  );
}

/* ---------- FPort timeline ---------- */

function FportTimeline({ dev }: { dev: Device }) {
  const W = 1000, laneH = 26, padL = 150, padR = 12, top = 6;
  const H = top + dev.fports.length * laneH + 22;
  const x = (hAgo: number) => padL + (1 - hAgo / 48) * (W - padL - padR);
  const total = dev.fports.reduce((a, l) => a + l.hits.length, 0);
  return (
    <Panel title="FPort timeline · last 48 hours" note={`${total} uplinks`}>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 640, height: H, display: 'block' }} role="img" aria-label="Uplinks per LoRaWAN port over the last 48 hours">
          {[48, 36, 24, 12, 0].map((h) => (
            <g key={h}>
              <line x1={x(h)} x2={x(h)} y1={top} y2={H - 20} stroke="#ECEEF1" />
              <text x={x(h)} y={H - 6} fontSize={10} textAnchor="middle" fill="#A1A8B2" fontFamily="IBM Plex Mono, monospace">{h ? `-${h} h` : 'now'}</text>
            </g>
          ))}
          {dev.fports.map((lane, i) => {
            const cy = top + i * laneH + laneH / 2;
            const tone = lane.alarm ? '#B3261E' : lane.port === 5 || lane.port === 225 ? '#97B8DC' : lane.port === 210 ? '#2E9D5B' : '#00468C';
            return (
              <g key={lane.port}>
                <rect x={padL} y={cy - laneH / 2 + 2} width={W - padL - padR} height={laneH - 4} fill={i % 2 ? '#FAFBFC' : '#fff'} />
                <text x={8} y={cy + 4} fontSize={11.5} fill="#49515C" fontFamily="Public Sans, sans-serif">
                  <tspan fontFamily="IBM Plex Mono, monospace" fontWeight={600} fill="#181D23">{lane.port}</tspan>  {lane.name}
                </text>
                <text x={padL - 8} y={cy + 4} fontSize={10} textAnchor="end" fill="#A1A8B2" fontFamily="IBM Plex Mono, monospace">{lane.hits.length || '—'}</text>
                {lane.hits.map((h, j) => (
                  <rect key={j} x={x(h) - 2} y={cy - 7} width={4} height={14} rx={1.5} fill={tone}>
                    <title>{`Port ${lane.port} · ${lane.name} · ${h < 1 ? Math.round(h * 60) + ' min' : h.toFixed(1) + ' h'} ago`}</title>
                  </rect>
                ))}
              </g>
            );
          })}
          {!dev.online && (
            <g>
              <rect x={x(Math.min(48, dev.fports[1].hits[0] ?? 48))} y={top} width={W - padR - x(Math.min(48, dev.fports[1].hits[0] ?? 48))} height={H - 26 - top} fill="#FAE8E6" opacity={0.6} />
              <text x={W - padR - 6} y={top + 14} fontSize={10.5} textAnchor="end" fill="#B3261E" fontFamily="Public Sans, sans-serif">offline · no uplinks</text>
            </g>
          )}
        </svg>
      </div>
    </Panel>
  );
}
