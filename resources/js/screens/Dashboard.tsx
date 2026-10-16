import { useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { Badge, Card, SectionRule, Segmented, TableHead } from '../components/ui';
import { Field, Modal, toast } from '../components/overlay';
import { SUBURBS, type Suburb } from '../data/fleet';
import { N, P, litres, pct, rnd, short } from '../data/format';
import { addWorkOrder, useStore } from '../data/store';
import { downloadCsv } from '../lib/csv';

const PERIODS = ['Aug 2026', 'Q3 2026', 'YTD', 'Custom'] as const;
const LEDGER_TABS = ['Sales', 'Usage', 'Meter analysis'] as const;

const UP = '#0e9a5a';
const DOWN = '#d92d20';

/** Month-to-date figures; other periods are scaled from these by the days they cover. */
const KPIS: { label: string; n: number; fmt: (n: number) => string; sub: string; delta: string; up: boolean }[] = [
  { label: 'Total sales', n: 7014728.71, fmt: P, sub: 'period total', delta: '▲ 8.4%', up: true },
  { label: 'Transactions', n: 26478, fmt: (n) => N(Math.round(n)), sub: 'token issues', delta: '▲ 5.1%', up: true },
  { label: 'Counter excl. VAT', n: 3535646.07, fmt: P, sub: 'vendor desks', delta: '▲ 2.7%', up: true },
  { label: 'Total usage', n: 360739965, fmt: (n) => litres(Math.round(n)), sub: 'metered volume', delta: '▲ 1.9%', up: true },
  { label: 'Online payments', n: 3020215.4, fmt: P, sub: '3 providers', delta: '▲ 14.2%', up: true },
  { label: 'Counter sales', n: 3994513.31, fmt: P, sub: 'vendor desks', delta: '▼ 1.4%', up: false },
];
/** Days covered by each preset period, against the 19 days of August so far. */
const PERIOD_DAYS: Record<string, number> = { 'Aug 2026': 19, 'Q3 2026': 50, YTD: 231 };
const VAT = 0.14;

const BYPASS_SUSPECTS = (() => {
  const r = rnd(3203);
  const zones = ['Old Naledi', 'Block 8', 'Broadhurst', 'Tsholofelo', 'Bontleng', 'Phase 4', 'Block 9'];
  return Array.from({ length: 9 }, (_, i) => ({
    meter: 'WM-' + (104637 + i * 364), zone: zones[i % zones.length],
    score: Math.round(96 - i * 3.4 - r() * 3), days: Math.round(30 + r() * 120),
    signal: ['Zero flow, credit unused', 'Night flow without registration', 'Tamper + usage drop', 'Usage 80% below neighbours'][i % 4],
  }));
})();

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
  const [custom, setCustom] = useState<{ from: string; to: string; days: number } | null>(null);
  const [dialog, setDialog] = useState<'custom' | 'bypass' | Suburb | null>(null);
  const [ledgerTab, setLedgerTab] = useState<(typeof LEDGER_TABS)[number]>('Sales');
  const [snapshot, setSnapshot] = useState('19 Aug 2026, 13:01');
  const [refreshing, setRefreshing] = useState(false);

  const days = period === 'Custom' ? custom?.days ?? 19 : PERIOD_DAYS[period];
  const factor = days / 19;
  const periodLabel = period === 'Custom' && custom ? `${custom.from} – ${custom.to}` : period;

  const choosePeriod = (p: (typeof PERIODS)[number]) => (p === 'Custom' ? setDialog('custom') : setPeriod(p));
  const refresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      const d = new Date();
      setSnapshot('19 Aug 2026, ' + String(13).padStart(2, '0') + ':' + String(1 + (d.getSeconds() % 50)).padStart(2, '0'));
      setRefreshing(false);
      toast('Dashboard refreshed from the network server');
    }, 700);
  };

  return (
    <div>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 14, flexWrap: 'wrap' }}>
        <span className="label">PERIOD</span>
        <Segmented options={PERIODS} value={period} onChange={choosePeriod} labels={custom ? { Custom: `${custom.from} – ${custom.to}` } : undefined} />
        <div className="flex1" />
        <span className="sub">Snapshot {snapshot}</span>
        <button type="button" className="btn" onClick={refresh} disabled={refreshing} aria-busy={refreshing}>
          <span className={refreshing ? 'spin' : undefined} style={{ display: 'flex' }}><Icon name="refresh" size={14} /></span>{refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </Card>

      <div className="grid kpi-grid" style={{ marginBottom: 14 }}>
        {KPIS.map((k) => (
          <Card key={k.label} style={{ padding: '16px 18px' }}>
            <div className="label" style={{ marginBottom: 7 }}>{k.label}</div>
            <div className="kpi-value">{k.fmt(k.n * factor)}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: k.up ? UP : DOWN, whiteSpace: 'nowrap' }}>{k.delta}</span>
              <span className="sub">{k.sub} · {periodLabel}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', marginBottom: 16 }}>
        <Card style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 11 }}>
            <div className="card-title">Daily Sales · August 2026</div>
            <div className="meta">Pula, incl. VAT</div>
          </div>
          <DailyBars />
        </Card>
        <Card style={{ padding: '18px 20px' }}>
          <div className="card-title" style={{ marginBottom: 4 }}>Monthly Sales</div>
          <div className="meta" style={{ marginBottom: 8 }}>Last 6 months</div>
          <MonthlyLine />
        </Card>
      </div>

      <SectionRule title="LoRaWAN Port Traffic" note="uplinks decoded, period" />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', marginBottom: 16 }}>
        {PORTS.map((p) => (
          <Card key={p.label} style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: p.tone, marginBottom: 6 }}>{p.label}</div>
            <div style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-.5px' }}>{p.value}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <span className="sub">{p.kind}</span>
              <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: p.tone }}>{p.delta}</span>
            </div>
            <div style={{ height: 3, borderRadius: 3, background: 'var(--line-2)', marginTop: 7, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: p.tone, width: p.w }} />
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: '18px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--bad)', marginBottom: 6 }}>Suspected bypass</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ fontWeight: 600, fontSize: 24, letterSpacing: '-.8px' }}>1,164</span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>meters flagged</span>
            </div>
            <div className="sub" style={{ marginTop: 4 }}>Detector run 19 Aug 2026, 03:20</div>
          </div>
          <div className="grid" style={{ flex: '1 1 360px', minWidth: 0, gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 8 }}>
            {BYPASS.map((b) => (
              <div key={b.label} style={{ border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 10px', background: 'var(--surface-2)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{b.label}</div>
                <div style={{ fontWeight: 600, fontSize: 15, color: b.tone }}>{b.value}</div>
              </div>
            ))}
          </div>
          <button type="button" className="bypass-btn" onClick={() => setDialog('bypass')}>Open Review Board</button>
        </div>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', marginBottom: 16 }}>
        <SalesShare />
        <Card style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div className="card-title">Water Usage by Suburb</div>
            <div className="meta">litres</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {SUBURBS.slice().sort((a, b) => b.usageN - a.usageN).slice(0, 11).map((s) => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span className="ellipsis" style={{ width: 112, fontSize: 11.5, color: 'var(--ink-4)', textAlign: 'right' }} title={s.name}>{s.name}</span>
                <div className="bar-track" style={{ flex: 1, height: 11 }}><div className="bar-fill" style={{ background: 'var(--teal)', width: pct(s.usageN, max.usage) }} /></div>
                <span className="mono" style={{ width: 88, fontSize: 11, color: 'var(--muted)' }}>{short(s.usageN)} L</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <SectionRule title="Suburb Analysis" note={`${SUBURBS.length} zones · sorted by tokens sold`} />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', marginBottom: 16 }}>
        {SUBURBS.slice().sort((a, b) => b.tokens - a.tokens).map((s) => (
          <Card key={s.name} hover style={{ padding: '16px 18px 14px' }}>
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
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>{N(s.metersN)} meters</span>
              <button type="button" className="link" style={{ fontSize: 11.5, fontWeight: 500 }} onClick={() => setDialog(s)}>View history</button>
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
                    <td className="num"><span className="mono" style={{ fontWeight: 600, fontSize: 11.5, color: 'var(--navy)' }}>{p.share}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card clip>
          <div className="card-head">
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
            <Ledger tab={ledgerTab} />
          </div>
        </Card>
      </div>

      {dialog === 'custom' && <CustomPeriod onClose={() => setDialog(null)} onApply={(c) => { setCustom(c); setPeriod('Custom'); setDialog(null); }} />}
      {dialog === 'bypass' && <BypassBoard onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && <SuburbHistory s={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

/* ---------- Ledger ---------- */

function Ledger({ tab }: { tab: (typeof LEDGER_TABS)[number] }) {
  const rows = LEDGER_DATES.map((d, i) => ({ d, t: DAILY[DAILY.length - 1 - i], i }));
  const exportIt = () => {
    downloadCsv('sales-ledger-' + tab.toLowerCase().replace(/ /g, '-'), ['Date', 'Total incl. VAT', 'Excl. VAT', 'VAT', 'Transactions'],
      rows.map(({ d, t }) => [d + ', 2026', t.toFixed(2), (t / (1 + VAT)).toFixed(2), (t - t / (1 + VAT)).toFixed(2), Math.round(t / 190)]));
    toast('Ledger exported');
  };
  if (tab === 'Usage') {
    return (
      <table className="tbl">
        <TableHead cols={[{ label: 'Date' }, { label: 'Metered volume', align: 'right' }, { label: 'Avg per meter', align: 'right' }, { label: 'Estimated (VEE)', align: 'right' }]} />
        <tbody>{rows.map(({ d, t, i }) => {
          const vol = Math.round(t * 51.4);
          return <tr key={d}><td style={{ color: 'var(--ink-4)' }}>{d}, 2026</td><td className="mono num" style={{ color: 'var(--teal)' }}>{litres(vol)}</td><td className="mono num">{N(Math.round(vol / 50412))} L</td><td className="mono num" style={{ color: 'var(--muted)' }}>{(1.4 + (i % 4) * 0.3).toFixed(1)}%</td></tr>;
        })}</tbody>
      </table>
    );
  }
  if (tab === 'Meter analysis') {
    return (
      <table className="tbl">
        <TableHead cols={[{ label: 'Date' }, { label: 'Meters reporting', align: 'right' }, { label: 'Vended', align: 'right' }, { label: 'Zero credit', align: 'right' }, { label: 'Avg sale', align: 'right' }]} />
        <tbody>{rows.map(({ d, t, i }) => (
          <tr key={d}><td style={{ color: 'var(--ink-4)' }}>{d}, 2026</td><td className="mono num">{N(46528 - i * 37)}</td><td className="mono num">{N(Math.round(t / 190))}</td><td className="mono num" style={{ color: 'var(--warn-ink)' }}>{N(812 + ((i * 53) % 140))}</td><td className="mono num">{P(190 + (i % 5) * 4.5)}</td></tr>
        ))}</tbody>
      </table>
    );
  }
  return (
    <>
      <table className="tbl">
        <TableHead cols={[{ label: 'Date' }, { label: 'Total sales', align: 'right' }, { label: 'Excl. VAT', align: 'right' }, { label: 'VAT 14%', align: 'right' }, { label: 'Transactions', align: 'right' }]} />
        <tbody>{rows.map(({ d, t }) => (
          <tr key={d}>
            <td style={{ color: 'var(--ink-4)' }}>{d}, 2026</td>
            <td className="mono num">{P(t)}</td>
            <td className="mono num" style={{ color: 'var(--ink-4)' }}>{P(t / (1 + VAT))}</td>
            <td className="mono num" style={{ color: 'var(--ink-4)' }}>{P(t - t / (1 + VAT))}</td>
            <td className="mono num">{N(Math.round(t / 190))}</td>
          </tr>
        ))}</tbody>
      </table>
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line-2)' }}><button type="button" className="link" style={{ fontSize: 11.5 }} onClick={exportIt}>Export ledger CSV</button></div>
    </>
  );
}

/* ---------- Dialogs ---------- */

function CustomPeriod({ onClose, onApply }: { onClose: () => void; onApply: (c: { from: string; to: string; days: number }) => void }) {
  const [from, setFrom] = useState('2026-08-01');
  const [to, setTo] = useState('2026-08-19');
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const err = !(days > 0) ? 'End date must be on or after the start date.' : Date.parse(to) > Date.parse('2026-08-19') ? 'End date cannot be after today (19 Aug 2026).' : '';
  const fmt = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!err) onApply({ from: fmt(from), to: fmt(to), days }); };
  return (
    <Modal title="Custom period" onClose={onClose} width={420} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" form="custom-period" className="btn-primary" disabled={!!err}>Apply</button>
    </>}>
      <form id="custom-period" onSubmit={submit} style={{ display: 'contents' }}>
        <div className="form-row">
          <Field label="From"><input type="date" value={from} max="2026-08-19" onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={to} max="2026-08-19" onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {err ? <div className="form-error">{err}</div> : <div className="sub">{days} day{days > 1 ? 's' : ''} selected.</div>}
      </form>
    </Modal>
  );
}

function BypassBoard({ onClose }: { onClose: () => void }) {
  const orders = useStore((s) => s.workOrders);
  const raised = (m: string) => orders.find((w) => w.target === m && w.type === 'Bypass inspection');
  const raise = (b: (typeof BYPASS_SUSPECTS)[number]) => {
    const id = addWorkOrder({ type: 'Bypass inspection', target: b.meter, zone: b.zone, source: 'Bypass review board', assignee: 'Unassigned', priority: b.score > 85 ? 'High' : 'Medium', due: '22 Aug' });
    toast(`${id} raised for ${b.meter}`);
  };
  return (
    <Modal title="Suspected bypass · review board" onClose={onClose} width={760}>
      <div className="sub">Highest-risk meters from last night’s detector run. Raise an inspection to send a field team.</div>
      <div className="table-wrap" style={{ margin: '0 -20px' }}>
        <table className="tbl">
          <TableHead cols={[{ label: 'Meter' }, { label: 'Zone' }, { label: 'Signal' }, { label: 'Risk', align: 'right' }, { label: 'Flagged', align: 'right' }, { label: '', align: 'right' }]} />
          <tbody>{BYPASS_SUSPECTS.map((b) => {
            const wo = raised(b.meter);
            return (
              <tr key={b.meter}>
                <td className="mono" style={{ color: 'var(--navy)' }}>{b.meter}</td>
                <td>{b.zone}</td>
                <td style={{ color: 'var(--ink-4)' }}>{b.signal}</td>
                <td className="num"><span className="mono" style={{ fontWeight: 600, color: b.score > 85 ? 'var(--bad)' : 'var(--warn-ink)' }}>{b.score}</span></td>
                <td className="mono num" style={{ color: 'var(--muted)' }}>{b.days} d</td>
                <td className="num">{wo ? <Badge status="Queued" label={wo.id} /> : <button type="button" className="link" style={{ fontSize: 11.5 }} onClick={() => raise(b)}>Raise inspection</button>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Modal>
  );
}

function SuburbHistory({ s, onClose }: { s: Suburb; onClose: () => void }) {
  const r = rnd(s.name.length * 97 + s.tokens);
  const months = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
  const hist = months.map((m, i) => ({ m, sales: s.salesN * (0.78 + i * 0.04 + r() * 0.12), usage: s.usageN * (0.8 + r() * 0.3) }));
  const max = Math.max(...hist.map((h) => h.sales));
  return (
    <Modal title={`${s.name} · 6-month history`} onClose={onClose} width={560}>
      <div className="grid g-3">
        <div><div className="label">Meters</div><div className="stat-value">{N(s.metersN)}</div></div>
        <div><div className="label">Tokens this month</div><div className="stat-value">{N(s.tokens)}</div></div>
        <div><div className="label">Sales this month</div><div className="stat-value">{P(s.salesN)}</div></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 150, marginTop: 6 }}>
        {hist.map((h) => (
          <div key={h.m} title={`${h.m} · ${P(h.sales)} · ${litres(Math.round(h.usage))}`} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 5 }}>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{short(Math.round(h.sales))}</span>
            <div style={{ width: '100%', height: (h.sales / max) * 100 + '%', background: h.m === 'Aug' ? 'var(--navy)' : '#97B8DC', borderRadius: '4px 4px 0 0' }} />
            <span style={{ fontSize: 11, color: 'var(--faint)' }}>{h.m}</span>
          </div>
        ))}
      </div>
      <div className="sub">Sales in Pula incl. VAT. August is month to date.</div>
    </Modal>
  );
}

function Metric({ label, value, width, color, valueColor = '#181D23' }: { label: string; value: string; width: string; color: string; valueColor?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
        <span style={{ color: 'var(--muted)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 11.5, color: valueColor }}>{value}</span>
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
    <Card style={{ padding: '18px 20px' }}>
      <div className="card-title" style={{ marginBottom: 10 }}>Sales Share by Suburb</div>
      <div style={{ display: 'flex', height: 9, borderRadius: 5, overflow: 'hidden', marginBottom: 12 }}>
        {rows.map((s) => <div key={s.name} title={`${s.name} · ${P(s.v)}`} style={{ width: pct(s.v, total), background: s.tone }} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px' }}>
        {rows.map((s) => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, padding: '2px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.tone, flex: 'none' }} />
            <span className="flex1" style={{ color: 'var(--ink-4)' }}>{s.name}</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink)' }}>{pct(s.v, total)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
