import { useState } from 'react';
import { Badge, Card, StatCard, TableHead } from '../components/ui';
import { BILL_STEPS, INVOICES, PREVIOUS_RUNS, TARIFFS, VAT_RATE, type Invoice, type InvoiceStatus } from '../data/mdm';
import { N, P } from '../data/format';

const STATUS_BADGE: Record<InvoiceStatus, string> = { Draft: 'Suspended', Held: 'Pending', Issued: 'Online', Paid: 'Verified', Overdue: 'Arrears' };
const QUALITY_COLOR: Record<Invoice['readQuality'], string> = { Actual: 'var(--ink-4)', Estimated: 'var(--warn-ink)', Exception: 'var(--bad)' };

const ISSUE = BILL_STEPS.indexOf('Issue bills');

/** Postpaid bill run for credit-terms business and government accounts. */
export function Billing() {
  const [step, setStep] = useState(BILL_STEPS.indexOf('Review'));
  const [invoices, setInvoices] = useState(INVOICES);
  const finished = step >= BILL_STEPS.length;

  const totalExcl = invoices.reduce((a, x) => a + x.amountExcl, 0);
  const held = invoices.filter((x) => x.status === 'Held').length;

  const advance = () => {
    if (step === ISSUE) setInvoices((all) => all.map((x) => (x.status === 'Draft' ? { ...x, status: 'Issued' } : x)));
    setStep((s) => s + 1);
  };

  return (
    <div>
      <div className="grid g-stats" style={{ marginBottom: 12 }}>
        <StatCard label="Cycle" value="Jul 2026" sub="reads cut off 31 Jul, 23:59" />
        <StatCard label="Accounts in run" value="2,096" sub="1,884 business · 212 government votes" />
        <StatCard label="Billed, sample shown" value={P(totalExcl * (1 + VAT_RATE))} sub={`${P(totalExcl)} excl. VAT`} />
        <StatCard label="Held for read exceptions" value={String(held)} sub="released once VEE resolves them" />
      </div>

      <Card style={{ padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <span className="card-title flex1">Bill run · Jul 2026</span>
          {finished ? (
            <Badge status="Verified" label="Posted to ledger" />
          ) : (
            <button type="button" className="btn-primary" onClick={advance}>
              {step === ISSUE ? `Issue ${invoices.filter((x) => x.status === 'Draft').length} bills` : `Complete: ${BILL_STEPS[step]}`}
            </button>
          )}
        </div>
        <div className="steps" role="list">
          {BILL_STEPS.map((s, i) => (
            <div key={s} role="listitem" className={`step${i < step ? ' done' : i === step ? ' current' : ''}`} aria-current={i === step ? 'step' : undefined}>
              <span className="step-dot">{i < step ? '✓' : i + 1}</span>
              <span className="ellipsis">{s}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card clip style={{ marginBottom: 12 }}>
        <div className="card-head" style={{ padding: '11px 14px', flexWrap: 'wrap' }}>
          <span className="card-title flex1">Invoices</span>
          <span className="sub">Prepaid domestic meters are charged at the point of sale (token vending) and are not in this run.</span>
        </div>
        <div className="table-wrap">
          <table className="tbl compact">
            <TableHead cols={[
              { label: 'Invoice' }, { label: 'Account' }, { label: 'Name' }, { label: 'Consumption', align: 'right' }, { label: 'Excl. VAT', align: 'right' },
              { label: 'VAT 14%', align: 'right' }, { label: 'Total', align: 'right' }, { label: 'Reads' }, { label: 'Due' }, { label: 'Status', align: 'right' },
            ]} />
            <tbody>
              {invoices.map((x) => (
                <tr key={x.no}>
                  <td className="mono">{x.no}</td>
                  <td className="mono" style={{ color: 'var(--muted)' }}>{x.account}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><span style={{ fontWeight: 600 }}>{x.name}</span> <span className="sub">{x.kind}</span></td>
                  <td className="mono num" style={{ color: 'var(--teal)' }}>{N(x.kl)} kL</td>
                  <td className="mono num">{P(x.amountExcl)}</td>
                  <td className="mono num" style={{ color: 'var(--muted)' }}>{P(x.amountExcl * VAT_RATE)}</td>
                  <td className="mono num" style={{ fontWeight: 600 }}>{P(x.amountExcl * (1 + VAT_RATE))}</td>
                  <td style={{ fontSize: 11, color: QUALITY_COLOR[x.readQuality], whiteSpace: 'nowrap' }}>
                    {x.readQuality === 'Exception' ? <a href="#/vee" style={{ color: 'inherit', fontWeight: 600 }}>Exception · resolve</a> : x.readQuality}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{x.due}</td>
                  <td className="num"><Badge status={STATUS_BADGE[x.status]} label={x.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid stack-md" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
        <Card clip>
          <div className="card-head" style={{ padding: '11px 14px' }}>
            <span className="card-title flex1">Tariffs</span>
            <span className="sub">illustrative rates · VAT added at 14%</span>
          </div>
          <div className="table-wrap">
            <table className="tbl compact">
              <TableHead cols={[{ label: 'Band' }, { label: 'Applies to' }, { label: 'Rate', align: 'right' }, { label: 'Fixed / month', align: 'right' }]} />
              <tbody>
                {TARIFFS.map(([band, applies, rate, fixed]) => (
                  <tr key={band}>
                    <td style={{ fontWeight: 600 }}>{band}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{applies}</td>
                    <td className="mono num">{rate}</td>
                    <td className="mono num" style={{ color: 'var(--muted)' }}>{fixed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card clip>
          <div className="card-head" style={{ padding: '11px 14px' }}><span className="card-title">Previous runs</span></div>
          <div className="table-wrap">
            <table className="tbl compact roomy">
              <TableHead cols={[{ label: 'Cycle' }, { label: 'Accounts', align: 'right' }, { label: 'Billed', align: 'right' }, { label: 'Collected', align: 'right' }, { label: '', align: 'right' }]} />
              <tbody>
                {PREVIOUS_RUNS.map(([cycle, accounts, billed, collected, status]) => (
                  <tr key={cycle}>
                    <td style={{ fontWeight: 600 }}>{cycle}</td>
                    <td className="mono num">{accounts}</td>
                    <td className="mono num">{billed}</td>
                    <td className="mono num" style={{ color: parseFloat(collected) < 95 ? 'var(--warn-ink)' : 'var(--ink)' }}>{collected}</td>
                    <td className="num"><Badge status="Verified" label={status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

