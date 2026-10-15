import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge, Card, StatCard, Switch, TableHead } from '../components/ui';
import { Field, toast } from '../components/overlay';
import { N, P, rnd } from '../data/format';
import { downloadCsv } from '../lib/csv';
import {
  DEFAULT_RULES, sampleMeters, validateMeter,
  type ValidationRequest, type ValidationResponse, type ValidationRules,
} from '../vending/validate';

const ENDPOINT = '/api/vending/validate';
const VENDORS = ['Orange Money', 'MyZaka', 'CBD counter', 'Portal card', 'Block 8 kiosk'];
const NOW = new Date(Date.UTC(2026, 7, 19, 13, 1));

interface LogEntry { id: string; t: string; vendor: string; meter: string; amount?: number; res: ValidationResponse; source: 'API' | 'Console' }

const CODE_TEXT: Record<string, string> = {
  OK: 'Approved', INVALID_FORMAT: 'Invalid meter number', METER_NOT_FOUND: 'Meter not registered', ACCOUNT_SUSPENDED: 'Account suspended',
  KYC_INCOMPLETE: 'KYC incomplete', TAMPER_HOLD: 'Tamper hold', VENDING_NOT_PERMITTED: 'Vending not permitted', PURCHASER_NOT_PERMITTED: 'Wrong purchaser',
};

/** Seed log: recent calls from the vending system, run through the real rules. */
function seedLog(): LogEntry[] {
  const r = rnd(5150);
  // Mostly good meters, with the occasional decline the vending team needs to see.
  const good = sampleMeters().filter((m) => validateMeter({ meter: m }).result === 'APPROVED');
  const bad = ['WM-104273', 'WM-104455', 'WM-104028', 'WM-999120', 'WM-10488'];
  return Array.from({ length: 14 }, (_, i) => {
    const meter = i % 5 === 3 ? bad[(i / 5) | 0] : good[Math.floor(r() * good.length)];
    const amount = [50, 100, 100, 200, 500][Math.floor(r() * 5)];
    const t = new Date(NOW.getTime() - (i * 7 + r() * 6) * 6e4);
    return {
      id: 'VAL-' + (771240 - i * 3), t: t.toISOString().slice(11, 19), vendor: VENDORS[Math.floor(r() * VENDORS.length)],
      meter, amount, source: 'API' as const, res: validateMeter({ meter, amount }, DEFAULT_RULES, t),
    };
  });
}

interface Sale { ref: string; t: string; vendor: string; meter: string; amount: number; units: string; token: string; validation: string; status: 'Matched' | 'Unmatched' }

function seedSales(log: LogEntry[]): Sale[] {
  const r = rnd(6262);
  const approved = log.filter((l) => l.res.result === 'APPROVED');
  const sales: Sale[] = approved.slice(0, 7).map((l, i) => ({
    ref: 'VS-' + (55120 + i * 11), t: l.t, vendor: l.vendor, meter: l.meter, amount: l.amount ?? 100,
    units: N(Math.round(((l.amount ?? 100) / 1.14 / (l.res.tariff?.ratePerKl ?? 10.21)) * 1000)) + ' L',
    token: '•••• •••• •••• ' + String(Math.floor(r() * 9000 + 1000)), validation: l.id, status: 'Matched',
  }));
  sales.splice(3, 0, { ref: 'VS-55141', t: '12:22:51', vendor: 'CBD counter', meter: 'WM-104637', amount: 100, units: '8,592 L', token: '•••• •••• •••• 7713', validation: '—', status: 'Unmatched' });
  return sales;
}

