import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Card, Switch, TableHead } from '../components/ui';
import { Field, Modal, toast } from '../components/overlay';
import { GENERATED, REPORTS, SCHEDULES, type JobStatus } from '../data/admin';
import { SUBURBS, meters } from '../data/fleet';
import { currentHandle } from '../auth';
import { downloadCsv, slug } from '../lib/csv';

interface Job { id: number; name: string; report: string; range: string; by: string; status: JobStatus; format: string }
interface Schedule { name: string; cron: string; to: string; on: boolean }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Rows for a report download, built from the same data the screens show. */
function reportRows(report: string): { header: string[]; rows: (string | number)[][] } {
  if (report.startsWith('Water usage')) return { header: ['Suburb', 'Meters', 'Usage (L)'], rows: SUBURBS.map((s) => [s.name, s.metersN, s.usageN]) };
  if (report.startsWith('Negative credit')) {
    return { header: ['Meter', 'Suburb', 'Balance (P)', 'Gateway'], rows: meters().filter((m) => m.bal < 0).sort((a, b) => a.bal - b.bal).map((m) => [m.id, m.sub, m.bal.toFixed(2), m.gw]) };
  }
  if (report.startsWith('Network health')) {
    return { header: ['Meter', 'Status', 'RSSI (dBm)', 'SNR (dB)', 'Battery %', 'Gateway'], rows: meters().slice(0, 500).map((m) => [m.id, m.status, m.rssi, m.snr, m.batt, m.gw]) };
  }
  return { header: ['Suburb', 'Tokens', 'Sales (P)', 'Transactions', 'Usage (L)'], rows: SUBURBS.map((s) => [s.name, s.tokens, s.salesN.toFixed(2), s.txN, s.usageN]) };
}

