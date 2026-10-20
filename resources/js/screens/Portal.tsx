import { useState, type FormEvent } from 'react';
import { Segmented, TableHead } from '../components/ui';
import { Field, Modal, toast } from '../components/overlay';
import { addWorkOrder } from '../data/store';
import { downloadCsv } from '../lib/csv';
import { http, HttpError } from '../lib/http';
import type { LogEntry, ValidationResponse } from '../vending/types';
import { PURCHASES } from '../data/admin';
import { domesticProperties } from '../data/clients';
import { N, P, litres, rnd } from '../data/format';

const VIEWS = ['Tenant', 'Landlord'] as const;
type View = (typeof VIEWS)[number];

const PORTAL_NAV = ['Overview', 'Usage', 'Purchases', 'Support'] as const;
type PortalTab = (typeof PORTAL_NAV)[number];
const METER = 'WM-104000';
const RATE_PER_L = (10.21 * 1.14) / 1000;
type Purchase = [date: string, token: string, channel: string, units: string, amount: string];

const STATS = [
  { label: 'This month', value: '14,820 L', sub: '18% below your average', tone: '#2A7A7E' },
  { label: 'Spend YTD', value: 'P 2,184.00', sub: '14 purchases', tone: '#181D23' },
  { label: 'Daily average', value: '478 L', sub: 'household of 4', tone: '#181D23' },
];

const USAGE = [12400, 13900, 15600, 14100, 16800, 18200, 17400, 15900, 14700, 13800, 15200, 14820];
const MONTHS = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

const METER_DATA = [
  { k: 'Meter serial', v: 'WM-104000' }, { k: 'DevEUI', v: 'A840419B2C7D' },
  { k: 'Last reading', v: '1,428,905 L' }, { k: 'Last uplink', v: '19 Aug 12:58', tone: '#237A48' },
  { k: 'Signal (RSSI)', v: '-94 dBm' }, { k: 'Battery', v: '82%', tone: '#237A48' },
  { k: 'Serving gateway', v: 'GW-GAB-02' }, { k: 'Tariff', v: 'Domestic Band 2' },
];

/** Landlord Mpho Sebego's portfolio (domestic client 0). */
const PORTFOLIO = (() => {
  const r = rnd(8181);
  return domesticProperties(0).map((p) => {
    const bal = Math.round((r() * 360 - 80) * 100) / 100;
    return { ...p, usage: N(Math.round(6000 + r() * 16000)) + ' L', balN: bal };
  });
})();

