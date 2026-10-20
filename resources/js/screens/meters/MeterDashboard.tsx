import { Link, router, usePage } from '@inertiajs/react';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { Badge, Card, TableHead } from '../../components/ui';
import { toast } from '../../components/overlay';
import { Bars, KeyValues, Legend, LineChart, Panel } from '../../components/charts';
import { downloadCsv } from '../../lib/csv';
import { N } from '../../data/format';
import { addBasemap } from '../NetworkMap';
import { day, hour, KeyCode, litres, m3, REPORTS_PER_DAY, StatePill, when, type MeterState } from './common';

interface Meter {
  serial: string; meter_address: string; dev_eui: string; join_eui: string; has_app_key: boolean; lorawan_region: string; device_class: string;
  reporting_hours: number; sampling_minutes: number; sts_sgc: string; sts_krn: number; sts_ti: string;
  plot: string; suburb: string; lat: number | null; lng: number | null; installed_at: string; initial_reading: number; seal_no: string;
  client_id: string; occupant: string; vending_party: string; commissioning: Record<string, boolean>;
  model: string; firmware: string | null; network_status: string; state: MeterState; lastSeen: string;
  lastUplinkAt: string | null; joinedAt: string | null; nextReportAt: string | null;
  client_name: string | null; type: string; kyc: string; account_status: string;
  total: number | null; remaining: number | null; flow: number | null; battery_v: number | null; battery_pct: number; temperature: number | null;
  status_code: number | null; valve_state: string; last_rssi: number | null; last_snr: number | null; last_fcnt: number | null; last_gateway: string | null;
  hasTelemetry: boolean; usedToday: number; avgDaily: number | null;
}
interface Reading { t: string; total: number; flow: number; rtu: number | null; volt: number | null; temp: number | null; status: number | null; use: number; totalRev: number; flowRev: number; remaining: number | null }
interface Alarm { type: string; label: string; source: string; detail: string; raised: string; cleared: string | null }
interface Uplink { id: number; t: string; event: string; fcnt: number | null; port: number | null; gateway: string | null; rssi: number | null; snr: number | null; dr: string | null; freq: number | null; source: string; status: string; error: string | null; records: number; payload: string | null }
interface Props {
  meter: Meter; readings: Reading[]; daily: { day: string; m3: number; complete: boolean }[]; alarms: Alarm[]; uplinks: Uplink[];
  gateways: { id: string; messages: number; rssi: number; snr: number; last: string }[];
  vending: { t: string; source: string; vendor: string | null; result: string; code: string; amount: number | null }[];
  specs: Record<string, string>; statusBits: Record<string, [string, string]>; canSimulate: boolean;
  [k: string]: unknown;
}

const BAND = { low: '#B8DCD9', medium: '#5FA9A6', high: '#1F5F62' };
const ALARM_ICON: Record<string, IconName> = { burst: 'bulk', leak: 'leak', leakage: 'leak', reverse_flow: 'refresh', low_battery: 'battery', low_credit: 'wallet', no_credit: 'wallet', low_balance: 'wallet', valve_fault: 'valve', valve_closed: 'valve' };
const UPLINK_TONE: Record<string, [string, string]> = {
  decoded: ['Verified', 'Decoded'], undecoded: ['Pending', 'Undecoded'], error: ['Failed', 'Decode error'], join: ['Queued', 'Join'], unknown_device: ['Suspended', 'Unknown'],
};