export function Reports() {
  const [jobs, setJobs] = useState<Job[]>(() => GENERATED.map(([name, range, by, status], i) => ({ id: i + 1, name, report: name.split(' · ')[0], range, by, status, format: 'CSV' })));
  const [schedules, setSchedules] = useState<Schedule[]>(() => SCHEDULES.map(([name, cron, to, on]) => ({ name, cron, to, on })));
  const [dialog, setDialog] = useState<string | 'schedule' | null>(null);
  const timers = useRef<number[]>([]);

  const runJob = (id: number) => {
    timers.current.push(window.setTimeout(() => {
      setJobs((js) => js.map((j) => (j.id === id && j.status === 'Queued' ? { ...j, status: 'Ready' } : j)));
      toast('Report ready to download');
    }, 2500));
  };
  // Jobs already queued when the page opens finish like new ones; timers stop when leaving the page.
  useEffect(() => {
    jobs.filter((j) => j.status === 'Queued').forEach((j) => runJob(j.id));
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const queue = (report: string, range: string, format: string) => {
    const id = Date.now();
    setJobs((js) => [{ id, name: `${report} · ${range}`, report, range, by: currentHandle(), status: 'Queued', format }, ...js]);
    runJob(id);
    toast(`${report} queued`, 'info');
  };
  const act = (j: Job) => {
    if (j.status === 'Ready') {
      const { header, rows } = reportRows(j.report);
      downloadCsv(slug(j.name), header, rows);
      if (j.format !== 'CSV') toast(`${j.format} rendering needs the reporting service; downloaded as CSV`, 'info');
    } else if (j.status === 'Failed') {
      setJobs((js) => js.map((x) => (x.id === j.id ? { ...x, status: 'Queued' } : x)));
      runJob(j.id);
      toast('Retrying report', 'info');
    } else {
      setJobs((js) => js.filter((x) => x.id !== j.id));
      toast('Report cancelled', 'warn');
    }
  };

  return (
    <div>
      <div className="grid g-stats" style={{ marginBottom: 16 }}>
        {REPORTS.map((r) => (
          <Card key={r.name} hover className="report-card">
            <span className="card-title">{r.name}</span>
            <div className="sub" style={{ lineHeight: 1.5, minHeight: 34 }}>{r.desc}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 10, borderTop: '1px solid var(--line-3)' }}>
              {r.formats.map((f) => <span key={f} className="fmt-tag">{f}</span>)}
              <span className="flex1" />
              <button type="button" className="btn btn-sm" onClick={() => setDialog(r.name)}>Generate</button>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid stack-md" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
        <Card clip>
          <div className="card-head"><span className="card-title">Recently generated</span></div>
          <div className="table-wrap">
            <table className="tbl">
              <TableHead cols={[{ label: 'Report' }, { label: 'Range' }, { label: 'Requested by' }, { label: 'Status', align: 'right' }, { label: '', align: 'right' }]} />
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td style={{ fontWeight: 500 }}>{j.name}</td>
                    <td className="sub">{j.range}</td>
                    <td className="mono" style={{ color: 'var(--muted)' }}>{j.by}</td>
                    <td className="num"><Badge status={j.status} label={j.status === 'Queued' ? 'Generating…' : j.status} /></td>
                    <td className="num"><button type="button" className="link" style={{ fontSize: 11.5 }} onClick={() => act(j)}>{{ Ready: 'Download', Failed: 'Retry', Queued: 'Cancel' }[j.status]}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card clip>
          <div className="card-head">
            <span className="card-title flex1">Scheduled</span>
            <button type="button" className="link" style={{ fontSize: 11.5 }} onClick={() => setDialog('schedule')}>+ New schedule</button>
          </div>
          {schedules.map((s, i) => (
            <div key={s.name + i} className="schedule-row">
              <div className="flex1" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.name}</div>
                <div className="mono sub ellipsis" style={{ marginTop: 2 }}>{s.cron} · {s.to}</div>
              </div>
              <Switch on={s.on} label={`${s.name} schedule`} onClick={() => {
                setSchedules((ss) => ss.map((x, j) => (j === i ? { ...x, on: !x.on } : x)));
                toast(`${s.name} ${s.on ? 'paused' : 'resumed'}`, s.on ? 'warn' : 'ok');
              }} />
              <button type="button" className="icon-x" aria-label={`Delete ${s.name}`} title="Delete schedule" onClick={() => {
                setSchedules((ss) => ss.filter((_, j) => j !== i));
                toast(`Schedule “${s.name}” deleted`, 'warn');
              }}>✕</button>
            </div>
          ))}
          {!schedules.length && <div className="sub" style={{ padding: 20, textAlign: 'center' }}>No schedules yet.</div>}
        </Card>
      </div>

      {dialog === 'schedule' && <ScheduleDialog onClose={() => setDialog(null)} onSave={(s) => { setSchedules((ss) => [s, ...ss]); setDialog(null); toast(`Schedule “${s.name}” created`); }} />}
      {dialog && dialog !== 'schedule' && (
        <GenerateDialog report={dialog} onClose={() => setDialog(null)} onQueue={(range, format) => { queue(dialog, range, format); setDialog(null); }} />
      )}
    </div>
  );
}

function GenerateDialog({ report, onClose, onQueue }: { report: string; onClose: () => void; onQueue: (range: string, format: string) => void }) {
  const r = REPORTS.find((x) => x.name === report)!;
  const [from, setFrom] = useState('2026-08-01');
  const [to, setTo] = useState('2026-08-19');
  const [format, setFormat] = useState(r.formats.includes('CSV') ? 'CSV' : r.formats[0]);
  const [zone, setZone] = useState('All zones');
  const err = Date.parse(to) < Date.parse(from) ? 'End date must be on or after the start date.' : '';
  const fmt = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!err) onQueue(`${fmt(from)} – ${fmt(to)}${zone !== 'All zones' ? ' · ' + zone : ''}`, format); };
  return (
    <Modal title={`Generate · ${report}`} onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" form="gen" className="btn-primary" disabled={!!err}>Generate report</button>
    </>}>
      <form id="gen" onSubmit={submit} style={{ display: 'contents' }}>
        <div className="sub">{r.desc}</div>
        <div className="form-row">
          <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" error={err}><input type="date" value={to} max="2026-08-19" onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Zone"><select value={zone} onChange={(e) => setZone(e.target.value)}><option>All zones</option>{SUBURBS.slice(0, 14).map((s) => <option key={s.name}>{s.name}</option>)}</select></Field>
          <Field label="Format"><select value={format} onChange={(e) => setFormat(e.target.value)}>{r.formats.map((f) => <option key={f}>{f}</option>)}</select></Field>
        </div>
      </form>
    </Modal>
  );
}

function ScheduleDialog({ onClose, onSave }: { onClose: () => void; onSave: (s: Schedule) => void }) {
  const [report, setReport] = useState(REPORTS[0].name);
  const [freq, setFreq] = useState('Daily');
  const [time, setTime] = useState('06:00');
  const [to, setTo] = useState('');
  const [touched, setTouched] = useState(false);
  const emails = to.split(/[,;\s]+/).filter(Boolean);
  const err = !emails.length ? 'Add at least one recipient.' : emails.find((e) => !EMAIL.test(e)) ? `“${emails.find((e) => !EMAIL.test(e))}” is not a valid email.` : '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (err) return;
    const when = freq === 'Daily' ? `${time} daily` : freq === 'Weekly' ? `Mon ${time}` : `1st ${time}`;
    onSave({ name: `${freq} ${report.toLowerCase()}`, cron: when, to: emails.join(', '), on: true });
  };
  return (
    <Modal title="New schedule" onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" form="sched" className="btn-primary">Create schedule</button>
    </>}>
      <form id="sched" onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <Field label="Report"><select value={report} onChange={(e) => setReport(e.target.value)}>{REPORTS.map((r) => <option key={r.name}>{r.name}</option>)}</select></Field>
        <div className="form-row">
          <Field label="Frequency"><select value={freq} onChange={(e) => setFreq(e.target.value)}><option>Daily</option><option>Weekly</option><option>Monthly</option></select></Field>
          <Field label="Time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <Field label="Email to" error={touched && err} hint="Separate several addresses with commas.">
          <input type="email" multiple value={to} onChange={(e) => setTo(e.target.value)} placeholder="ops@wuc.co.bw" />
        </Field>
      </form>
    </Modal>
  );
}