/** Vending integration: the vending system validates meters here before issuing STS tokens. */
export function Vending() {
  const [log, setLog] = useState<LogEntry[]>(seedLog);
  const sales = useMemo(() => seedSales(log.filter((l) => l.source === 'API')), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [rules, setRules] = useState<ValidationRules>(DEFAULT_RULES);
  const [filter, setFilter] = useState<'All' | 'Approved' | 'Declined'>('All');
  const [health, setHealth] = useState<'checking' | 'configured' | 'unconfigured' | 'unreachable'>('checking');

  useEffect(() => {
    let live = true;
    fetch(ENDPOINT)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => live && setHealth(j.configured ? 'configured' : 'unconfigured'))
      .catch(() => live && setHealth('unreachable'));
    return () => { live = false; };
  }, []);

  const shown = log.filter((l) => filter === 'All' || (filter === 'Approved') === (l.res.result === 'APPROVED'));
  const approvedN = log.filter((l) => l.res.result === 'APPROVED').length;
  const addLog = (e: LogEntry) => setLog((l) => [e, ...l]);

  return (
    <div>
      <div className="grid g-stats" style={{ marginBottom: 14 }}>
        <StatCard label="Meter checks today" value={N(18388 + log.length)} sub="from the vending system" />
        <StatCard label="Approved today" value="97.1%" sub={`${log.length - approvedN} of the last ${log.length} declined`} />
        <StatCard label="Median response" value="41 ms" sub="p95 84 ms · SLA 300 ms" />
        <StatCard label="Unmatched sales" value={String(sales.filter((s) => s.status === 'Unmatched').length)} sub="token sold without a validation" />
      </div>

      <div className="grid vending-top" style={{ marginBottom: 14 }}>
        <Console rules={rules} onResult={addLog} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <ApiCard health={health} />
          <RulesCard rules={rules} setRules={setRules} />
        </div>
      </div>

      <Card clip style={{ marginBottom: 14 }}>
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <span className="card-title" style={{ marginRight: 4 }}>Validation log</span>
          {(['All', 'Approved', 'Declined'] as const).map((f) => (
            <button key={f} type="button" className={`chip${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>
          ))}
          <span className="flex1" />
          <button type="button" className="link" style={{ fontSize: 11.5 }} onClick={() => {
            downloadCsv('vending-validations', ['ID', 'Time', 'Source', 'Vendor', 'Meter', 'Amount', 'Result', 'Code', 'Message'],
              shown.map((l) => [l.id, l.t, l.source, l.vendor, l.meter, l.amount ?? '', l.res.result, l.res.code, l.res.message]));
            toast(`Exported ${shown.length} validations`);
          }}>Export CSV</button>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <TableHead cols={[{ label: 'Request' }, { label: 'Time' }, { label: 'Vendor' }, { label: 'Meter' }, { label: 'Account' }, { label: 'Amount', align: 'right' }, { label: 'Outcome' }, { label: 'Result', align: 'right' }]} />
            <tbody>
              {shown.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.id}{l.source === 'Console' && <span className="sub"> · test</span>}</td>
                  <td className="mono" style={{ color: 'var(--muted)' }}>{l.t}</td>
                  <td>{l.vendor}</td>
                  <td className="mono" style={{ color: 'var(--navy)' }}>{l.meter}</td>
                  <td>{l.res.account?.clientName ?? <span className="sub">—</span>}</td>
                  <td className="mono num">{l.amount ? P(l.amount) : '—'}</td>
                  <td style={{ color: l.res.result === 'APPROVED' ? 'var(--ink-4)' : 'var(--bad)' }}>
                    {CODE_TEXT[l.res.code]}{l.res.warnings.length > 0 && <span className="sub"> · {l.res.warnings.length} warning{l.res.warnings.length > 1 ? 's' : ''}</span>}
                  </td>
                  <td className="num"><Badge status={l.res.result === 'APPROVED' ? 'Verified' : 'Failed'} label={l.res.result === 'APPROVED' ? 'Approved' : 'Declined'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid stack-md" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
        <Card clip>
          <div className="card-head">
            <span className="card-title flex1">Sales received from vending</span>
            <button type="button" className="link" style={{ fontSize: 11.5 }} onClick={() => {
              downloadCsv('vending-sales', ['Reference', 'Time', 'Vendor', 'Meter', 'Amount', 'Units', 'Validation', 'Status'], sales.map((s) => [s.ref, s.t, s.vendor, s.meter, s.amount, s.units, s.validation, s.status]));
              toast(`Exported ${sales.length} sales`);
            }}>Export CSV</button>
          </div>
          <div className="table-wrap">
            <table className="tbl nowrap">
              <TableHead cols={[{ label: 'Sale' }, { label: 'Meter' }, { label: 'Amount', align: 'right' }, { label: 'Units', align: 'right' }, { label: 'Token' }, { label: 'Validation' }, { label: '', align: 'right' }]} />
              <tbody>
                {sales.map((s) => (
                  <tr key={s.ref}>
                    <td style={{ whiteSpace: 'nowrap' }}><div className="mono">{s.ref}</div><div className="sub">{s.t} · {s.vendor}</div></td>
                    <td className="mono" style={{ color: 'var(--navy)' }}>{s.meter}</td>
                    <td className="mono num">{P(s.amount)}</td>
                    <td className="mono num" style={{ color: 'var(--teal)' }}>{s.units}</td>
                    <td className="mono" style={{ color: 'var(--muted)' }}>{s.token}</td>
                    <td className="mono">{s.validation}</td>
                    <td className="num"><Badge status={s.status === 'Matched' ? 'Verified' : 'Pending'} label={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sub" style={{ padding: '10px 16px', borderTop: '1px solid var(--line-2)' }}>
            The vending system posts each completed sale back with the validation ID it used. A sale without one is flagged for reconciliation.
          </div>
        </Card>
        <ContractCard />
      </div>
    </div>
  );
}

/* ---------- Test console ---------- */

function Console({ rules, onResult }: { rules: ValidationRules; onResult: (e: LogEntry) => void }) {
  const samples = useMemo(sampleMeters, []);
  const [meter, setMeter] = useState(samples[0]);
  const [purchaser, setPurchaser] = useState<'' | 'occupant' | 'owner'>('');
  const [amount, setAmount] = useState('100');
  const [res, setRes] = useState<ValidationResponse | null>(null);
  const [showJson, setShowJson] = useState(false);
  const amountN = Number(amount);
  const amountErr = amount !== '' && !(amountN > 0) ? 'Enter a positive amount.' : '';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (amountErr) return;
    const req: ValidationRequest = { meter, amount: amount ? amountN : undefined, purchaser: purchaser || undefined, vendorRef: 'console-' + Date.now().toString(36) };
    const out = validateMeter(req, rules);
    setRes(out);
    onResult({ id: 'VAL-' + (771243 + Math.floor(Math.random() * 900)), t: new Date().toISOString().slice(11, 19), vendor: 'Test console', meter: meter.toUpperCase(), amount: req.amount, res: out, source: 'Console' });
  };

  return (
    <Card style={{ padding: '16px 18px' }}>
      <div className="card-title" style={{ marginBottom: 4 }}>Validate a meter</div>
      <div className="sub" style={{ marginBottom: 14 }}>Runs the same rules the vending system gets from the API, using the rules set on this page.</div>
      <form onSubmit={submit} className="console-form" noValidate>
        <Field label="Meter number">
          <input className="mono" value={meter} onChange={(e) => setMeter(e.target.value)} list="sample-meters" placeholder="WM-104882" />
        </Field>
        <datalist id="sample-meters">{samples.concat(['WM-104273', 'WM-104455', 'WM-104028']).map((m) => <option key={m} value={m} />)}</datalist>
        <Field label="Purchaser">
          <select value={purchaser} onChange={(e) => setPurchaser(e.target.value as typeof purchaser)}>
            <option value="">Not specified</option><option value="occupant">Occupant (tenant)</option><option value="owner">Owner</option>
          </select>
        </Field>
        <Field label="Amount (P)" error={amountErr}>
          <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <button type="submit" className="btn-primary" style={{ alignSelf: 'end', height: 32, padding: '0 16px' }}>Validate</button>
      </form>
      <div className="sub" style={{ marginTop: 8 }}>
        Try: {['WM-104000', 'WM-104273', 'WM-104455', 'WM-104028', 'WM-999999'].map((m, i) => (
          <span key={m}>{i > 0 && ' · '}<button type="button" className="link mono" style={{ fontSize: 11 }} onClick={() => setMeter(m)}>{m}</button></span>
        ))}
      </div>

      {res && (
        <div className={`verdict ${res.result === 'APPROVED' ? 'ok' : 'bad'}`} role="status">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="verdict-badge">{res.result === 'APPROVED' ? 'Approved' : 'Declined'}</span>
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>{res.code}</span>
            <span className="flex1" />
            <button type="button" className="link" style={{ fontSize: 11.5 }} onClick={() => setShowJson((v) => !v)}>{showJson ? 'Hide' : 'Show'} JSON</button>
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }}>{res.message}</div>
          {res.warnings.map((w) => <div key={w} className="verdict-warn">⚠ {w}</div>)}
          {res.account && (
            <div className="verdict-grid">
              <div><span>Account</span><b>{res.account.clientName}</b><em className="mono">{res.account.clientId}</em></div>
              <div><span>Owner / occupant</span><b>{res.account.owner}</b><em>{res.account.occupant}</em></div>
              <div><span>May buy</span><b style={{ textTransform: 'capitalize' }}>{res.account.vendingParty}</b><em>KYC {res.account.kyc.toLowerCase()}</em></div>
              <div><span>Meter</span><b className={res.meter?.status === 'online' ? 'txt-ok' : 'txt-bad'}>{res.meter?.status}</b><em>last seen {res.meter?.lastSeen}</em></div>
              {res.sts && <div><span>STS</span><b className="mono">SGC {res.sts.supplyGroupCode}</b><em className="mono">KRN {res.sts.keyRevision} · TI {res.sts.tariffIndex} · {res.sts.algorithm}</em></div>}
              {res.tariff && <div><span>Tariff</span><b>{res.tariff.name}</b><em className="mono">P {res.tariff.ratePerKl}/kL + {Math.round(res.tariff.vatRate * 100)}% VAT</em></div>}
            </div>
          )}
          {showJson && <pre className="code">{JSON.stringify(res, null, 2)}</pre>}
        </div>
      )}
    </Card>
  );
}

/* ---------- API & rules ---------- */

function ApiCard({ health }: { health: 'checking' | 'configured' | 'unconfigured' | 'unreachable' }) {
  const state = {
    checking: ['Checking…', 'Pending', ''],
    configured: ['Live', 'Verified', 'API key set; the vending system can call the endpoint.'],
    unconfigured: ['Needs API key', 'Pending', 'Set VENDING_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy. Until then every call returns 503.'],
    unreachable: ['Not reachable here', 'Suspended', 'The endpoint runs on Vercel; it is not available in a local preview.'],
  }[health];
  const url = typeof window !== 'undefined' ? window.location.origin + ENDPOINT : ENDPOINT;
  return (
    <Card style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className="card-title flex1">Validation API</span>
        <Badge status={state[1]} label={state[0]} />
      </div>
      <div className="code-line"><span className="mono" style={{ color: 'var(--navy)', fontWeight: 600 }}>POST</span> <span className="mono">{url}</span></div>
      <button type="button" className="link" style={{ fontSize: 11.5, marginTop: 6 }} onClick={() => { navigator.clipboard?.writeText(url).then(() => toast('Endpoint URL copied'), () => toast('Copy failed', 'warn')); }}>Copy URL</button>
      <div className="kv" style={{ marginTop: 8 }}>
        <div><span>Auth</span><span className="mono">Authorization: Bearer &lt;key&gt;</span></div>
        <div><span>Format</span><span>JSON in, JSON out</span></div>
        <div><span>Health</span><span className="mono">GET {ENDPOINT}</span></div>
      </div>
      {state[2] && <div className="sub" style={{ marginTop: 10, lineHeight: 1.5 }}>{state[2]}</div>}
    </Card>
  );
}

function RulesCard({ rules, setRules }: { rules: ValidationRules; setRules: (r: ValidationRules) => void }) {
  const rows: [keyof ValidationRules, string, string][] = [
    ['blockSuspended', 'Block suspended accounts', 'ACCOUNT_SUSPENDED'],
    ['blockKycIncomplete', 'Block when KYC is not verified', 'KYC_INCOMPLETE'],
    ['blockTamper', 'Block meters with an active tamper alarm', 'TAMPER_HOLD'],
  ];
  return (
    <Card style={{ padding: '16px 18px' }}>
      <div className="card-title" style={{ marginBottom: 10 }}>Validation rules</div>
      {rows.map(([k, label, code]) => (
        <div key={k} className="rule-row">
          <div className="flex1"><div style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</div><div className="mono sub">{code}</div></div>
          <Switch on={rules[k] as boolean} label={label} onClick={() => setRules({ ...rules, [k]: !rules[k] })} />
        </div>
      ))}
      <div className="rule-row">
        <div className="flex1"><div style={{ fontSize: 12.5, fontWeight: 500 }}>Warn when meter offline for</div><div className="sub">Approved, with a warning to key the token in</div></div>
        <select className="inline-select" value={rules.offlineWarnDays} onChange={(e) => setRules({ ...rules, offlineWarnDays: Number(e.target.value) })} aria-label="Offline warning threshold">
          {[1, 2, 3, 7].map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
        </select>
      </div>
      <div className="sub" style={{ marginTop: 10, lineHeight: 1.5 }}>Changes apply to the test console. The live API uses the defaults until rules are stored server-side.</div>
    </Card>
  );
}

function ContractCard() {
  const example = useMemo(() => validateMeter({ meter: 'WM-104091', purchaser: 'occupant', amount: 100, vendorRef: 'OM-88213' }), []);
  const [tab, setTab] = useState<'Request' | 'Response' | 'Errors'>('Request');
  const body = {
    Request: `POST /api/vending/validate
Authorization: Bearer <VENDING_API_KEY>
Content-Type: application/json

{
  "meter": "WM-104091",
  "purchaser": "occupant",   // optional: occupant | owner
  "amount": 100,             // optional, Pula incl. VAT
  "vendorRef": "OM-88213"    // optional, echoed back
}`,
    Response: JSON.stringify(example, null, 2),
    Errors: `200  result "DECLINED" with a code:
     INVALID_FORMAT · METER_NOT_FOUND · ACCOUNT_SUSPENDED
     KYC_INCOMPLETE · TAMPER_HOLD · VENDING_NOT_PERMITTED
     PURCHASER_NOT_PERMITTED
400  bad_request   – body is not JSON or a field is invalid
401  unauthorised  – missing or wrong API key
503  not_configured – VENDING_API_KEY not set on the server

Only issue an STS token when result is "APPROVED".
Show "warnings" to the cashier/customer.`,
  }[tab];
  return (
    <Card clip>
      <div className="card-head">
        <span className="card-title flex1">API contract</span>
        <div className="segmented" role="tablist">
          {(['Request', 'Response', 'Errors'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={tab === t ? { background: 'var(--navy)', color: '#fff', fontWeight: 600 } : undefined}>{t}</button>
          ))}
        </div>
      </div>
      <pre className="code" style={{ margin: 0, borderRadius: 0, maxHeight: 360 }}>{body}</pre>
    </Card>
  );
}