/** Customer self-service portal, previewed inside the admin shell. */
export function Portal() {
  const [view, setView] = useState<View>('Tenant');
  const [tab, setTab] = useState<PortalTab>('Overview');
  const [balance, setBalance] = useState(142.6);
  const [purchases, setPurchases] = useState<Purchase[]>(() => PURCHASES.map((p) => [...p] as Purchase));
  const [dialog, setDialog] = useState<{ kind: 'buy'; amount?: number } | { kind: 'problem' } | null>(null);
  const owner = view === 'Landlord';
  const umax = Math.max(...USAGE);
  const showUsage = tab === 'Overview' || tab === 'Usage';
  const showPurchases = tab === 'Overview' || tab === 'Purchases';
  const showSupport = tab === 'Overview' || tab === 'Support';

  const statement = () => {
    downloadCsv('statement-mpho-sebego-aug-2026', ['Meter', 'Property', 'Occupant', 'Vending', 'Usage MTD', 'Balance (P)'],
      PORTFOLIO.map((p) => [p.meter, p.plot, p.tenant, p.vends, p.usage, p.balN.toFixed(2)]));
    toast('Statement downloaded');
  };

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div className="card clip" style={{ borderRadius: 10, boxShadow: '0 1px 3px rgba(16,24,40,.05)' }}>
        <div className="portal-chrome">
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Customer portal preview</span>
          <div className="mono portal-url">myaccount.amplifiediot.co.bw/usage</div>
        </div>

        <div className="portal-head">
          <img src="/assets/leeroy-logo.png" alt="Leeroy Systems" style={{ height: 38, width: 'auto', display: 'block' }} />
          <div className="flex1" style={{ minWidth: 180 }}>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-.2px' }}>My Water Account</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Meter WM-104000 · Plot 9000, Block 8, Gaborone</div>
          </div>
          <nav style={{ display: 'flex', gap: 14 }}>
            {PORTAL_NAV.map((p) => {
              const on = p === tab;
              return (
                <button key={p} type="button" aria-current={on ? 'page' : undefined} onClick={() => setTab(p)}
                  style={{ fontSize: 11.5, fontWeight: on ? 600 : 500, color: on ? 'var(--navy)' : 'var(--muted)', borderBottom: `2px solid ${on ? 'var(--navy)' : 'transparent'}`, paddingBottom: 3 }}>
                  {p}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="portal-relation">
          <span className="badge" style={{ background: 'var(--navy-tint)', color: 'var(--navy)', padding: '3px 8px' }}>
            {owner ? 'Landlord · owner' : 'Tenant · occupant'}
          </span>
          <span className="flex1" style={{ fontSize: 11.5, color: 'var(--ink-4)', minWidth: 220 }}>
            {owner
              ? 'You own 14 metered properties across Gaborone. Tenants vend in their own names; vacant units bill to you.'
              : 'Meter WM-104000 is owned by Mpho Sebego (landlord). You buy water in your own name — credit stays on this meter.'}
          </span>
          <span className="label">Signed in as</span>
          <Segmented options={VIEWS} value={view} onChange={setView} tone="solid" labels={{ Tenant: 'Tenant view', Landlord: 'Landlord view' }} />
        </div>

        {owner && (
          <div style={{ padding: '16px 22px 0' }}>
            <div className="card clip">
              <div className="card-head" style={{ gap: 10, flexWrap: 'wrap' }}>
                <span className="card-title flex1">My properties · 14 meters</span>
                <span className="meta">13 let · 1 vacant · P 384.20 owed on vacant units</span>
                <button type="button" className="link" style={{ fontSize: 11 }} onClick={statement}>Statement</button>
              </div>
              <div className="table-wrap">
                <table className="tbl">
                  <TableHead cols={[{ label: 'Meter' }, { label: 'Property' }, { label: 'Occupant' }, { label: 'Vending', align: 'right' }, { label: 'Usage MTD', align: 'right' }, { label: 'Balance', align: 'right' }]} />
                  <tbody>
                    {PORTFOLIO.map((p) => (
                      <tr key={p.meter}>
                        <td className="mono" style={{ color: 'var(--navy)' }}>{p.meter}</td>
                        <td>{p.plot}</td>
                        <td style={{ color: 'var(--ink-4)' }}>{p.tenant}</td>
                        <td className="num">
                          <span style={{ fontWeight: 600, fontSize: 11, color: p.tone, border: '1px solid var(--line)', padding: '2px 6px', borderRadius: 3 }}>{p.vends}</span>
                        </td>
                        <td className="mono num" style={{ color: 'var(--teal)' }}>{p.usage}</td>
                        <td className="mono num" style={{ color: p.balN < 0 ? 'var(--bad)' : 'var(--ink)' }}>{P(p.balN)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sub" style={{ padding: '9px 15px', borderTop: '1px solid var(--line-2)', lineHeight: 1.5 }}>
                Tenants buy water in their own names against these meters. You keep ownership, see every meter's usage and balance, and are billed directly only for vacant units.
              </div>
            </div>
          </div>
        )}

        <div className="grid portal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            {showUsage && <div className="grid g-3">
              {STATS.map((s) => (
                <div key={s.label} className="card" style={{ padding: '16px 18px', background: 'var(--surface-2)' }}>
                  <div className="label" style={{ marginBottom: 7 }}>{s.label}</div>
                  <div style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.6px', color: s.tone }}>{s.value}</div>
                  <div className="sub" style={{ marginTop: 5 }}>{s.sub}</div>
                </div>
              ))}
            </div>}

            {showUsage && <div className="card" style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className="card-title">Usage history</div>
                <div className="meta">litres per month · 12 months</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 140 }}>
                {USAGE.map((v, i) => (
                  <div key={MONTHS[i]} title={`${MONTHS[i]} · ${litres(v)}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 5, height: '100%' }}>
                    <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--muted)' }}>{(v / 1000).toFixed(1)}k</span>
                    <div style={{ width: '100%', borderRadius: '3px 3px 0 0', background: i === 11 ? 'var(--navy)' : '#9CCBC8', height: ((v / umax) * 100).toFixed(1) + '%' }} />
                    <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--faint)' }}>{MONTHS[i]}</span>
                  </div>
                ))}
              </div>
            </div>}

            {showPurchases && <div className="card clip">
              <div className="card-head"><span className="card-title">Purchase history</span></div>
              <div className="table-wrap">
                <table className="tbl">
                  <TableHead cols={[{ label: 'Date' }, { label: 'Token' }, { label: 'Channel' }, { label: 'Units', align: 'right' }, { label: 'Amount', align: 'right' }]} />
                  <tbody>
                    {purchases.map(([date, token, channel, units, amount]) => (
                      <tr key={token}>
                        <td style={{ color: 'var(--ink-4)' }}>{date}</td>
                        <td className="mono">{token}</td>
                        <td style={{ color: 'var(--muted)' }}>{channel}</td>
                        <td className="mono num" style={{ color: 'var(--teal)' }}>{units}</td>
                        <td className="mono num" style={{ fontWeight: 600 }}>{amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>}

            {tab === 'Support' && <SupportPanel onReport={() => setDialog({ kind: 'problem' })} />}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ padding: '18px 20px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--navy)', marginBottom: 8 }}>Current balance</div>
              <div style={{ fontWeight: 600, fontSize: 30, letterSpacing: '-1.2px', color: 'var(--navy)' }}>{P(balance)}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>≈ {N(Math.round(balance / RATE_PER_L))} L at current tariff · about {Math.round(balance / (478 * RATE_PER_L))} days left</div>
              <button type="button" className="btn-primary" style={{ marginTop: 13, width: '100%', padding: 9, borderRadius: 7, fontSize: 12 }} onClick={() => setDialog({ kind: 'buy' })}>Buy water</button>
              <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                {[50, 100, 200].map((q) => (
                  <button key={q} type="button" className="mono quick-buy" onClick={() => setDialog({ kind: 'buy', amount: q })}>P {q}</button>
                ))}
              </div>
            </div>

            {(showUsage || tab === 'Support') && <div className="card" style={{ padding: '18px 20px' }}>
              <div className="card-title" style={{ marginBottom: 10 }}>Meter data</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {METER_DATA.map((m) => (
                  <div key={m.k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, paddingBottom: 8, borderBottom: '1px solid var(--line-3)' }}>
                    <span className="flex1" style={{ color: 'var(--muted)' }}>{m.k}</span>
                    <span className="mono" style={{ fontSize: 11, color: m.tone ?? 'var(--ink)' }}>{m.v}</span>
                  </div>
                ))}
              </div>
            </div>}

            {showSupport && <div style={{ border: '1px solid #EFDDB8', borderRadius: 8, padding: '18px 20px', background: '#FBF6EC' }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--warn-ink)', marginBottom: 6 }}>Leak advisory</div>
              <div style={{ fontSize: 11.5, color: '#6B4200', lineHeight: 1.5 }}>
                Continuous flow of 42 L/h detected between 01:00 and 05:00 on 17 Aug. Check internal plumbing or log a technician visit.
              </div>
              <button type="button" style={{ marginTop: 10, fontSize: 11, fontWeight: 600, color: 'var(--warn-ink)' }} onClick={() => setDialog({ kind: 'problem' })}>Report a problem</button>
            </div>}
          </div>
        </div>
      </div>

      {dialog?.kind === 'buy' && (
        <BuyWater
          initial={dialog.amount}
          purchaser={owner ? 'owner' : 'occupant'}
          onClose={() => setDialog(null)}
          onDone={(p, amount) => { setPurchases((ps) => [p, ...ps]); setBalance((b) => b + amount); }}
        />
      )}
      {dialog?.kind === 'problem' && <ProblemDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/* ---------- Buy water ---------- */

const CHANNELS = ['Orange Money', 'MyZaka', 'Portal card'];

/**
 * Customer purchase flow. The vending system first asks the MDMS to validate the meter
 * (same rules as /api/vending/validate); only an approved meter gets an STS token.
 * In this preview the vending system's token is simulated.
 */
function BuyWater({ initial, purchaser, onClose, onDone }: { initial?: number; purchaser: 'occupant' | 'owner'; onClose: () => void; onDone: (p: Purchase, amount: number) => void }) {
  const [amount, setAmount] = useState(String(initial ?? 100));
  const [channel, setChannel] = useState(CHANNELS[0]);
  const [phase, setPhase] = useState<'form' | 'checking' | 'declined' | 'done'>('form');
  const [res, setRes] = useState<ValidationResponse | null>(null);
  const [token, setToken] = useState('');
  const n = Number(amount);
  const err = !(n >= 10) ? 'Minimum purchase is P 10.' : n > 5000 ? 'Maximum online purchase is P 5,000.' : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (err) return;
    setPhase('checking');
    let v: ValidationResponse;
    try {
      ({ entry: { res: v } } = await http<{ entry: LogEntry }>('POST', '/vending/check', {
        meter: METER, purchaser, amount: n, vendorRef: 'portal-' + Date.now().toString(36), source: 'Portal',
      }));
    } catch (e) {
      setPhase('form');
      toast(e instanceof HttpError ? e.message : 'Could not reach the MDMS. Try again.', 'bad');
      return;
    }
    setRes(v);
    if (v.result !== 'APPROVED') { setPhase('declined'); return; }
    // The vending system issues the STS token; this preview simulates it.
    const t = Array.from({ length: 5 }, () => String(Math.floor(1000 + Math.random() * 9000))).join(' ');
    setToken(t);
    setPhase('done');
    const units = N(Math.round(n / RATE_PER_L)) + ' L';
    onDone(['19 Aug 2026, 13:01', t.split(' ').slice(0, 4).join(' '), channel, units, P(n)], n);
    toast(`Token issued · ${units} added to ${METER}`);
  };

  return (
    <Modal title="Buy water" onClose={onClose} width={440} footer={phase === 'form' ? <>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" form="buy" className="btn-primary">Pay {n > 0 ? P(n) : ''}</button>
    </> : phase === 'checking' ? undefined : <button type="button" className="btn-primary" onClick={onClose}>Done</button>}>
      {phase === 'form' && (
        <form id="buy" onSubmit={submit} noValidate style={{ display: 'contents' }}>
          <div className="sub">Meter <span className="mono">{METER}</span> · Plot 9000, Block 8 · buying as {purchaser}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[50, 100, 200, 500].map((q) => (
              <button key={q} type="button" className={`mono quick-buy${n === q ? ' on' : ''}`} onClick={() => setAmount(String(q))}>P {q}</button>
            ))}
          </div>
          <div className="form-row">
            <Field label="Amount (P)" error={err}><input type="number" min={10} max={5000} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Pay with"><select value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
          {!err && <div className="sub">≈ {N(Math.round(n / RATE_PER_L))} L at P 10.21/kL + 14% VAT.</div>}
        </form>
      )}
      {phase === 'checking' && <div className="buy-step"><span className="spin" style={{ display: 'inline-flex' }}>◌</span> Checking the meter with the MDMS…</div>}
      {phase === 'declined' && res && (
        <div className="verdict bad" style={{ marginTop: 0 }}>
          <span className="verdict-badge">Declined</span> <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>{res.code}</span>
          <div style={{ fontSize: 13, marginTop: 8 }}>{res.message}</div>
          <div className="sub" style={{ marginTop: 6 }}>You have not been charged.</div>
        </div>
      )}
      {phase === 'done' && (
        <div className="verdict ok" style={{ marginTop: 0 }}>
          <span className="verdict-badge">Paid</span>
          <div className="sub" style={{ marginTop: 10 }}>Your STS token</div>
          <div className="token-big mono">{token}</div>
          <div style={{ fontSize: 12.5 }}>{N(Math.round(n / RATE_PER_L))} L · {P(n)} via {channel}</div>
          {res?.warnings.map((w) => <div key={w} className="verdict-warn">⚠ {w}</div>)}
          <div className="sub" style={{ marginTop: 8 }}>The token is also sent to the meter over the air. Token generated by the vending system (simulated in this preview).</div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Support ---------- */

const PROBLEMS = ['Leak or burst', 'No water', 'Token not accepted', 'Meter display fault', 'Other'];

function ProblemDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState(PROBLEMS[0]);
  const [text, setText] = useState('');
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const errors = { text: text.trim().length < 10 && 'Describe the problem in a sentence or two.', phone: !/^(\+267)?\s?7\d{7}$/.test(phone.replace(/\s/g, '')) && 'Enter a Botswana mobile number, e.g. 71 234 567.' };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (errors.text || errors.phone) return;
    const id = addWorkOrder({ type: 'Customer fault report', target: METER, zone: 'Block 8', source: 'Customer portal · ' + kind, assignee: 'Unassigned', priority: kind === 'Leak or burst' || kind === 'No water' ? 'High' : 'Low', due: '21 Aug' });
    toast(`Thanks — reference ${id}. A technician will call you.`);
    onClose();
  };
  return (
    <Modal title="Report a problem" onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" form="problem" className="btn-primary">Send report</button>
    </>}>
      <form id="problem" onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <Field label="What’s wrong?"><select value={kind} onChange={(e) => setKind(e.target.value)}>{PROBLEMS.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Details" error={touched && errors.text}><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Water running at the meter box since this morning" /></Field>
        <Field label="Mobile number" error={touched && errors.phone}><input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="71 234 567" /></Field>
      </form>
    </Modal>
  );
}

function SupportPanel({ onReport }: { onReport: () => void }) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div className="card-title" style={{ marginBottom: 6 }}>Support</div>
      <div className="sub" style={{ lineHeight: 1.6 }}>
        Report leaks, supply problems or token issues and a technician will contact you. For emergencies call the 24-hour line on <b style={{ color: 'var(--ink)' }}>0800 600 140</b>.
      </div>
      <button type="button" className="btn-primary" style={{ marginTop: 12 }} onClick={onReport}>Report a problem</button>
    </div>
  );
}