/** Live dashboard for one Kalahari meter, built from its decoded uplinks. */
export function MeterDashboard() {
  const p = usePage<Props>().props;
  const { meter: m, readings } = p;
  const [simulating, setSimulating] = useState(false);
  const last48 = readings.slice(-48);
  const last14d = readings.slice(-14 * 24);
  const daily = p.daily.slice(-30);
  const bands = useMemo(() => {
    const vals = readings.map((r) => r.use * 1000).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (f: number) => vals[Math.floor(vals.length * f)] ?? 0;
    return [Math.max(5, Math.round(q(0.5))), Math.max(10, Math.round(q(0.85)))] as const;
  }, [readings]);
  // Credit comes once per uplink package, on its newest hour.
  const credit = useMemo(() => last14d.filter((r) => r.remaining != null), [last14d]);
  const topups = useMemo(() => credit.flatMap((r, i) => (i && r.remaining! > credit[i - 1].remaining! + 0.5
    ? [{ i, title: `${when(r.t)} · +${m3(r.remaining! - credit[i - 1].remaining!, 1)} m³ token` }] : [])), [credit]);
  const openAlarms = p.alarms.filter((a) => !a.cleared);
  const daysLeft = m.remaining != null && m.avgDaily ? m.remaining / m.avgDaily : null;
  const reportsPerDay = REPORTS_PER_DAY[m.reporting_hours] ?? Math.round(24 / m.reporting_hours);

  const simulate = () => {
    setSimulating(true);
    router.post(`/meters/${m.serial}/simulate`, {}, { preserveScroll: true, onFinish: () => setSimulating(false) });
  };

  return (
    <div className="profile">
      <Card style={{ padding: '18px 20px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Link className="back-link" href="/meters"><Icon name="back" size={15} />Meter register</Link>
          <span className="flex1" />
          <StatePill state={m.state} />
          <span className="sub">Last seen <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{m.lastSeen}</b>{m.nextReportAt && m.state === 'online' && <> · next report ~{when(m.nextReportAt)}</>}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ width: 42, height: 42, flex: 'none', borderRadius: 8, background: 'var(--navy-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navy)' }}><Icon name="meters" size={20} /></div>
          <div className="flex1" style={{ minWidth: 220 }}>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.2px' }}><span className="mono">{m.serial}</span> <span className="sub" style={{ fontWeight: 400 }}>· meter no. <span className="mono">{m.meter_address}</span></span></div>
            <div className="meta" style={{ fontSize: 11.5 }}>
              {m.client_name ? <>{m.client_name} · {m.plot}{m.suburb && !m.plot?.includes(m.suburb) ? ', ' + m.suburb : ''}</> : <>Unassigned stock{m.plot ? ' · ' + m.plot : ''}</>} · {m.model}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {p.canSimulate && m.state !== 'decommissioned' && (
              <button type="button" className="btn" onClick={simulate} disabled={simulating} title="Demo mode: send simulated uplinks through the ingestion pipeline">
                <Icon name="refresh" size={14} /> {simulating ? 'Simulating…' : 'Simulate uplinks'}
              </button>
            )}
            <button type="button" className="btn" disabled={!readings.length} onClick={() => {
              downloadCsv(`${m.serial}-hourly`, ['Time (UTC)', 'Total+ m3', 'Flow+ m3/h', 'Vol-RTU V', 'Voltage V', 'Water temp C', 'Status', 'Consume m3', 'Total- m3', 'Flow- m3/h', 'Remaining m3'],
                readings.map((r) => [r.t, r.total, r.flow, r.rtu ?? '', r.volt ?? '', r.temp ?? '', r.status ?? '', r.use, r.totalRev, r.flowRev, r.remaining ?? '']));
              toast(`Exported ${readings.length} hourly records`);
            }}>Export readings</button>
            <Link className="btn" href={`/meters/${m.serial}?edit=1`} style={{ textDecoration: 'none' }}>Edit</Link>
          </div>
        </div>
      </Card>

      {!m.hasTelemetry && <Commissioning m={m} canSimulate={p.canSimulate} onSimulate={simulate} simulating={simulating} />}

      {m.hasTelemetry && (
        <>
          <div className="meter-tiles">
            <Tile icon="meters" code="P-0" label="Meter reading" value={m3(m.total, 3)} unit="m³" sub={`since install: ${m3((m.total ?? 0) - m.initial_reading, 2)} m³`} />
            <Tile icon="wallet" code="P-2" label="Credit remaining" value={m3(m.remaining, 2)} unit="m³" tone={m.remaining != null && m.remaining <= 1 ? 'bad' : undefined}
              sub={m.remaining != null && m.remaining <= 0 ? 'valve closes at zero credit' : daysLeft != null ? `≈ ${Math.max(0, Math.round(daysLeft))} days at ${litres(m.avgDaily!)}/day` : '—'} />
            <Tile icon="bulk" code="P-1" label="Flow at last report" value={m3(m.flow, 3)} unit="m³/h" sub={m.flow ? `${N(Math.round(m.flow * 1000 / 60))} L/min` : 'no flow'} />
            <Tile icon="dash" label="Used today" value={litres(m.usedToday).replace(' L', '')} unit="L" sub={m.avgDaily != null ? `${litres(m.avgDaily)} daily average` : '—'} />
            <Tile icon="battery" code="P-B" label="Battery" value={m.battery_v != null ? m.battery_v.toFixed(2) : '—'} unit="V" tone={m.battery_pct < 40 ? 'warn' : undefined} sub={`${m.battery_pct}% · lithium, replaceable`} />
            <Tile icon="sites" code="P-A" label="Water temperature" value={m.temperature != null ? m.temperature.toFixed(1) : '—'} unit="°C" sub="T50 class (0.1–50 °C)" />
          </div>

          <div className="grid profile-2" style={{ marginBottom: 12 }}>
            <Panel title="Hourly use · last 48 hours" note="litres per hour" icon="dash">
              {last48.length ? (
                <>
                  <Bars values={last48.map((r) => r.use * 1000)} labels={last48.map((r, i) => (i % 6 === 0 ? hour(r.t).slice(0, 2) : ''))}
                    color={(v) => (v < bands[0] ? BAND.low : v < bands[1] ? BAND.medium : BAND.high)}
                    tip={(v, i) => `${when(last48[i].t)} · ${N(Math.round(v))} L`} />
                  <div className="legend">
                    <Legend color={BAND.low} label={`Low < ${bands[0]} L`} />
                    <Legend color={BAND.medium} label={`Medium ${bands[0]}–${bands[1]} L`} />
                    <Legend color={BAND.high} label={`High > ${bands[1]} L`} />
                  </div>
                </>
              ) : <div className="empty-chart">No hourly records yet.</div>}
            </Panel>
            <Panel title="Daily use · last 30 days" note={m.avgDaily != null ? `${litres(m.avgDaily)} average` : undefined} icon="reports">
              <Bars values={daily.map((d) => d.m3 * 1000)} labels={daily.map((d, i) => (i % 5 === 4 ? day(d.day).slice(0, 2) : ''))}
                color={(_, i) => (daily[i].complete ? 'var(--teal)' : '#9CCBC9')} tip={(v, i) => `${day(daily[i].day)}${daily[i].complete ? '' : ' (so far)'} · ${N(Math.round(v))} L`} />
            </Panel>
          </div>

          <div className="grid profile-2" style={{ marginBottom: 12 }}>
            <Panel title="Credit remaining · 14 days" note="m³ · ring = token entered" icon="wallet">
              <LineChart label="Credit remaining in cubic metres" step points={credit.map((r) => ({ x: Date.parse(r.t), y: r.remaining }))}
                format={(y, x) => `${when(x)} · ${m3(y, 2)} m³`} tick={(x) => day(x)} markers={topups} />
            </Panel>
            <Panel title="Meter register · 14 days" note="Total+ m³" icon="meters">
              <LineChart label="Cumulative register in cubic metres" fill={false} color="#2A7A7E" points={last14d.map((r) => ({ x: Date.parse(r.t), y: r.total }))}
                format={(y, x) => `${when(x)} · ${m3(y, 3)} m³`} tick={(x) => day(x)} />
            </Panel>
          </div>

          <div className="grid profile-3" style={{ marginBottom: 12 }}>
            <Panel title="Battery voltage" note="Vol-RTU · V" icon="battery">
              <LineChart height={120} label="Battery voltage" fill={false} color="#5B6573" minSpan={0.2} points={last14d.map((r) => ({ x: Date.parse(r.t), y: r.rtu }))} format={(y, x) => `${when(x)} · ${y.toFixed(2)} V`} tick={(x) => day(x)} />
            </Panel>
            <Panel title="Water temperature" note="°C" icon="sites">
              <LineChart height={120} label="Water temperature" fill={false} color="#D99A2B" minSpan={4} points={last48.map((r) => ({ x: Date.parse(r.t), y: r.temp }))} format={(y, x) => `${when(x)} · ${y.toFixed(1)} °C`} tick={(x) => hour(x)} />
            </Panel>
            <AlarmsPanel alarms={p.alarms} open={openAlarms.length} />
          </div>
        </>
      )}

      <div className="grid profile-3" style={{ marginBottom: 12 }}>
        <KeyValues title="Device" icon="meters" rows={[
          ['Serial', m.serial], ['Meter address', m.meter_address], ['Model', m.model], ['Firmware', m.firmware ?? '—'],
          ...Object.entries(p.specs).slice(0, 5) as [string, string][],
          ['Valve', m.valve_state === 'unknown' ? 'Unknown' : m.valve_state === 'open' ? 'Open' : 'Closed'],
          ['Status code', m.status_code != null ? '0x' + m.status_code.toString(16).toUpperCase().padStart(2, '0') : '—'],
          ['Installed', m.installed_at || '—'], ['Reading at install', m3(m.initial_reading, 3) + ' m³'], ['Seal', m.seal_no || '—'],
        ]} />
        <KeyValues title="LoRaWAN" icon="network" rows={[
          ['DevEUI', m.dev_eui], ['JoinEUI', m.join_eui || '—'], ['AppKey', m.has_app_key ? 'Stored (encrypted)' : 'Not set'],
          ['Activation', 'OTAA · class ' + m.device_class], ['Region', m.lorawan_region],
          ['Reporting', `${m.reporting_hours} h package · ${reportsPerDay}/day`], ['Sampling', `every ${m.sampling_minutes} min`],
          ['Joined', when(m.joinedAt)], ['Last uplink', when(m.lastUplinkAt)],
          ['Last RSSI / SNR', m.last_rssi != null ? `${m.last_rssi} dBm / ${m.last_snr} dB` : '—'], ['Frame counter', m.last_fcnt != null ? N(m.last_fcnt) : '—'],
        ]} />
        <LocationCard m={m} />
      </div>

      <div className="grid profile-2" style={{ marginBottom: 12 }}>
        <KeyValues title="Account & STS" icon="vending" rows={[
          ['Customer', m.client_name ?? 'Unassigned'], ['Account', m.client_id || '—'], ['Occupant', m.occupant || '—'],
          ['May buy tokens', m.client_id ? m.vending_party : 'nobody (unassigned)'], ['KYC', m.client_id ? m.kyc : '—'],
          ['STS meter number', m.meter_address], ['SGC · KRN · TI', `${m.sts_sgc} · ${m.sts_krn} · ${m.sts_ti}`], ['Algorithm', 'EA07 · STS Edition 2'],
        ]} note={<Link href="/vending" className="link" style={{ fontSize: 11 }}>Vending</Link>} />
        <Gateways rows={p.gateways} vending={p.vending} />
      </div>

      {readings.length > 0 && <HourlyRecords readings={readings} statusBits={p.statusBits} />}
      <UplinkLog uplinks={p.uplinks} />
    </div>
  );
}

