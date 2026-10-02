import { useState } from 'react';
import { Badge, Card, StatCard, Switch, TableHead } from '../components/ui';
import { AUDIT_SEED, EXCEPTIONS, OPEN_EXCEPTIONS, RULES, type AuditEntry, type ExceptionStatus, type VeeException } from '../data/mdm';
import { N } from '../data/format';
import { addWorkOrder } from '../data/store';
import { currentHandle } from '../auth';

const FILTERS = ['Open', 'Estimated', 'Approved', 'Rejected', 'All'] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_BADGE: Record<ExceptionStatus, string> = { Open: 'Pending', Estimated: 'Queued', Approved: 'Verified', Rejected: 'Failed' };

const fmtL = (v: number | null) => (v === null ? 'missing' : N(v) + ' L');
/** The demo runs on a fixed clock (19 Aug 2026, 13:01), matching the top bar. */
const NOW = '13:01';

/** Validation, estimation and editing: rule hits, the exception queue and the audit trail. */
export function Vee() {
  const [items, setItems] = useState<VeeException[]>(EXCEPTIONS);
  const [filter, setFilter] = useState<Filter>('Open');
  const [selId, setSelId] = useState<string>(EXCEPTIONS[0].id);
  const [audit, setAudit] = useState<AuditEntry[]>(AUDIT_SEED);
  const [rules, setRules] = useState(() => RULES.map((r) => r.on));

  const shown = items.filter((x) => filter === 'All' || x.status === filter);
  const sel = items.find((x) => x.id === selId) ?? null;
  const resolved = items.filter((x) => x.status === 'Approved' || x.status === 'Rejected').length;
  const count = (s: ExceptionStatus) => items.filter((x) => x.status === s).length;

  const resolve = (x: VeeException, status: ExceptionStatus, value: number | null, reason: string) => {
    setItems((all) => all.map((y) => (y.id === x.id ? { ...y, status, estimate: value ?? y.estimate } : y)));
    let what = `${x.id} · ${x.meter} · ${fmtL(x.raw)} → ${fmtL(value)}`;
    if (status === 'Rejected') {
      const wo = addWorkOrder({
        type: x.rule === 'Continuous night flow' ? 'Leak investigation' : 'Meter inspection', target: x.meter, zone: x.zone,
        source: 'VEE · ' + x.rule.toLowerCase(), assignee: 'Unassigned', priority: 'Medium', due: '22 Aug',
      });
      what = `${x.id} · ${x.meter} · rejected → ${wo}`;
    }
    setAudit((a) => [{ t: NOW, who: currentHandle(), what, reason }, ...a]);
    const next = items.find((y) => y.id !== x.id && y.status === 'Open');
    if (next) setSelId(next.id);
  };

  return (
    <div>
      <div className="grid g-stats" style={{ marginBottom: 12 }}>
        <StatCard label="Open exceptions" value={N(OPEN_EXCEPTIONS - resolved)} sub="block billing for 1,102 accounts" />
        <StatCard label="Auto-estimated, awaiting approval" value={N(311 + count('Estimated'))} sub="approve in bulk or one by one" />
        <StatCard label="Resolved today" value={N(87 + resolved)} sub="accepted, edited or rejected" />
        <StatCard label="Rules active" value={`${rules.filter(Boolean).length} of ${RULES.length}`} sub="rule set v12 · edited 14 Aug" />
      </div>

      <div className="grid vee-split" style={{ alignItems: 'start', marginBottom: 16 }}>
        <Card clip style={{ minWidth: 0 }}>
          <div className="card-head" style={{ padding: '9px 13px', gap: 7, flexWrap: 'wrap' }}>
            <span className="card-title" style={{ marginRight: 4 }}>Exception queue</span>
            {FILTERS.map((f) => (
              <button key={f} type="button" className={`chip${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f}{f !== 'All' && ` · ${count(f)}`}
              </button>
            ))}
            <span className="flex1" />
            <span className="sub">showing 12 of {N(OPEN_EXCEPTIONS)}</span>
          </div>
          <div className="table-wrap">
            <table className="tbl dense">
              <TableHead cols={[{ label: 'Exception' }, { label: 'Meter' }, { label: 'Rule' }, { label: 'Interval' }, { label: 'Raw', align: 'right' }, { label: 'Estimate', align: 'right' }, { label: 'Status', align: 'right' }]} />
              <tbody>
                {shown.map((x) => (
                  <tr key={x.id} className="clickable" onClick={() => setSelId(x.id)} style={{ background: x.id === selId ? '#F3F7FC' : undefined }}>
                    <td className="mono">{x.id}</td>
                    <td><span className="mono" style={{ color: 'var(--navy)' }}>{x.meter}</span> <span className="sub">{x.zone}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{x.rule}</td>
                    <td className="mono" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{x.period}</td>
                    <td className="mono num" style={{ color: x.raw === null || x.raw < 0 || x.rule.includes('spike') ? 'var(--bad)' : 'var(--ink)' }}>{fmtL(x.raw)}</td>
                    <td className="mono num" style={{ color: 'var(--teal)' }}>{x.method.startsWith('No estimate') || x.method === 'Re-timestamp' ? '—' : fmtL(x.estimate)}</td>
                    <td className="num"><Badge status={STATUS_BADGE[x.status]} label={x.status} /></td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr><td colSpan={7} className="sub" style={{ padding: 24, textAlign: 'center' }}>Nothing {filter.toLowerCase()} in this sample.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {sel && <ExceptionPanel key={sel.id} x={sel} onResolve={resolve} />}
      </div>

      <div className="grid stack-md" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <Card clip>
          <div className="card-head" style={{ padding: '11px 14px' }}>
            <span className="card-title flex1">Rules</span>
            <span className="sub">hits in the last 24 h</span>
          </div>
          <div className="table-wrap">
            <table className="tbl compact">
              <TableHead cols={[{ label: 'Rule' }, { label: 'Type' }, { label: 'Threshold' }, { label: 'Hits', align: 'right' }, { label: 'On', align: 'right' }]} />
              <tbody>
                {RULES.map((r, i) => (
                  <tr key={r.name}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <div className="sub" style={{ whiteSpace: 'normal' }}>{r.desc}</div>
                    </td>
                    <td style={{ fontSize: 11, color: r.kind === 'Estimation' ? 'var(--teal)' : 'var(--navy)', fontWeight: 600 }}>{r.kind}</td>
                    <td className="mono" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.param}</td>
                    <td className="mono num" style={{ color: rules[i] ? 'var(--ink)' : 'var(--faint)' }}>{rules[i] ? N(r.hits) : '—'}</td>
                    <td className="num">
                      <Switch on={rules[i]} label={r.name} onClick={() => setRules((s) => s.map((v, j) => (j === i ? !v : v)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card clip>
          <div className="card-head" style={{ padding: '11px 14px' }}>
            <span className="card-title flex1">Audit trail</span>
            <span className="sub">append-only · kept indefinitely</span>
          </div>
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {audit.map((a, i) => (
              <div key={i} style={{ padding: '9px 14px', borderBottom: '1px solid var(--line-3)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{a.t}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--navy)' }}>{a.who}</span>
                  <span className="mono flex1" style={{ fontSize: 10.5 }}>{a.what}</span>
                </div>
                <div className="sub" style={{ marginTop: 3 }}>{a.reason}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}


function ExceptionPanel({ x, onResolve }: { x: VeeException; onResolve: (x: VeeException, s: ExceptionStatus, v: number | null, reason: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(x.estimate));
  const [reason, setReason] = useState('');
  const done = x.status === 'Approved' || x.status === 'Rejected';
  const canEstimate = !x.method.startsWith('No estimate');
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && reason.trim().length >= 5;

  const shown = x.profile.map((v) => Math.max(0, v));
  const max = Math.max(...shown, x.estimate, 1);

  return (
    <Card clip className="kyc-panel">
      <div className="kyc-section" style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div className="flex1">
          <div style={{ fontSize: 13, fontWeight: 600 }}>{x.rule}</div>
          <div className="meta">{x.id} · {x.meter} · {x.client}</div>
        </div>
        <Badge status={STATUS_BADGE[x.status]} label={x.status} />
      </div>

      <div className="kyc-section">
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 8 }}>
          <span className="label flex1">Hourly profile · {x.period.split(',')[0]}</span>
          <span className="meta">litres</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 96 }}>
          {shown.map((v, h) => {
            const flagged = h === x.flagged;
            return (
              <div key={h} title={`${String(h).padStart(2, '0')}:00 · ${flagged ? fmtL(x.raw) : N(v) + ' L'}`}
                style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', position: 'relative' }}>
                {flagged && canEstimate && (
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: (x.estimate / max) * 100 + '%', border: '1.5px dashed var(--teal)', borderRadius: '2px 2px 0 0' }} />
                )}
                <div style={{ height: (flagged && x.raw === null ? 0 : v / max) * 100 + '%', minHeight: flagged && x.raw === null ? 0 : 1, background: flagged ? '#B3261E' : '#97B8DC', borderRadius: '2px 2px 0 0' }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }} className="meta">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }} className="sub">
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#B3261E', borderRadius: 2, marginRight: 4 }} />flagged read</span>
          {canEstimate && <span><span style={{ display: 'inline-block', width: 8, height: 8, border: '1.5px dashed var(--teal)', borderRadius: 2, marginRight: 4 }} />proposed estimate</span>}
        </div>
      </div>

      <div className="kyc-section">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field k="Raw value" v={fmtL(x.raw)} tone={x.raw === null || x.raw < 0 ? '#B3261E' : undefined} />
          <Field k="Proposed" v={canEstimate ? fmtL(x.estimate) : '—'} tone="#2A7A7E" />
          <Field k="Method" v={x.method} />
          <Field k="Zone" v={x.zone} />
        </div>
      </div>

      <div className="kyc-section" style={{ borderBottom: 0 }}>
        {done ? (
          <div className="sub">Resolved — see the audit trail. Billing will use {x.status === 'Approved' ? fmtL(x.estimate) : 'no value until the work order closes'}.</div>
        ) : editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="form-field">
              <span>Corrected value (L)</span>
              <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            <label className="form-field">
              <span>Reason (required, kept in audit trail)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. confirmed on site visit" />
            </label>
            <div style={{ display: 'flex', gap: 7 }}>
              <button type="button" className="btn-primary flex1" disabled={!valid} style={{ padding: 7, opacity: valid ? 1 : 0.5 }}
                onClick={() => onResolve(x, 'Approved', parsed, reason.trim())}>Save edit</button>
              <button type="button" className="btn" style={{ fontSize: 11, padding: '6px 11px' }} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {canEstimate && (
              <button type="button" className="btn-primary flex1" style={{ padding: 7 }} onClick={() => onResolve(x, 'Approved', x.estimate, `Accepted ${x.method.toLowerCase()} estimate`)}>
                Accept estimate
              </button>
            )}
            <button type="button" className="btn" style={{ fontSize: 11, padding: '6px 11px' }} onClick={() => setEditing(true)}>Edit value</button>
            <button type="button" className="btn" style={{ fontSize: 11, padding: '6px 11px', color: 'var(--bad)', borderColor: '#F0C4C0' }}
              onClick={() => onResolve(x, 'Rejected', null, 'Rejected · sent for field inspection')}>
              Reject · raise work order
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Field({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: 'var(--faint)', marginBottom: 2 }}>{k}</div>
      <div className="mono" style={{ fontSize: 11, color: tone ?? 'var(--ink)' }}>{v}</div>
    </div>
  );
}
