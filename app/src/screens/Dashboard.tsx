import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Card, SectionRule, Segmented, TableHead } from '../components/ui';
import { SUBURBS } from '../data/fleet';
import { N, P, litres, pct, short } from '../data/format';

const PERIODS = ['Aug 2026', 'Q3 2026', 'YTD', 'Custom'] as const;
const LEDGER_TABS = ['Sales', 'Usage', 'Meter analysis'] as const;

const UP = '#0e9a5a';
const DOWN = '#d92d20';

const KPIS = [
  { label: 'Total sales', value: 'P 7,014,728.71', sub: 'period total', delta: '▲ 8.4%', up: true },
  { label: 'Transactions', value: '26,478', sub: 'token issues', delta: '▲ 5.1%', up: true },
  { label: 'Counter excl. VAT', value: 'P 3,535,646.07', sub: 'vendor desks', delta: '▲ 2.7%', up: true },
  { label: 'Total usage', value: '360,739,965 L', sub: 'metered volume', delta: '▲ 1.9%', up: true },
  { label: 'Online payments', value: 'P 3,020,215.40', sub: '11,200 tx · 3 providers', delta: '▲ 14.2%', up: true },
  { label: 'Counter sales', value: 'P 3,994,513.31', sub: '15,278 tx', delta: '▼ 1.4%', up: false },
];

const DAILY = [
  91726.06, 102883.19, 146181.55, 126612.59, 70457.36, 102848.14, 108662.03, 105248.16, 165245.66, 175617.43, 151259.03,
  87754.85, 154528.95, 148812.31, 121317.43, 252096.74, 234587.92, 166683.18, 168682.98, 173690.41, 173890.41,
];

const PORTS = [
  { label: 'Port 5 · ACK-ACK', value: '1,301,969', kind: 'Packet count', delta: '▲ 3.2%', tone: '#00468C', w: '78%' },
  { label: 'Port 37 · Installation', value: '94,841', kind: 'Packet count', delta: '▲ 1.1%', tone: '#00468C', w: '22%' },
  { label: 'Port 65 · Tamper alarm', value: '83,899', kind: 'Alarm count', delta: '▼ 4.6%', tone: '#B3261E', w: '31%' },
  { label: 'Port 66 · Burst alarm', value: '25,147', kind: 'Alarm count', delta: '▼ 2.2%', tone: '#B3261E', w: '14%' },
  { label: 'Port 60 · Midnight data', value: '12,990,715', kind: 'Packet count', delta: '▲ 6.9%', tone: '#00468C', w: '96%' },
  { label: 'Port 61 · Live data', value: '3,170,564', kind: 'Packet count', delta: '▲ 4.4%', tone: '#00468C', w: '54%' },
  { label: 'Port 210 · Credit', value: '432,740', kind: 'Packet count', delta: '▲ 9.7%', tone: '#00468C', w: '38%' },
  { label: 'Port 225 · Come back', value: '11,001,247', kind: 'Packet count', delta: '▲ 5.5%', tone: '#2A7A7E', w: '88%' },
];

const BYPASS = [
  { label: 'High risk', value: '87', tone: '#B3261E' },
  { label: 'Medium risk', value: '635', tone: '#965A00' },
  { label: 'Low risk', value: '442', tone: '#49515C' },
  { label: '30–89 days', value: '155', tone: '#49515C' },
  { label: '90–119 days', value: '39', tone: '#49515C' },
  { label: '120+ days', value: '970', tone: '#181D23' },
];

const PROVIDERS = [
  { id: 'apiPAY/Orange', tx: '7,262', amount: 'P 1,346,724.80', share: '44.6%' },
  { id: 'apiPAY/DPO', tx: '3,936', amount: 'P 1,288,471.40', share: '42.7%' },
  { id: 'esw_leeroy', tx: '2', amount: 'P 385,019.20', share: '12.7%' },
];

/** Navy ramp for the suburb share bar — no rainbow palettes. */
const SHARE_PALETTE = ['#00468C', '#1D5C9C', '#3A72AC', '#5889BD', '#77A0CD', '#97B8DC', '#B8CFE8', '#D5DAE0'];

const LEDGER_DATES = ['Wed, Aug 19', 'Tue, Aug 18', 'Mon, Aug 17', 'Sun, Aug 16', 'Sat, Aug 15', 'Fri, Aug 14', 'Thu, Aug 13', 'Wed, Aug 12', 'Tue, Aug 11', 'Mon, Aug 10', 'Sun, Aug 9', 'Sat, Aug 8'];

const max = {
  sales: Math.max(...SUBURBS.map((s) => s.salesN)),
  usage: Math.max(...SUBURBS.map((s) => s.usageN)),
  tx: Math.max(...SUBURBS.map((s) => s.txN)),
};