function Tile({ icon, code, label, value, unit, sub, tone }: { icon: IconName; code?: string; label: string; value: string; unit: string; sub: string; tone?: 'bad' | 'warn' }) {
  const color = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn-ink)' : 'var(--ink)';
  return (
    <Card className="meter-tile">
      <div className="t-label"><Icon name={icon} size={14} />{label}{code && <span className="t-code" title="Code on the meter's display">{code}</span>}</div>
      <div className="t-value" style={{ color }}>{value}<small>{unit}</small></div>
      <div className="t-sub" title={sub}>{sub}</div>
    </Card>
  );
}

function AlarmsPanel({ alarms, open }: { alarms: Alarm[]; open: number }) {
  return (
    <Panel title="Alarms" note={open ? `${open} open` : 'none open'} icon="vee">
      {alarms.length === 0 && <div className="empty-chart" style={{ minHeight: 100 }}>No alarms in the last 30 days.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflow: 'auto' }}>
        {alarms.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', opacity: a.cleared ? 0.6 : 1 }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: a.cleared ? 'var(--line-3)' : 'var(--bad-bg)', color: a.cleared ? 'var(--muted)' : 'var(--bad)' }}>
              <Icon name={ALARM_ICON[a.type] ?? 'vee'} size={14} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.label} <span className="sub" style={{ fontWeight: 400 }}>· {a.source === 'meter' ? 'from meter' : 'derived'}</span></div>
              <div className="sub" style={{ lineHeight: 1.4 }}>{a.detail}</div>
              <div className="meta" style={{ fontSize: 10.5 }}>{when(a.raised)}{a.cleared ? ' → cleared ' + when(a.cleared) : ' · open'}</div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function LocationCard({ m }: { m: Meter }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || m.lat == null || m.lng == null) return;
    const map = L.map(el.current, { zoomControl: true, scrollWheelZoom: false }).setView([m.lat, m.lng], 16);
    addBasemap(map, 'satellite');
    L.circleMarker([m.lat, m.lng], { radius: 8, color: '#fff', weight: 2, fillColor: m.state === 'online' ? '#2E9D5B' : m.state === 'offline' ? '#D6452E' : '#D99A2B', fillOpacity: 1 }).addTo(map);
    return () => { map.remove(); };
  }, [m.lat, m.lng, m.state]);
  return (
    <Panel title="Location" icon="sites" note={m.lat != null ? <span className="mono">{m.lat.toFixed(5)}, {m.lng!.toFixed(5)}</span> : undefined}>
      {m.lat != null ? <div ref={el} style={{ height: 220, borderRadius: 8, overflow: 'hidden' }} /> : <div className="empty-chart" style={{ minHeight: 220 }}>No coordinates yet. Add them on the Edit page.</div>}
      <div className="sub" style={{ marginTop: 8 }}>{[m.plot, m.suburb].filter(Boolean).join(' · ') || 'No address recorded'}</div>
    </Panel>
  );
}

