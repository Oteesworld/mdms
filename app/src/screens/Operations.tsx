import { useState, type FormEvent } from 'react';
import { Badge, Card, StatCard, TableHead } from '../components/ui';
import { COMMANDS, TECHNICIANS, type CommandStatus, type CommandType, type WoStatus, type WorkOrder } from '../data/mdm';
import { N } from '../data/format';
import { METER_ID, queueCommand, updateWorkOrder, useStore } from '../data/store';

const TABS = ['Work orders', 'Remote commands'] as const;
type Tab = (typeof TABS)[number];

const WO_FILTERS = ['Open', 'New', 'Assigned', 'In progress', 'Done', 'All'] as const;
type WoFilter = (typeof WO_FILTERS)[number];

const WO_BADGE: Record<WoStatus, string> = { New: 'Pending', Assigned: 'Queued', 'In progress': 'Online', Done: 'Verified' };
const PRIORITY_COLOR: Record<WorkOrder['priority'], string> = { High: 'var(--bad)', Medium: 'var(--warn-ink)', Low: 'var(--muted)' };
const NEXT: Partial<Record<WoStatus, [WoStatus, string]>> = { Assigned: ['In progress', 'Start'], 'In progress': ['Done', 'Complete'] };

const CMD_BADGE: Record<CommandStatus, string> = { Queued: 'Pending', Sent: 'Queued', Acknowledged: 'Verified', Failed: 'Failed' };

/** Field work orders and LoRaWAN downlink commands. */
export function Operations() {
  const [tab, setTab] = useState<Tab>('Work orders');
  return (
    <div>
      <div style={{ display: 'flex', gap: 7, marginBottom: 12 }} role="tablist">
        {TABS.map((t) => {
          const on = t === tab;
          return (
            <button key={t} type="button" role="tab" aria-selected={on} onClick={() => setTab(t)}
              style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: on ? 600 : 500, background: on ? 'var(--navy)' : '#fff', color: on ? '#fff' : 'var(--ink-4)', border: `1px solid ${on ? 'var(--navy)' : 'var(--line)'}` }}>
              {t}
            </button>
          );
        })}
      </div>
      {tab === 'Work orders' ? <WorkOrders /> : <Commands />}
    </div>
  );
}

