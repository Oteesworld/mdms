import { useState, type CSSProperties, type FormEvent } from 'react';
import { goTo } from '../routes';
import { Card, StatCard } from '../components/ui';
import { Field, Modal, toast } from '../components/overlay';
import { ClientProfile } from './ClientProfile';
import { SUBS_SHORT, TABLES, type Cell, type KycProfile, type Property, type TableScreen } from '../data/clients';
import { addProperty, assignTenant, METER_ID, useClientProps } from '../data/store';
import { meterIndex } from '../data/meters';
import { downloadCsv, slug } from '../lib/csv';

const CELL_FONT: Record<Cell['kind'], string> = {
  text: "400 12.5px 'Public Sans',sans-serif",
  bold: "600 12.5px 'Public Sans',sans-serif",
  mono: "500 12px 'IBM Plex Mono',monospace",
  badge: "600 11px 'Public Sans',sans-serif",
};

const PAGE_SIZE = 8;

type Get = (column: string) => string;
const is = (col: string, ...vals: string[]) => (g: Get) => vals.includes(g(col));
const not = (col: string, val: string) => (g: Get) => g(col) !== val;
const has = (col: string, part: string) => (g: Get) => g(col).includes(part);
const pct = (col: string) => (g: Get) => parseFloat(g(col));

/** One predicate per filter chip, in the same order as the chips in TABLES. */
const CHIP_FILTERS: Record<TableScreen, ((g: Get) => boolean)[]> = {
  domestic: [() => true, is('Status', 'Active'), is('Status', 'Arrears'), not('KYC', 'Verified'), is('Status', 'Suspended')],
  business: [() => true, is('Terms', 'Prepaid'), is('Terms', '30 days'), not('KYC', 'Verified')],
  gov: [() => true, has('Ministry', 'Health'), has('Ministry', 'Education'), is('Ministry', 'Local Government'), is('Status', 'Pending')],
  meters: [() => true, is('Status', 'Online'), is('Status', 'Offline'), is('Status', 'Low batt'), is('Serial', 'WM-104637', 'WM-105001')],
  bulk: [() => true, (g) => pct('Loss')(g) > 12, (g) => pct('Loss')(g) <= 12, is('Status', 'Pending')],
  sites: [() => true, is('Gateways', '1'), is('Status', 'Arrears'), is('Status', 'Pending')],
  gateways: [() => true, is('State', 'Online'), is('State', 'Degraded'), is('State', 'Offline')],
};

/** Register screens: clients, meters, bulk meters, sites and gateways. */
/** Index of a valid client profile in the route (`#/domestic/3`), or null. */
export function profileIndex(screen: string, param?: string): number | null {
  const cfg = TABLES[screen as TableScreen];
  const i = param !== undefined ? Number(param) : NaN;
  return cfg?.kyc && Number.isInteger(i) && i >= 0 && i < cfg.rows().length ? i : null;
}

export function Register({ screen, profile }: { screen: TableScreen; profile?: string }) {
  const idx = profileIndex(screen, profile);
  return idx !== null ? <ClientProfile screen={screen} index={idx} /> : <RegisterTable screen={screen} />;
}

