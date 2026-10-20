import { Badge, BarRow, Card, TableHead } from '../components/ui';
import { GATEWAYS } from '../data/fleet';
import { N, rnd } from '../data/format';

const KPIS = [
  { label: 'Join success', value: '99.2%', sub: '24h rolling' },
  { label: 'Avg packet loss', value: '2.7%', sub: 'target < 4%' },
  { label: 'Avg RSSI', value: '-96 dBm', sub: 'fleet median' },
  { label: 'Uplinks / day', value: '1.41 M', sub: 'all ports' },
  { label: 'Nodes unseen 24h', value: '1,842', sub: '3.7% of fleet' },
];

const FLEET = 50412;
const SF: [string, number][] = [['SF7', 41.2], ['SF8', 22.6], ['SF9', 15.1], ['SF10', 11.4], ['SF11', 5.9], ['SF12', 3.8]];
const LOSS = [1.8, 2.1, 3.4, 7.9, 1.2, 100];
const UPTIME = ['99.9%', '99.7%', '98.4%', '94.1%', '99.9%', '0%'];

const PORTS: [port: number, name: string, tone: string][] = [
  [5, 'ACK-ACK', '#49515C'], [60, 'Midnight', '#49515C'], [61, 'Live', '#49515C'], [65, 'Tamper', '#B3261E'],
  [66, 'Burst', '#B3261E'], [210, 'Credit', '#49515C'], [225, 'Come back', '#49515C'],
];

const UPLINKS = (() => {
  const r = rnd(4242);
  return Array.from({ length: 22 }, (_, i) => {
    const p = PORTS[Math.floor(r() * PORTS.length)];
    const sec = Math.floor(r() * 60);
    return {
      t: '13:' + String(59 - i).padStart(2, '0') + ':' + String(sec).padStart(2, '0'),
      dev: 'A840' + Math.floor(r() * 9e5 + 1e5).toString(16).toUpperCase(),
      port: 'p' + p[0] + ' ' + p[1],
      tone: p[2],
      payload: Array.from({ length: 8 }, () => Math.floor(r() * 256).toString(16).padStart(2, '0').toUpperCase()).join(' '),
      rssi: -(80 + Math.floor(r() * 35)) + 'dBm',
    };
  });
})();

export function NetworkHealth() {
  return (
    <div>
      <div className="grid g-5" style={{ marginBottom: 12 }}>
        {KPIS.map((k) => (
          <Card key={k.label} style={{ padding: '16px 18px' }}>
            <div className="label" style={{ marginBottom: 7 }}>{k.label}</div>
            <div className="kpi-value">{k.value}</div>
            <div className="sub" style={{ marginTop: 6 }}>{k.sub}</div>
          </Card>
        ))}
      </div>

      <div className="grid g-2 stack-md" style={{ marginBottom: 12 }}>
        <Card style={{ padding: '18px 20px' }}>
          <div className="card-title" style={{ marginBottom: 11 }}>Spreading factor distribution</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {SF.map(([sf, v]) => (
              <BarRow key={sf} label={sf} labelWidth={34} valueWidth={96} width={((v / SF[0][1]) * 100).toFixed(0) + '%'}
                color={sf === 'SF12' || sf === 'SF11' ? '#D99A2B' : '#00468C'} value={`${v}% · ${N(Math.round((FLEET * v) / 100))}`} />
            ))}
          </div>
          <div className="sub" style={{ marginTop: 11, lineHeight: 1.5 }}>
            Higher spreading factors reach further but consume more airtime. SF12 nodes above 8% of the fleet usually indicate a coverage gap.
          </div>
        </Card>
        <Card style={{ padding: '18px 20px' }}>
          <div className="card-title" style={{ marginBottom: 11 }}>Packet loss by gateway · last 24h</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {GATEWAYS.map((g, i) => {
              const v = LOSS[i];
              return (
                <BarRow key={g.id} label={g.id} labelWidth={84} valueWidth={52} width={Math.min(100, v) + '%'}
                  color={v > 6 ? '#B3261E' : v > 3 ? '#D99A2B' : '#2E9D5B'} value={v + '%'} />
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid stack-md" style={{ gridTemplateColumns: '1.25fr 1fr' }}>
        <Card clip>
          <div className="card-head"><span className="card-title">Gateway fleet</span></div>
          <div className="table-wrap">
            <table className="tbl compact roomy">
              <TableHead cols={[{ label: 'Gateway' }, { label: 'Site' }, { label: 'Nodes', align: 'right' }, { label: 'RSSI', align: 'right' }, { label: 'Uptime', align: 'right' }, { label: 'State', align: 'right' }]} />
              <tbody>
                {GATEWAYS.map((g, i) => (
                  <tr key={g.id}>
                    <td className="mono" style={{ fontWeight: 600 }}>{g.id}</td>
                    <td style={{ fontSize: 11, color: 'var(--ink-4)' }}>{g.site}</td>
                    <td className="mono num">{N(g.meters)}</td>
                    <td className="mono num" style={{ color: 'var(--muted)' }}>{g.rssi}</td>
                    <td className="mono num" style={{ color: 'var(--muted)' }}>{UPTIME[i]}</td>
                    <td className="num"><Badge status={g.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card clip>
          <div className="card-head">
            <span className="card-title flex1">Uplink log</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span className="dot" style={{ width: 6, height: 6, background: 'var(--ok)' }} />
              <span className="mono" style={{ fontSize: 11, color: 'var(--ok-ink)' }}>streaming</span>
            </span>
          </div>
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {UPLINKS.map((u, i) => (
              <div key={i} className="mono" style={{ display: 'flex', gap: 9, padding: '6px 13px', borderBottom: '1px solid var(--line-3)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--muted)' }}>{u.t}</span>
                <span style={{ color: 'var(--navy)' }}>{u.dev}</span>
                <span style={{ color: u.tone }}>{u.port}</span>
                <span className="ellipsis flex1" style={{ color: 'var(--ink-4)' }}>{u.payload}</span>
                <span style={{ color: 'var(--muted)' }}>{u.rssi}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