function WorkOrders() {
  const orders = useStore((s) => s.workOrders);
  const [filter, setFilter] = useState<WoFilter>('Open');
  const open = orders.filter((w) => w.status !== 'Done');
  const shown = orders.filter((w) => (filter === 'All' ? true : filter === 'Open' ? w.status !== 'Done' : w.status === filter));

  return (
    <>
      <div className="grid g-stats" style={{ marginBottom: 12 }}>
        <StatCard label="Open work orders" value={String(open.length)} sub={`${open.filter((w) => w.assignee === 'Unassigned').length} unassigned`} />
        <StatCard label="High priority" value={String(open.filter((w) => w.priority === 'High').length)} sub="burst, bypass, gateway" />
        <StatCard label="From VEE & alarms" value={String(open.filter((w) => /VEE|alarm|detector/i.test(w.source)).length)} sub="raised automatically" />
        <StatCard label="Completed" value={String(orders.filter((w) => w.status === 'Done').length)} sub="this week" />
      </div>

      <Card clip>
        <div className="card-head" style={{ padding: '9px 13px', gap: 7, flexWrap: 'wrap' }}>
          <span className="card-title" style={{ marginRight: 4 }}>Work orders</span>
          {WO_FILTERS.map((f) => (
            <button key={f} type="button" className={`chip${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <div className="table-wrap">
          <table className="tbl dense">
            <TableHead cols={[
              { label: 'Order' }, { label: 'Type' }, { label: 'Meter / asset' }, { label: 'Zone' }, { label: 'Raised by' },
              { label: 'Technician' }, { label: 'Priority' }, { label: 'Due' }, { label: 'Status', align: 'right' }, { label: '', align: 'right' },
            ]} />
            <tbody>
              {shown.map((w) => {
                const next = NEXT[w.status];
                return (
                  <tr key={w.id}>
                    <td className="mono">{w.id}</td>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{w.type}</td>
                    <td className="mono" style={{ color: 'var(--navy)' }}>{w.target}</td>
                    <td style={{ color: 'var(--muted)' }}>{w.zone}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{w.source}</td>
                    <td>
                      <select className="inline-select" aria-label={`Technician for ${w.id}`} value={w.assignee} disabled={w.status === 'Done'}
                        onChange={(e) => updateWorkOrder(w.id, { assignee: e.target.value, status: e.target.value === 'Unassigned' ? 'New' : w.status === 'New' ? 'Assigned' : w.status })}>
                        {TECHNICIANS.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td style={{ fontSize: 11, fontWeight: 600, color: PRIORITY_COLOR[w.priority] }}>{w.priority}</td>
                    <td className="mono" style={{ color: 'var(--muted)' }}>{w.due}</td>
                    <td className="num"><Badge status={WO_BADGE[w.status]} label={w.status} /></td>
                    <td className="num" style={{ fontSize: 11 }}>
                      {next && <button type="button" className="link" onClick={() => updateWorkOrder(w.id, { status: next[0] })}>{next[1]}</button>}
                    </td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={10} className="sub" style={{ padding: 24, textAlign: 'center' }}>No work orders here.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Commands() {
  const commands = useStore((s) => s.commands);
  const [meter, setMeter] = useState('');
  const [cmd, setCmd] = useState<CommandType>('On-demand read');
  const [touched, setTouched] = useState(false);
  const serial = meter.trim().toUpperCase();
  const valid = METER_ID.test(serial);
  const risky = cmd === 'Close valve';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    if (risky && !window.confirm(`Close the valve on ${serial}? The customer loses supply until it is reopened.`)) return;
    queueCommand(serial, cmd);
    setMeter('');
    setTouched(false);
  };

  const pending = commands.filter((c) => c.status === 'Queued' || c.status === 'Sent').length;

  return (
    <>
      <div className="grid g-stats" style={{ marginBottom: 12 }}>
        <StatCard label="Downlink queue" value={String(318 + pending)} sub="credit + config, all gateways" />
        <StatCard label="Awaiting uplink" value={String(pending)} sub="class A · next uplink window" />
        <StatCard label="Acknowledged today" value={N(1201 + commands.filter((c) => c.status === 'Acknowledged').length)} sub="98.1% success" />
        <StatCard label="Failed today" value={String(21 + commands.filter((c) => c.status === 'Failed').length)} sub="mostly behind GW-GAB-06" />
      </div>

      <div className="grid stack-md" style={{ gridTemplateColumns: '320px minmax(0, 1fr)', alignItems: 'start' }}>
        <Card style={{ padding: '13px 14px' }}>
          <div className="card-title" style={{ marginBottom: 11 }}>Send a command</div>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }} noValidate>
            <label className={`form-field${touched && !valid ? ' invalid' : ''}`}>
              <span>Meter serial</span>
              <input value={meter} onChange={(e) => setMeter(e.target.value)} onBlur={() => setTouched(true)} placeholder="WM-104882" className="mono" />
              {touched && !valid && <span className="form-error">Use the format WM- followed by six digits.</span>}
            </label>
            <label className="form-field">
              <span>Command</span>
              <select value={cmd} onChange={(e) => setCmd(e.target.value as CommandType)}>
                {COMMANDS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <button type="submit" className="btn-primary" style={{ padding: 8, fontSize: 12 }}>Queue command</button>
            <div className="sub" style={{ lineHeight: 1.5 }}>
              Meters are LoRaWAN class A: they only listen right after they send, so a command is delivered on the meter’s next uplink, usually within 15 minutes.
            </div>
          </form>
        </Card>

        <Card clip>
          <div className="card-head" style={{ padding: '11px 14px' }}><span className="card-title">Recent commands</span></div>
          <div className="table-wrap">
            <table className="tbl compact">
              <TableHead cols={[{ label: 'Downlink' }, { label: 'Meter' }, { label: 'Command' }, { label: 'By' }, { label: 'Queued' }, { label: 'Result' }, { label: 'Status', align: 'right' }]} />
              <tbody>
                {commands.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.id}</td>
                    <td className="mono" style={{ color: 'var(--navy)' }}>{c.meter}</td>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c.cmd}</td>
                    <td className="mono" style={{ color: 'var(--muted)' }}>{c.by}</td>
                    <td className="mono" style={{ color: 'var(--muted)' }}>{c.at}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{c.note}</td>
                    <td className="num"><Badge status={CMD_BADGE[c.status]} label={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