export function Dashboard() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('Aug 2026');
  const [ledgerTab, setLedgerTab] = useState<(typeof LEDGER_TABS)[number]>('Sales');

  return (
    <div>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 14, flexWrap: 'wrap' }}>
        <span className="label">PERIOD</span>
        <Segmented options={PERIODS} value={period} onChange={setPeriod} />
        <div className="flex1" />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Snapshot 19 Aug 2026, 13:01</span>
        <button type="button" className="btn"><Icon name="refresh" size={14} />Refresh</button>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', marginBottom: 10 }}>
        {KPIS.map((k) => (
          <Card key={k.label} style={{ padding: '12px 13px 11px' }}>
            <div className="label" style={{ marginBottom: 7 }}>{k.label}</div>
            <div className="kpi-value">{k.value}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
              <span className="mono" style={{ fontSize: 10.5, fontWeight: 600, color: k.up ? UP : DOWN }}>{k.delta}</span>
              <span className="sub">{k.sub}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', marginBottom: 16 }}>
        <Card style={{ padding: '13px 15px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 11 }}>
            <div className="card-title">Daily Sales · August 2026</div>
            <div className="meta">Pula, incl. VAT</div>
          </div>
          <DailyBars />
        </Card>
        <Card style={{ padding: '13px 15px' }}>
          <div className="card-title" style={{ marginBottom: 4 }}>Monthly Sales</div>
          <div className="meta" style={{ marginBottom: 8 }}>Last 6 months</div>
          <MonthlyLine />
        </Card>
      </div>

      <SectionRule title="LoRaWAN Port Traffic" note="uplinks decoded, period" />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', marginBottom: 16 }}>
        {PORTS.map((p) => (
          <Card key={p.label} style={{ padding: '11px 13px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: p.tone, marginBottom: 6 }}>{p.label}</div>
            <div style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-.5px' }}>{p.value}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <span className="sub">{p.kind}</span>
              <span className="mono" style={{ fontSize: 10.5, fontWeight: 600, color: p.tone }}>{p.delta}</span>
            </div>
            <div style={{ height: 3, borderRadius: 3, background: 'var(--line-2)', marginTop: 7, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: p.tone, width: p.w }} />
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: '13px 15px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--bad)', marginBottom: 6 }}>Suspected bypass</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ fontWeight: 600, fontSize: 24, letterSpacing: '-.8px' }}>1,164</span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>meters flagged</span>
            </div>
            <div className="sub" style={{ marginTop: 4 }}>Detector run 19 Aug 2026, 03:20</div>
          </div>
          <div className="grid" style={{ flex: '1 1 360px', minWidth: 0, gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 8 }}>
            {BYPASS.map((b) => (
              <div key={b.label} style={{ border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 10px', background: 'var(--surface-2)' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>{b.label}</div>
                <div style={{ fontWeight: 600, fontSize: 15, color: b.tone }}>{b.value}</div>
              </div>
            ))}
          </div>
          <button type="button" className="bypass-btn">Open Review Board</button>
        </div>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', marginBottom: 16 }}>
        <SalesShare />
        <Card style={{ padding: '13px 15px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div className="card-title">Water Usage by Suburb</div>
            <div className="meta">litres</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {SUBURBS.slice().sort((a, b) => b.usageN - a.usageN).slice(0, 11).map((s) => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span className="ellipsis" style={{ width: 112, fontSize: 10.5, color: 'var(--ink-4)', textAlign: 'right' }} title={s.name}>{s.name}</span>
                <div className="bar-track" style={{ flex: 1, height: 11 }}><div className="bar-fill" style={{ background: 'var(--teal)', width: pct(s.usageN, max.usage) }} /></div>
                <span className="mono" style={{ width: 88, fontSize: 10, color: 'var(--muted)' }}>{short(s.usageN)} L</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <SectionRule title="Suburb Analysis" note={`${SUBURBS.length} zones · sorted by tokens sold`} />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', marginBottom: 16 }}>
        {SUBURBS.slice().sort((a, b) => b.tokens - a.tokens).map((s) => (
          <Card key={s.name} hover style={{ padding: '11px 13px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
              <span className="ellipsis" style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, flex: 1 }} title={s.name}>{s.name}</span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', flex: 'none', marginLeft: 8 }}>{N(s.tokens)} tokens</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <Metric label="Total sales" value={P(s.salesN)} width={pct(s.salesN, max.sales)} color="#00468C" />
              <Metric label="Total usage" value={litres(s.usageN)} width={pct(s.usageN, max.usage)} color="#2A7A7E" valueColor="#2A7A7E" />
              <Metric label="Transactions" value={N(s.txN)} width={pct(s.txN, max.tx)} color="#97B8DC" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--line-3)' }}>
              <span style={{ fontSize: 10, color: 'var(--faint)' }}>{N(s.metersN)} meters</span>
              <button type="button" className="link" style={{ fontSize: 10, fontWeight: 500 }}>View history</button>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))' }}>
        <Card clip>
          <div className="card-head"><span className="card-title">Online payments by provider</span></div>
          <div className="table-wrap">
            <table className="tbl roomy">
              <TableHead cols={[{ label: 'Provider ID' }, { label: 'Transactions', align: 'right' }, { label: 'Total amount', align: 'right' }, { label: 'Share', align: 'right' }]} />
              <tbody>
                {PROVIDERS.map((p) => (
                  <tr key={p.id}>
                    <td className="mono" style={{ fontSize: 11.5 }}>{p.id}</td>
                    <td className="mono num" style={{ fontSize: 11.5 }}>{p.tx}</td>
                    <td className="mono num" style={{ fontSize: 11.5 }}>{p.amount}</td>
                    <td className="num"><span className="mono" style={{ fontWeight: 600, fontSize: 10.5, color: 'var(--navy)' }}>{p.share}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card clip>
          <div className="card-head" style={{ padding: '10px 15px' }}>
            <span className="card-title flex1">Sales ledger</span>
            {LEDGER_TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setLedgerTab(t)}
                aria-pressed={ledgerTab === t}
                style={{ fontSize: 11, fontWeight: ledgerTab === t ? 600 : 500, padding: '4px 10px', borderRadius: 5, background: ledgerTab === t ? 'var(--navy)' : 'var(--line-3)', color: ledgerTab === t ? '#fff' : 'var(--ink-4)' }}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <TableHead cols={[{ label: 'Date' }, { label: 'Total sales', align: 'right' }, { label: 'Excl. VAT', align: 'right' }, { label: 'VAT', align: 'right' }, { label: 'Transactions', align: 'right' }]} />
              <tbody>
                {LEDGER_DATES.map((d, i) => {
                  const t = DAILY[DAILY.length - 1 - i];
                  return (
                    <tr key={d}>
                      <td style={{ color: 'var(--ink-4)' }}>{d}, 2026</td>
                      <td className="mono num" style={{ fontSize: 11.5 }}>{P(t)}</td>
                      <td className="mono num" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{P(t * 0.88)}</td>
                      <td className="mono num" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{P(t * 0.12)}</td>
                      <td className="mono num" style={{ fontSize: 11.5 }}>{N(Math.round(t / 190))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, width, color, valueColor = '#181D23' }: { label: string; value: string; width: string; color: string; valueColor?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginBottom: 3 }}>
        <span style={{ color: 'var(--muted)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 10.5, color: valueColor }}>{value}</span>
      </div>
      <div style={{ height: 3, background: 'var(--line-3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', background: color, width }} />
      </div>
    </div>
  );
}

function DailyBars() {
  const dmax = Math.max(...DAILY);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 132 }}>
      {DAILY.map((v, i) => (
        <div key={i} title={`Aug ${i + 1} · ${P(v)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4, height: '100%' }}>
          <div className="daily-bar" style={{ height: pct(v, dmax) }} />
          <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--faint)' }}>{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

function MonthlyLine() {
  const pts = [5.9, 6.35, 7.4, 6.8, 7.1, 7.01]; // P millions
  const months = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
  const W = 300, H = 128, yMax = 8;
  const x = (i: number) => 14 + i * ((W - 28) / 5);
  const y = (v: number) => H - 18 - (v / yMax) * (H - 34);
  const path = pts.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 132, display: 'block' }} role="img" aria-label="Monthly sales, March to August 2026">
      {[1, 2, 3, 4].map((i) => <line key={i} x1={8} x2={W - 8} y1={14 + i * 22} y2={14 + i * 22} stroke="#ECEEF1" strokeWidth={1} />)}
      <path d={`${path} L${W - 14} ${H - 18} L14 ${H - 18} Z`} fill="#00468C" fillOpacity={0.07} />
      <path d={path} fill="none" stroke="#00468C" strokeWidth={2} strokeLinejoin="round" />
      {pts.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="#fff" stroke="#00468C" strokeWidth={2}>
          <title>{`${months[i]} · P ${v.toFixed(2)} M`}</title>
        </circle>
      ))}
      {months.map((m, i) => <text key={m} x={x(i)} y={H - 4} fill="#A1A8B2" fontSize={8.5} textAnchor="middle" fontFamily="IBM Plex Mono, monospace">{m}</text>)}
    </svg>
  );
}

function SalesShare() {
  const total = SUBURBS.reduce((a, s) => a + s.salesN, 0);
  const top = SUBURBS.slice().sort((a, b) => b.salesN - a.salesN).slice(0, 7);
  const rest = total - top.reduce((a, s) => a + s.salesN, 0);
  const rows = [
    ...top.map((s, i) => ({ name: s.name, tone: SHARE_PALETTE[i], v: s.salesN })),
    { name: 'Other zones', tone: SHARE_PALETTE[7], v: rest },
  ];
  return (
    <Card style={{ padding: '13px 15px' }}>
      <div className="card-title" style={{ marginBottom: 10 }}>Sales Share by Suburb</div>
      <div style={{ display: 'flex', height: 9, borderRadius: 5, overflow: 'hidden', marginBottom: 12 }}>
        {rows.map((s) => <div key={s.name} title={`${s.name} · ${P(s.v)}`} style={{ width: pct(s.v, total), background: s.tone }} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px' }}>
        {rows.map((s) => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, padding: '2px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.tone, flex: 'none' }} />
            <span className="flex1" style={{ color: 'var(--ink-4)' }}>{s.name}</span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink)' }}>{pct(s.v, total)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
