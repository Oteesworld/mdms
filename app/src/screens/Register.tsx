import { useState, type CSSProperties } from 'react';
import { Card, StatCard } from '../components/ui';
import { TABLES, type Cell, type KycProfile, type TableScreen } from '../data/clients';

const CELL_FONT: Record<Cell['kind'], string> = {
  text: "400 11.5px 'Public Sans',sans-serif",
  bold: "600 11.5px 'Public Sans',sans-serif",
  mono: "500 11px 'IBM Plex Mono',monospace",
  badge: "600 9.5px 'IBM Plex Mono',monospace",
};

const PAGER = ['‹', '1', '2', '3', '…', '›'];

/** Register screens: clients, meters, bulk meters, sites and gateways. */
export function Register({ screen }: { screen: TableScreen }) {
  const cfg = TABLES[screen];
  const rows = cfg.rows();
  const [chip, setChip] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const kyc = cfg.kyc && sel !== null ? cfg.kyc(sel) : null;

  return (
    <div>
      <div className="grid g-stats" style={{ marginBottom: 12 }}>
        {cfg.stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <div className={`grid${kyc ? ' register-split' : ''}`} style={{ alignItems: 'start' }}>
        <Card clip style={{ minWidth: 0 }}>
          <div className="card-head" style={{ padding: '9px 13px', gap: 7, flexWrap: 'wrap' }}>
            <span className="card-title" style={{ marginRight: 4 }}>{cfg.name}</span>
            {cfg.chips.map((c, i) => (
              <button key={c} type="button" className={`chip${chip === i ? ' on' : ''}`} aria-pressed={chip === i} onClick={() => setChip(i)}>{c}</button>
            ))}
            <span className="flex1" />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{cfg.count}</span>
            <button type="button" className="link" style={{ fontSize: 11, fontWeight: 500 }}>Export CSV</button>
          </div>
          <div className="table-wrap">
            <table className="tbl dense">
              <thead>
                <tr>{cfg.head.map(([label, align]) => <th key={label} style={{ textAlign: align ?? 'left' }}>{label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((cells, i) => (
                  <tr
                    key={i}
                    className={cfg.kyc ? 'clickable' : undefined}
                    style={{ background: sel === i ? '#F3F7FC' : undefined }}
                    onClick={cfg.kyc ? () => setSel(i) : undefined}
                  >
                    {cells.map((c, j) => (
                      <td key={j} style={{ textAlign: c.align ?? 'left', whiteSpace: 'nowrap' }}>
                        <CellView c={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '9px 13px', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--line-2)' }}>
            <span className="sub flex1">{cfg.pageInfo}</span>
            {PAGER.map((p) => (
              <button key={p} type="button" className="mono"
                style={{ fontSize: 10.5, padding: '3px 8px', borderRadius: 4, background: p === '1' ? 'var(--navy)' : 'var(--line-3)', color: p === '1' ? '#fff' : 'var(--ink-4)' }}>
                {p}
              </button>
            ))}
          </div>
        </Card>
        {kyc && <KycPanel k={kyc} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}

function CellView({ c }: { c: Cell }) {
  const style: CSSProperties = { font: CELL_FONT[c.kind], color: c.color };
  if (c.kind === 'badge') Object.assign(style, { background: c.bg, padding: '2px 7px', borderRadius: 4 });
  return <span style={style}>{c.v}</span>;
}

function KycPanel({ k, onClose }: { k: KycProfile; onClose: () => void }) {
  const tone = k.pct === 100 ? '#2E9D5B' : '#D99A2B';
  return (
    <Card clip className="kyc-panel">
      <div className="kyc-section" style={{ padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div className="mono" style={{ width: 34, height: 34, flex: 'none', borderRadius: 7, background: 'var(--navy-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12, color: 'var(--navy)' }}>{k.initials}</div>
        <div className="flex1" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-.1px' }}>{k.name}</div>
          <div className="meta">{k.id} · {k.kind}</div>
        </div>
        <button type="button" aria-label="Close profile" onClick={onClose} style={{ fontSize: 11, color: 'var(--muted)' }}>✕</button>
      </div>

      <div className="kyc-section">
        <div className="label" style={{ marginBottom: 8 }}>KYC Verification</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div className="bar-track flex1" style={{ height: 5, borderRadius: 5 }}><div className="bar-fill" style={{ background: tone, width: k.pct + '%' }} /></div>
          <span className="mono" style={{ fontWeight: 600, fontSize: 10.5, color: tone }}>{k.pct}%</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {k.docs.map((d) => (
            <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: d.ok ? '#2E9D5B' : '#D99A2B', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, flex: 'none' }}>{d.ok ? '✓' : '!'}</span>
              <span className="flex1" style={{ color: 'var(--ink-4)' }}>{d.label}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{d.ok ? 'verified' : 'missing'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="kyc-section">
        <div className="label" style={{ marginBottom: 8 }}>Account</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {k.fields.map((f) => (
            <div key={f.k}>
              <div style={{ fontSize: 9.5, color: 'var(--faint)', marginBottom: 2 }}>{f.k}</div>
              <div className="mono" style={{ fontSize: 11, color: f.tone ?? 'var(--ink)' }}>{f.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="kyc-section">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8 }}>
          <span className="label flex1">Properties & meters</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{k.propCount}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {k.props.map((p) => (
            <div key={p.meter} style={{ border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 9px', background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--navy)' }}>{p.meter}</span>
                <span className="ellipsis flex1" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{p.plot}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className="ellipsis flex1" style={{ fontSize: 10.5, color: 'var(--ink)', fontWeight: 500 }}>{p.tenant}</span>
                <span style={{ fontWeight: 600, fontSize: 11, color: p.tone, background: '#fff', border: '1px solid var(--line)', padding: '1px 5px', borderRadius: 3 }}>{p.vends}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{p.bal}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 9 }}>
          <button type="button" className="link" style={{ fontSize: 10.5 }}>+ Add property</button>
          <button type="button" className="link" style={{ fontSize: 10.5 }}>Assign tenant</button>
        </div>
      </div>

      <div className="kyc-section" style={{ borderBottom: 0 }}>
        <div className="label" style={{ marginBottom: 8 }}>Recent purchases</div>
        {k.purchases.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--line-3)', fontSize: 11 }}>
            <span className="flex1" style={{ color: 'var(--ink-4)' }}>{p.date}</span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{p.channel}</span>
            <span className="mono" style={{ fontWeight: 600, fontSize: 11 }}>{p.amount}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 7, marginTop: 11 }}>
          <button type="button" className="btn-primary flex1" style={{ padding: 7, fontSize: 11, textAlign: 'center' }}>Open full profile</button>
          <button type="button" style={{ padding: '7px 11px', borderRadius: 6, border: '1px solid var(--line)', color: 'var(--ink-4)', fontSize: 11, fontWeight: 600 }}>Meters</button>
        </div>
      </div>
    </Card>
  );
}
