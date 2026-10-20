import { Link, usePage } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { Card, StatCard, TableHead } from '../../components/ui';
import { toast } from '../../components/overlay';
import { downloadCsv } from '../../lib/csv';
import { goTo } from '../../routes';
import { N } from '../../data/format';
import { m3, StatePill, type MeterState } from './common';

interface Row {
  serial: string; address: string | null; client: string | null; plot: string | null; suburb: string | null;
  state: MeterState; lastSeen: string; total: number | null; remaining: number | null; battery: number; rssi: number | null; alarms: number;
}
interface Props { meters: Row[]; stats: { undecoded24h: number; unknown24h: number; uplinks24h: number }; [k: string]: unknown }

const FILTERS: [string, (r: Row) => boolean][] = [
  ['All', () => true],
  ['Online', (r) => r.state === 'online'],
  ['Offline', (r) => r.state === 'offline'],
  ['Awaiting first uplink', (r) => r.state === 'awaiting'],
  ['With alarms', (r) => r.alarms > 0],
  ['Low battery', (r) => r.battery < 40],
  ['Unassigned', (r) => !r.client],
  ['Decommissioned', (r) => r.state === 'decommissioned'],
];
const PAGE = 15;

/** Every Kalahari meter on the platform, from the database. */
export function MeterRegister() {
  const { meters, stats } = usePage<Props>().props;
  const [filter, setFilter] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => meters.filter((r) => FILTERS[filter][1](r) && (!needle || [r.serial, r.address, r.client, r.plot, r.suburb].some((v) => v?.toLowerCase().includes(needle)))), [meters, filter, needle]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const shown = rows.slice(pg * PAGE, pg * PAGE + PAGE);
  const count = (i: number) => meters.filter(FILTERS[i][1]).length;
  const alarms = meters.reduce((a, r) => a + r.alarms, 0);

  return (
    <div>
      <div className="grid g-stats" style={{ marginBottom: 14 }}>
        <StatCard label="Registered meters" value={N(meters.length)} sub={`${count(6)} not yet assigned to a customer`} />
        <StatCard label="Reporting" value={N(count(1))} sub={`${count(2)} offline · ${count(3)} awaiting first uplink`} />
        <StatCard label="Open alarms" value={N(alarms)} sub={`on ${count(4)} meters`} />
        <StatCard label="Uplinks, last 24 h" value={N(stats.uplinks24h)} sub={stats.undecoded24h || stats.unknown24h ? `${stats.undecoded24h} undecoded · ${stats.unknown24h} from unknown devices` : 'all decoded'} />
      </div>

      <Card clip>
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 7 }}>
          <span className="card-title" style={{ marginRight: 4 }}>Kalahari meters</span>
          {FILTERS.map(([label], i) => (
            <button key={label} type="button" className={`chip${filter === i ? ' on' : ''}`} aria-pressed={filter === i} onClick={() => { setFilter(i); setPage(0); }}>
              {label} <span className="sub">{count(i)}</span>
            </button>
          ))}
        </div>
        <div className="card-head" style={{ gap: 10, borderTop: '1px solid var(--line-3)' }}>
          <input className="inline-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Serial, meter number, customer or plot" aria-label="Filter meters" style={{ flex: 1, minWidth: 0, maxWidth: 360 }} />
          <span className="flex1" />
          <button type="button" className="link" style={{ fontSize: 11.5 }} onClick={() => {
            downloadCsv('meter-register', ['Serial', 'Meter number', 'Customer', 'Plot', 'Suburb', 'Status', 'Last seen', 'Register m3', 'Credit m3', 'Battery %', 'RSSI', 'Open alarms'],
              rows.map((r) => [r.serial, r.address ?? '', r.client ?? '', r.plot ?? '', r.suburb ?? '', r.state, r.lastSeen, r.total ?? '', r.remaining ?? '', r.battery, r.rssi ?? '', r.alarms]));
            toast(`Exported ${rows.length} meters`);
          }}>Export CSV</button>
          <Link href="/meters/new" className="btn-primary" style={{ textDecoration: 'none' }}>+ Add meter</Link>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <TableHead cols={[{ label: 'Meter' }, { label: 'Customer / property' }, { label: 'Status' }, { label: 'Last seen' }, { label: 'Register', align: 'right' }, { label: 'Credit', align: 'right' }, { label: 'Battery', align: 'right' }, { label: 'RSSI', align: 'right' }, { label: 'Alarms', align: 'right' }]} />
            <tbody>
              {shown.map((r) => (
                <tr key={r.serial} className="row-link" onClick={() => goTo('meters', r.serial)}>
                  <td>
                    <Link href={'/meters/' + r.serial} className="mono" style={{ color: 'var(--navy)', fontWeight: 600, textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>{r.serial}</Link>
                    <div className="sub mono">{r.address ?? '—'}</div>
                  </td>
                  <td>{r.client ?? <span className="sub">Unassigned stock</span>}<div className="sub">{r.plot ?? r.suburb ?? '—'}</div></td>
                  <td><StatePill state={r.state} /></td>
                  <td className="sub" style={{ whiteSpace: 'nowrap' }}>{r.lastSeen}</td>
                  <td className="mono num">{r.total != null ? m3(r.total, 1) + ' m³' : '—'}</td>
                  <td className="mono num" style={{ color: r.remaining != null && r.remaining <= 0 ? 'var(--bad)' : undefined }}>{r.remaining != null ? m3(r.remaining, 2) + ' m³' : '—'}</td>
                  <td className="mono num" style={{ color: r.battery < 40 ? 'var(--warn-ink)' : undefined }}>{r.battery}%</td>
                  <td className="mono num sub">{r.rssi != null ? r.rssi + ' dBm' : '—'}</td>
                  <td className="num">{r.alarms ? <span className="badge" style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}>{r.alarms}</span> : <span className="sub">—</span>}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={9} className="sub" style={{ padding: 28, textAlign: 'center' }}>No meters match.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="sub flex1">{rows.length ? `Showing ${pg * PAGE + 1}–${pg * PAGE + shown.length} of ${rows.length}` : 'No rows'}</span>
          <button type="button" disabled={pg === 0} onClick={() => setPage(pg - 1)} aria-label="Previous page">‹</button>
          {Array.from({ length: pages }, (_, p) => (
            <button key={p} type="button" className={p === pg ? 'on' : ''} aria-current={p === pg ? 'page' : undefined} onClick={() => setPage(p)}>{p + 1}</button>
          ))}
          <button type="button" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label="Next page">›</button>
        </div>
      </Card>
    </div>
  );
}