function RegisterTable({ screen }: { screen: TableScreen }) {
  const cfg = TABLES[screen];
  const rows = cfg.rows();
  const [chip, setChip] = useState(0);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const kyc = cfg.kyc && sel !== null ? cfg.kyc(sel) : null;

  const getter = (cells: Cell[]): Get => (col) => cells[cfg.head.findIndex((h) => h[0] === col)]?.v ?? '';
  const filtered = rows.map((cells, i) => ({ cells, i })).filter(({ cells }) => CHIP_FILTERS[screen][chip](getter(cells)));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const shown = filtered.slice(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE);

  const exportCsv = () => {
    downloadCsv(slug(cfg.name + ' ' + cfg.chips[chip]), cfg.head.map((h) => h[0]), filtered.map(({ cells }) => cells.map((c) => c.v)));
    toast(`Exported ${filtered.length} rows to CSV`);
  };

  return (
    <div>
      <div className="grid g-stats" style={{ marginBottom: 14 }}>
        {cfg.stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <div className={`grid${kyc ? ' register-split' : ''}`} style={{ alignItems: 'start' }}>
        <Card clip style={{ minWidth: 0 }}>
          <div className="card-head" style={{ flexWrap: 'wrap' }}>
            <span className="card-title" style={{ marginRight: 4 }}>{cfg.name}</span>
            {cfg.chips.map((c, i) => (
              <button key={c} type="button" className={`chip${chip === i ? ' on' : ''}`} aria-pressed={chip === i} onClick={() => { setChip(i); setPage(0); }}>{c}</button>
            ))}
            <span className="flex1" />
            <span className="sub">{cfg.count}</span>
            <button type="button" className="link" style={{ fontSize: 11.5 }} onClick={exportCsv}>Export CSV</button>
          </div>
          <div className="table-wrap">
            <table className="tbl dense">
              <thead>
                <tr>{cfg.head.map(([label, align]) => <th key={label} style={{ textAlign: align ?? 'left' }}>{label}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map(({ cells, i }) => (
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
                {!shown.length && (
                  <tr><td colSpan={cfg.head.length} className="sub" style={{ padding: 28, textAlign: 'center' }}>Nothing matches “{cfg.chips[chip]}”.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="sub flex1">
              {filtered.length ? `Showing ${pg * PAGE_SIZE + 1}–${pg * PAGE_SIZE + shown.length} of ${filtered.length} in this sample` : 'No rows'}
            </span>
            <button type="button" disabled={pg === 0} onClick={() => setPage(pg - 1)} aria-label="Previous page">‹</button>
            {Array.from({ length: pages }, (_, p) => (
              <button key={p} type="button" className={p === pg ? 'on' : ''} aria-current={p === pg ? 'page' : undefined} onClick={() => setPage(p)}>{p + 1}</button>
            ))}
            <button type="button" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label="Next page">›</button>
          </div>
        </Card>
        {kyc && sel !== null && <KycPanel k={kyc} onClose={() => setSel(null)} onOpen={() => goTo(screen, sel)} />}
      </div>
    </div>
  );
}

function CellView({ c }: { c: Cell }) {
  const style: CSSProperties = { font: CELL_FONT[c.kind], color: c.color };
  if (c.kind === 'badge') Object.assign(style, { background: c.bg, padding: '3px 9px', borderRadius: 999, display: 'inline-block' });
  return <span style={style}>{c.v}</span>;
}

function KycPanel({ k, onClose, onOpen }: { k: KycProfile; onClose: () => void; onOpen: () => void }) {
  const props = useClientProps(k.id, k.props);
  const [dialog, setDialog] = useState<'add' | 'assign' | null>(null);
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
          <span className="mono" style={{ fontWeight: 600, fontSize: 11.5, color: tone }}>{k.pct}%</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {k.docs.map((d) => (
            <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: d.ok ? '#2E9D5B' : '#D99A2B', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, flex: 'none' }}>{d.ok ? '✓' : '!'}</span>
              <span className="flex1" style={{ color: 'var(--ink-4)' }}>{d.label}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{d.ok ? 'verified' : 'missing'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="kyc-section">
        <div className="label" style={{ marginBottom: 8 }}>Account</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {k.fields.map((f) => (
            <div key={f.k}>
              <div style={{ fontSize: 10.5, color: 'var(--faint)', marginBottom: 2 }}>{f.k}</div>
              <div className="mono" style={{ fontSize: 11, color: f.tone ?? 'var(--ink)' }}>{f.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="kyc-section">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8 }}>
          <span className="label flex1">Properties & meters</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{props.length > k.props.length ? `${k.propCount} + ${props.length - k.props.length} new` : k.propCount}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {props.map((p) => (
            <div key={p.meter} style={{ border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 9px', background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--navy)' }}>{p.meter}</span>
                <span className="ellipsis flex1" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{p.plot}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className="ellipsis flex1" style={{ fontSize: 11.5, color: 'var(--ink)', fontWeight: 500 }}>{p.tenant}</span>
                <span style={{ fontWeight: 600, fontSize: 11, color: p.tone, background: '#fff', border: '1px solid var(--line)', padding: '1px 5px', borderRadius: 3 }}>{p.vends}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{p.bal}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 9 }}>
          <button type="button" className="link" style={{ fontSize: 11 }} onClick={() => setDialog('add')}>+ Add property</button>
          <button type="button" className="link" style={{ fontSize: 11 }} onClick={() => setDialog('assign')}>Assign tenant</button>
        </div>
      </div>

      <div className="kyc-section" style={{ borderBottom: 0 }}>
        <div className="label" style={{ marginBottom: 8 }}>Recent purchases</div>
        {k.purchases.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--line-3)', fontSize: 11 }}>
            <span className="flex1" style={{ color: 'var(--ink-4)' }}>{p.date}</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{p.channel}</span>
            <span className="mono" style={{ fontWeight: 600, fontSize: 11 }}>{p.amount}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 7, marginTop: 11 }}>
          <button type="button" className="btn-primary flex1" style={{ padding: 7, fontSize: 11, textAlign: 'center' }} onClick={onOpen}>Open full profile</button>
          <button type="button" className="btn" style={{ fontSize: 11, padding: '6px 11px' }} onClick={() => goTo('meters')}>Meter register</button>
        </div>
      </div>
      {dialog === 'add' && <AddPropertyDialog k={k} onClose={() => setDialog(null)} />}
      {dialog === 'assign' && <AssignTenantDialog k={k} props={props} onClose={() => setDialog(null)} />}
    </Card>
  );
}

/* ---------- Property dialogs ---------- */

function AddPropertyDialog({ k, onClose }: { k: KycProfile; onClose: () => void }) {
  const [plot, setPlot] = useState('');
  const [suburb, setSuburb] = useState(SUBS_SHORT[0]);
  const [meter, setMeter] = useState('');
  const [occupancy, setOccupancy] = useState<'owner' | 'let' | 'vacant'>('let');
  const [tenant, setTenant] = useState('');
  const [touched, setTouched] = useState(false);
  const serial = meter.trim().toUpperCase();
  const errors = {
    plot: !plot.trim() && 'Enter the plot or unit number.',
    meter: !METER_ID.test(serial) ? 'Use WM- followed by six digits.' : meterIndex().has(serial) ? 'This meter is already assigned to a property.' : '',
    tenant: occupancy === 'let' && !tenant.trim() && 'Enter the tenant’s name.',
  };
  const ok = !errors.plot && !errors.meter && !errors.tenant;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!ok) return;
    const p: Property = {
      plot: plot.trim() + ', ' + suburb, meter: serial,
      tenant: occupancy === 'let' ? tenant.trim() : occupancy === 'vacant' ? 'Vacant' : 'Owner-occupied',
      vends: occupancy === 'let' ? 'Tenant vends' : occupancy === 'vacant' ? 'No vending' : 'Owner vends',
      bal: 'P 0.00', tone: occupancy === 'vacant' ? '#A1A8B2' : '#00468C',
    };
    addProperty(k.id, p);
    toast(`Property ${p.plot} added to ${k.name}`);
    onClose();
  };
  return (
    <Modal title={`Add property · ${k.name}`} onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" form="add-prop" className="btn-primary">Add property</button>
    </>}>
      <form id="add-prop" onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <div className="form-row">
          <Field label="Plot / unit" error={touched && errors.plot}><input value={plot} onChange={(e) => setPlot(e.target.value)} placeholder="Plot 22918" /></Field>
          <Field label="Suburb"><select value={suburb} onChange={(e) => setSuburb(e.target.value)}>{SUBS_SHORT.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div>
        <Field label="Meter serial" error={touched && errors.meter} hint="The meter must already be commissioned."><input className="mono" value={meter} onChange={(e) => setMeter(e.target.value)} placeholder="WM-120455" /></Field>
        <Field label="Occupancy">
          <select value={occupancy} onChange={(e) => setOccupancy(e.target.value as typeof occupancy)}>
            <option value="let">Let to a tenant (tenant vends)</option>
            <option value="owner">Owner-occupied (owner vends)</option>
            <option value="vacant">Vacant (no vending)</option>
          </select>
        </Field>
        {occupancy === 'let' && <Field label="Tenant name" error={touched && errors.tenant}><input value={tenant} onChange={(e) => setTenant(e.target.value)} /></Field>}
      </form>
    </Modal>
  );
}

function AssignTenantDialog({ k, props, onClose }: { k: KycProfile; props: Property[]; onClose: () => void }) {
  const [meter, setMeter] = useState(props.find((p) => /^Vacant/.test(p.tenant))?.meter ?? props[0]?.meter ?? '');
  const [name, setName] = useState('');
  const [omang, setOmang] = useState('');
  const [vends, setVends] = useState('Tenant vends');
  const [touched, setTouched] = useState(false);
  const errors = {
    name: !name.trim() && 'Enter the tenant’s full name.',
    omang: !/^\d{9}$/.test(omang.trim()) && 'Omang number is 9 digits.',
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (errors.name || errors.omang) return;
    assignTenant(meter, name.trim(), vends);
    toast(`${name.trim()} assigned to ${meter}`);
    onClose();
  };
  return (
    <Modal title="Assign tenant" onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" form="assign" className="btn-primary">Assign tenant</button>
    </>}>
      <form id="assign" onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <Field label="Property">
          <select value={meter} onChange={(e) => setMeter(e.target.value)}>
            {props.map((p) => <option key={p.meter} value={p.meter}>{p.meter} · {p.plot} · {p.tenant}</option>)}
          </select>
        </Field>
        <div className="form-row">
          <Field label="Tenant name" error={touched && errors.name}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Omang number" error={touched && errors.omang}><input className="mono" inputMode="numeric" value={omang} onChange={(e) => setOmang(e.target.value)} placeholder="123456789" /></Field>
        </div>
        <Field label="Who buys water" hint={`Ownership stays with ${k.name}; credit stays on the meter.`}>
          <select value={vends} onChange={(e) => setVends(e.target.value)}>
            <option>Tenant vends</option><option>Owner vends</option>
          </select>
        </Field>
      </form>
    </Modal>
  );
}