function Gateways({ rows, vending }: { rows: Props['gateways']; vending: Props['vending'] }) {
  return (
    <Card clip>
      <div className="card-head"><span className="card-title flex1">Gateways · last 30 days</span><span className="meta">heard this meter</span></div>
      <div className="table-wrap">
        <table className="tbl compact">
          <TableHead cols={[{ label: 'Gateway' }, { label: 'Messages', align: 'right' }, { label: 'Avg RSSI', align: 'right' }, { label: 'Avg SNR', align: 'right' }, { label: 'Last heard', align: 'right' }]} />
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td className="mono" style={{ fontWeight: 600 }}>{g.id}</td>
                <td className="mono num">{N(g.messages)}</td>
                <td className="mono num" style={{ color: g.rssi < -115 ? 'var(--warn-ink)' : undefined }}>{g.rssi} dBm</td>
                <td className="mono num">{g.snr} dB</td>
                <td className="num sub">{when(g.last)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="sub" style={{ padding: 18, textAlign: 'center' }}>No uplinks yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {vending.length > 0 && (
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--line-2)' }}>
          <div className="label" style={{ marginBottom: 6 }}>Recent vending checks</div>
          {vending.map((v, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11.5, padding: '3px 0' }}>
              <span className="sub" style={{ width: 96 }}>{when(v.t)}</span>
              <span className="flex1">{v.vendor ?? v.source}{v.amount ? ` · P ${v.amount.toFixed(2)}` : ''}</span>
              <span style={{ color: v.result === 'APPROVED' ? 'var(--ok-ink)' : 'var(--bad)', fontWeight: 600 }}>{v.result === 'APPROVED' ? 'Approved' : v.code}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const PAGE = 24;

function HourlyRecords({ readings, statusBits }: { readings: Reading[]; statusBits: Props['statusBits'] }) {
  const rows = useMemo(() => [...readings].reverse(), [readings]);
  const [page, setPage] = useState(0);
  const pages = Math.ceil(rows.length / PAGE);
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const bits = Object.entries(statusBits);
  const status = (s: number | null) => {
    if (s == null) return '—';
    const hexs = '0x' + s.toString(16).toUpperCase().padStart(2, '0');
    const names = bits.filter(([b]) => s & Number(b)).map(([, [, label]]) => label);
    return names.length ? `${hexs} · ${names.join(', ')}` : hexs;
  };
  return (
    <Card clip style={{ marginBottom: 12 }}>
      <div className="card-head">
        <span className="card-title flex1">Hourly frozen records</span>
        <span className="meta">same columns as the meter’s infrared readout</span>
      </div>
      <div className="table-wrap">
        <table className="tbl compact nowrap">
          <TableHead cols={[{ label: 'Time' }, { label: 'Total+ m³', align: 'right' }, { label: 'Flow+ m³/h', align: 'right' }, { label: 'Vol-RTU', align: 'right' }, { label: 'Voltage', align: 'right' }, { label: 'Water temp', align: 'right' }, { label: 'Status' }, { label: 'Consume', align: 'right' }, { label: 'Total- m³', align: 'right' }, { label: 'Flow-', align: 'right' }, { label: 'Credit m³', align: 'right' }]} />
          <tbody>
            {shown.map((r) => (
              <tr key={r.t}>
                <td className="mono">{when(r.t)}</td>
                <td className="mono num">{m3(r.total)}</td>
                <td className="mono num">{m3(r.flow)}</td>
                <td className="mono num">{r.rtu?.toFixed(2) ?? '—'}</td>
                <td className="mono num">{r.volt?.toFixed(2) ?? '—'}</td>
                <td className="mono num">{r.temp != null ? r.temp.toFixed(1) + ' °C' : '—'}</td>
                <td className="mono">{status(r.status)}</td>
                <td className="mono num" style={{ color: r.use ? 'var(--ink)' : 'var(--faint)' }}>{litres(r.use)}</td>
                <td className="mono num">{m3(r.totalRev)}</td>
                <td className="mono num">{m3(r.flowRev)}</td>
                <td className="mono num">{m3(r.remaining, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span className="sub flex1">Newest first · {N(rows.length)} records in the last 30 days{bits.length ? '' : ' · status bits shown in hex until the protocol is loaded'}</span>
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Newer">‹</button>
        <span className="sub" style={{ padding: '0 6px' }}>{page + 1} / {pages}</span>
        <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Older">›</button>
      </div>
    </Card>
  );
}

function UplinkLog({ uplinks }: { uplinks: Uplink[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? uplinks : uplinks.slice(0, 10);
  return (
    <Card clip style={{ marginBottom: 12 }}>
      <div className="card-head"><span className="card-title flex1">Uplinks</span><span className="meta">as received from the network server</span></div>
      <div className="table-wrap">
        <table className="tbl compact">
          <TableHead cols={[{ label: 'Received' }, { label: 'Event' }, { label: 'FCnt', align: 'right' }, { label: 'Port', align: 'right' }, { label: 'Gateway' }, { label: 'RSSI / SNR', align: 'right' }, { label: 'DR' }, { label: 'Records', align: 'right' }, { label: 'Decode', align: 'right' }]} />
          <tbody>
            {shown.map((u) => {
              const [tone, label] = UPLINK_TONE[u.status] ?? ['Pending', u.status];
              return (
                <tr key={u.id} className="row-link" onClick={() => setOpen(open === u.id ? null : u.id)} title="Show details">
                  <td className="mono">{when(u.t)}{open === u.id && (
                    <div className="code-inline" style={{ marginTop: 6, whiteSpace: 'normal', maxWidth: 520 }}>
                      {u.payload ? <>Payload {u.payload}</> : 'Decoded by the network server codec (no raw payload forwarded)'}
                      {u.error && <div style={{ color: 'var(--bad)' }}>{u.error}</div>}
                      <div>Source {u.source}{u.freq ? ` · ${(u.freq / 1e6).toFixed(1)} MHz` : ''}</div>
                    </div>
                  )}</td>
                  <td>{u.event === 'join' ? 'Join' : 'Uplink'}</td>
                  <td className="mono num">{u.fcnt ?? '—'}</td>
                  <td className="mono num">{u.port ?? '—'}</td>
                  <td className="mono">{u.gateway ?? '—'}</td>
                  <td className="mono num">{u.rssi != null ? `${u.rssi} / ${u.snr}` : '—'}</td>
                  <td className="mono">{u.dr ?? '—'}</td>
                  <td className="mono num">{u.records || '—'}</td>
                  <td className="num"><Badge status={tone} label={label} /></td>
                </tr>
              );
            })}
            {!uplinks.length && <tr><td colSpan={9} className="sub" style={{ padding: 22, textAlign: 'center' }}>Nothing received from this meter yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {uplinks.length > 10 && (
        <div className="pager">
          <span className="sub flex1">{all ? `All ${uplinks.length} most recent` : `Latest 10 of ${uplinks.length}`} · click a row for details</span>
          <button type="button" className="link" style={{ fontSize: 11.5, width: 'auto', padding: '0 8px' }} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : 'Show all'}</button>
        </div>
      )}
    </Card>
  );
}

/** Shown until the first uplink arrives: what to set up, from the Kalahari manual. */
function Commissioning({ m, canSimulate, onSimulate, simulating }: { m: Meter; canSimulate: boolean; onSimulate: () => void; simulating: boolean }) {
  const c = m.commissioning ?? {};
  const steps: [boolean, string, React.ReactNode][] = [
    [true, 'Registered on the platform', <>Meter address <span className="mono">{m.meter_address}</span>, DevEUI <span className="mono">{m.dev_eui}</span> and keys are stored.</>],
    [!!c.ns_registered, 'Add it to the network server', <>Create an OTAA class {m.device_class} device on {m.lorawan_region} with DevEUI <span className="mono">{m.dev_eui}</span>, JoinEUI <span className="mono">{m.join_eui}</span> and the AppKey from registration, in the application whose webhook points at <span className="mono">/api/lorawan/uplink</span>.</>],
    [!!c.reporting_enabled, 'Wake it from non-reporting mode', <>Meters ship silent to save battery. Enter touch-key code 11111 <KeyCode steps={['D1', 'U1', 'D1', 'U1', 'D1']} />. The blue LED shows it’s joining; three red flashes mean the gateway answered.</>],
    [m.network_status === 'joined', 'Join the network', m.joinedAt ? `Joined ${when(m.joinedAt)}.` : 'Confirmed automatically when the network server reports the join.'],
    [false, 'First data', `Hourly records arrive in ${m.reporting_hours}-hour packages (${REPORTS_PER_DAY[m.reporting_hours]} a day). Press the touch key with code 11111 again to report straight away.`],
    [!!c.ciu_bound, 'Bind the CIU', 'Check the CIU’s address label matches the meter, then enter 00 and Confirm on the CIU. It should show ACCEPT.'],
  ];
  return (
    <Card className="form-section" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h3 className="flex1">Waiting for this meter’s first uplink</h3>
        {canSimulate && <button type="button" className="btn-primary" onClick={onSimulate} disabled={simulating}>{simulating ? 'Simulating…' : 'Simulate 24 h of uplinks (demo)'}</button>}
      </div>
      <span className="sub">The dashboard fills in as soon as decoded readings arrive.</span>
      <div className="checklist">
        {steps.map(([ok, title, text], i) => (
          <div key={i} className="check-row">
            <span className={`check-mark ${ok ? 'done' : 'todo'}`}>{ok ? '✓' : i + 1}</span>
            <span><b style={{ fontWeight: 600 }}>{title}</b><span className="sub" style={{ display: 'block', marginTop: 2, lineHeight: 1.5 }}>{text}</span></span>
          </div>
        ))}
      </div>
    </Card>
  );
}
