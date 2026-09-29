import { useState } from 'react';
import { Badge, Card, Switch, TableHead } from '../components/ui';
import { GENERATED, REPORTS, SCHEDULES } from '../data/admin';

const ACTION = { Ready: 'Download', Failed: 'Retry', Queued: 'Cancel' } as const;

export function Reports() {
  const [enabled, setEnabled] = useState(() => SCHEDULES.map((s) => s[3]));

  return (
    <div>
      <div className="grid g-stats" style={{ marginBottom: 16 }}>
        {REPORTS.map((r) => (
          <Card key={r.name} hover style={{ padding: '13px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span className="card-title">{r.name}</span>
            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, minHeight: 32 }}>{r.desc}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 8, borderTop: '1px solid var(--line-3)' }}>
              {r.formats.map((f) => (
                <span key={f} style={{ fontWeight: 500, fontSize: 11, color: 'var(--ink-4)', background: 'var(--line-3)', padding: '2px 6px', borderRadius: 3 }}>{f}</span>
              ))}
              <span className="flex1" />
              <button type="button" className="link" style={{ fontSize: 10.5 }}>Generate</button>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid stack-md" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <Card clip>
          <div className="card-head" style={{ padding: '11px 14px' }}><span className="card-title">Recently generated</span></div>
          <div className="table-wrap">
            <table className="tbl compact">
              <TableHead cols={[{ label: 'Report' }, { label: 'Range' }, { label: 'Requested by' }, { label: 'Status', align: 'right' }, { label: '', align: 'right' }]} />
              <tbody>
                {GENERATED.map(([name, range, by, status]) => (
                  <tr key={name}>
                    <td style={{ fontWeight: 500 }}>{name}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{range}</td>
                    <td className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{by}</td>
                    <td className="num"><Badge status={status} /></td>
                    <td className="num" style={{ fontSize: 11 }}><button type="button" className="link">{ACTION[status]}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card clip>
          <div className="card-head" style={{ padding: '11px 14px' }}>
            <span className="card-title flex1">Scheduled</span>
            <button type="button" className="link" style={{ fontSize: 11 }}>+ New schedule</button>
          </div>
          {SCHEDULES.map(([name, cron, to], i) => (
            <div key={name} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="flex1" style={{ fontSize: 11.5, fontWeight: 600 }}>{name}</span>
                <Switch on={enabled[i]} label={`${name} schedule`} onClick={() => setEnabled((e) => e.map((v, j) => (j === i ? !v : v)))} />
              </div>
              <div className="mono" style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--muted)', marginTop: 3 }}>{cron} · {to}</div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
