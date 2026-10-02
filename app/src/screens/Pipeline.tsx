import { Fragment } from 'react';
import { Badge, Card, SectionRule, TableHead } from '../components/ui';
import { HOURLY, INTEGRATIONS, RETENTION, STAGES, ZONE_QUALITY, type Stage } from '../data/mdm';
import { N } from '../data/format';

const KPIS = [
  { label: 'Interval reads today', value: '1,165,122', sub: '96.3% of 1,209,888 expected' },
  { label: 'Passed validation', value: '97.8%', sub: '1,139,489 reads' },
  { label: 'Auto-estimated', value: '23,980', sub: '2.1% · rules v12' },
  { label: 'Open exceptions', value: '1,653', sub: 'need a person' },
  { label: 'Manual edits 24h', value: '87', sub: 'all audited' },
];

const STATE_COLOR: Record<Stage['state'], string> = { ok: '#2E9D5B', warn: '#D99A2B', bad: '#B3261E' };

/** The MDM cycle end to end: collect → store → validate → analyse → VEE → report → bill. */
export function Pipeline() {
  const hmax = 50;
  return (
    <div>
      <div className="grid g-5" style={{ marginBottom: 12 }}>
        {KPIS.map((k) => (
          <Card key={k.label} style={{ padding: '12px 13px' }}>
            <div className="label" style={{ marginBottom: 7 }}>{k.label}</div>
            <div className="kpi-value">{k.value}</div>
            <div className="sub" style={{ marginTop: 6 }}>{k.sub}</div>
          </Card>
        ))}
      </div>

      <SectionRule title="Data cycle · today" note="each stage feeds the next; bills close the cycle" />
      <Card style={{ padding: '14px 15px', marginBottom: 16 }}>
        <div className="cycle">
          {STAGES.map((s, i) => (
            <Fragment key={s.key}>
              {i > 0 && <span className="cycle-arrow" aria-hidden="true">›</span>}
              <a className="cycle-stage" href={s.screen ? '#/' + s.screen : undefined} style={{ borderTopColor: STATE_COLOR[s.state] }}>
                <span className="meta" style={{ fontSize: 10 }}>{i + 1} / {STAGES.length}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{s.name}</span>
                <span style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-.5px', color: 'var(--ink)' }}>{s.value}</span>
                <span className="sub">{s.sub}</span>
              </a>
            </Fragment>
          ))}
        </div>
        <div className="sub" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden="true">↺</span> Issued bills and token sales return to Collect as the next cycle’s opening balances.
        </div>
      </Card>

      <div className="grid stack-md" style={{ gridTemplateColumns: '1.3fr 1fr', marginBottom: 16 }}>
        <Card style={{ padding: '13px 15px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 11, flexWrap: 'wrap' }}>
            <div className="card-title flex1">Interval reads by hour · 19 Aug</div>
            <Legend color="#B8CFE8" label="received" />
            <Legend color="#00468C" label="passed validation" />
            <span className="meta">thousands</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 140 }}>
            {HOURLY.map((h) => (
              <div key={h.h} title={`${String(h.h).padStart(2, '0')}:00 · ${h.received}k received · ${h.passed}k passed`}
                style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4, height: '100%' }}>
                <div style={{ width: '100%', height: (h.received / hmax) * 100 + '%', background: '#B8CFE8', borderRadius: '2px 2px 0 0', display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ width: '100%', height: (h.passed / h.received) * 100 + '%', background: 'var(--navy)', borderRadius: '2px 2px 0 0' }} />
                </div>
                <span style={{ fontWeight: 500, fontSize: 10, color: 'var(--faint)' }}>{h.h % 3 === 0 ? String(h.h).padStart(2, '0') : ' '}</span>
              </div>
            ))}
          </div>
          <div className="sub" style={{ marginTop: 9 }}>The 03:00 dip lines up with the nightly gateway restart on GW-GAB-04; GW-GAB-06 has been offline since 09:32.</div>
        </Card>

        <Card clip>
          <div className="card-head" style={{ padding: '11px 14px' }}><span className="card-title">Data storage & retention</span></div>
          <div className="table-wrap">
            <table className="tbl compact">
              <TableHead cols={[{ label: 'Data' }, { label: 'Store' }, { label: 'Kept', align: 'right' }, { label: 'Size', align: 'right' }]} />
              <tbody>
                {RETENTION.map(([data, store, keep, size]) => (
                  <tr key={data}>
                    <td style={{ fontWeight: 500 }}>{data}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{store}</td>
                    <td className="num" style={{ fontSize: 11 }}>{keep}</td>
                    <td className="mono num">{size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sub" style={{ padding: '9px 14px', borderTop: '1px solid var(--line-2)' }}>Last verified backup 19 Aug 2026, 02:15 · restore test passed 12 Aug</div>
        </Card>
      </div>

      <div className="grid stack-md" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <Card clip>
          <div className="card-head" style={{ padding: '11px 14px' }}>
            <span className="card-title flex1">Data quality by zone · 24h</span>
            <a className="link" href="#/vee" style={{ fontSize: 11 }}>Open VEE queue</a>
          </div>
          <div className="table-wrap">
            <table className="tbl compact">
              <TableHead cols={[{ label: 'Zone' }, { label: 'Meters', align: 'right' }, { label: 'Completeness', align: 'right' }, { label: 'Valid', align: 'right' }, { label: 'Estimated', align: 'right' }, { label: 'Missing intervals', align: 'right' }]} />
              <tbody>
                {ZONE_QUALITY.map((z) => (
                  <tr key={z.zone}>
                    <td style={{ fontWeight: 500 }}>{z.zone}</td>
                    <td className="mono num">{N(z.meters)}</td>
                    <td className="num">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <span className="bar-track" style={{ width: 54, height: 5, borderRadius: 5 }}>
                          <span className="bar-fill" style={{ display: 'block', width: z.completeness + '%', background: z.completeness < 90 ? '#B3261E' : z.completeness < 96 ? '#D99A2B' : '#2E9D5B' }} />
                        </span>
                        <span className="mono" style={{ color: z.completeness < 90 ? 'var(--bad)' : 'var(--ink)' }}>{z.completeness}%</span>
                      </span>
                    </td>
                    <td className="mono num">{z.valid}%</td>
                    <td className="mono num" style={{ color: 'var(--muted)' }}>{z.estimated}%</td>
                    <td className="mono num" style={{ color: 'var(--muted)' }}>{N(z.gaps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card clip>
          <div className="card-head" style={{ padding: '11px 14px' }}><span className="card-title">Downstream integrations</span></div>
          {INTEGRATIONS.map(([name, target, last, status]) => (
            <div key={name} style={{ padding: '9px 14px', borderBottom: '1px solid var(--line-3)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="flex1" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600 }}>{name}</div>
                <div className="sub">→ {target} · {last}</div>
              </div>
              <Badge status={status} label={status === 'Ready' ? 'Synced' : status} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--muted)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />{label}
    </span>
  );
}
