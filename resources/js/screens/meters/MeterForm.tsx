import { Link, useForm, usePage } from '@inertiajs/react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Card } from '../../components/ui';
import { Field, toast } from '../../components/overlay';
import { KeyCode, REPORTS_PER_DAY } from './common';

interface Client { id: string; name: string; type: string }
interface Editable {
  serial: string; meter_address: string; dev_eui: string; join_eui: string; has_app_key: boolean;
  lorawan_region: string; device_class: string; reporting_hours: number; sampling_minutes: number;
  sts_sgc: string; sts_krn: number; sts_ti: string;
  plot: string; suburb: string; lat: number | null; lng: number | null; installed_at: string; initial_reading: number; seal_no: string; valve: string;
  client_id: string; occupant: string; vending_party: string; commissioning: Record<string, boolean>; decommissioned: boolean;
}
interface Props {
  form: { meter: Editable | null; clients: Client[]; suburbs: string[]; regions: string[]; reportingHours: number[]; samplingMinutes: number[]; suggestedSerial: string };
  [k: string]: unknown;
}

/** Luhn check on the 13-digit meter address (the STS meter number). */
function luhnOk(s: string) {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  [...s].reverse().forEach((c, i) => { let d = +c; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; });
  return sum % 10 === 0;
}
const hex = (v: string) => v.replace(/[\s:-]/g, '').toUpperCase();
const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

const CHECKS: [key: string, title: string, how: ReactNode][] = [
  ['ns_registered', 'Added to the network server', 'Create the device in ChirpStack / The Things Stack with the same DevEUI, JoinEUI and AppKey (OTAA, class A) and the uplink webhook.'],
  ['reporting_enabled', 'Out of non-reporting mode', <>Meters ship silent. Enter touch-key code 11111 <KeyCode steps={['D1', 'U1', 'D1', 'U1', 'D1']} />: the blue LED shows network registration; three red flashes mean the gateway answered.</>],
  ['ciu_bound', 'CIU bound to the meter', 'The address label on the CIU matches the meter. On the CIU, enter 00 and Confirm: it should show ACCEPT.'],
  ['valve_tested', 'Valve tested', 'The motorised ball valve opened and closed on command.'],
];

/** Register a Kalahari Ultrasonic meter on the network and platform, or edit one (?edit=1). */
export function MeterForm() {
  const { form: opts, serial } = usePage<Props & { serial?: string }>().props;
  const m = opts.meter;
  const editing = !!m;
  const [showKey, setShowKey] = useState(false);
  const form = useForm({
    serial: m?.serial ?? opts.suggestedSerial,
    meter_address: m?.meter_address ?? '',
    dev_eui: m?.dev_eui ?? '',
    join_eui: m?.join_eui ?? '',
    app_key: '',
    lorawan_region: m?.lorawan_region ?? 'EU868',
    device_class: m?.device_class ?? 'A',
    reporting_hours: m?.reporting_hours ?? 24,
    sampling_minutes: m?.sampling_minutes ?? 60,
    sts_sgc: m?.sts_sgc ?? '600741',
    sts_krn: m?.sts_krn ?? 2,
    sts_ti: m?.sts_ti ?? '01',
    plot: m?.plot ?? '',
    suburb: m?.suburb ?? '',
    lat: m?.lat != null ? String(m.lat) : '',
    lng: m?.lng != null ? String(m.lng) : '',
    installed_at: m?.installed_at ?? new Date().toISOString().slice(0, 10),
    initial_reading: m != null ? String(m.initial_reading) : '0',
    seal_no: m?.seal_no ?? '',
    valve: m?.valve ?? 'open',
    client_id: m?.client_id ?? '',
    occupant: m?.occupant ?? '',
    vending_party: m?.vending_party ?? 'occupant',
    commissioning: { ns_registered: false, reporting_enabled: false, ciu_bound: false, valve_tested: false, ...(m?.commissioning ?? {}) } as Record<string, boolean>,
    decommissioned: m?.decommissioned ?? false,
  });
  const { data, setData, errors } = form;
  const e = errors as Record<string, string | undefined>;
  const addr = data.meter_address.trim();
  const addrHint = addr.length === 13 ? (luhnOk(addr) ? '✓ Check digit is valid' : undefined) : `${addr.length}/13 digits`;
  const addrErr = e.meter_address ?? (addr.length === 13 && !luhnOk(addr) ? 'Check digit doesn’t match. Re-read the number from the label.' : undefined);
  const client = opts.clients.find((c) => c.id === data.client_id);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const payload = { ...data, lat: data.lat === '' ? null : data.lat, lng: data.lng === '' ? null : data.lng, app_key: data.app_key || null, suburb: data.suburb || null };
    form.transform(() => payload);
    if (editing) form.put('/meters/' + m!.serial, { preserveScroll: true });
    else form.post('/meters', { preserveScroll: true, onError: () => toast('Check the highlighted fields', 'bad') });
  };

  const locate = () => {
    if (!navigator.geolocation) { toast('This browser can’t share its location', 'warn'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setData((d) => ({ ...d, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })); toast('Location filled in from this device'); },
      () => toast('Location not available. Allow location access or type the coordinates.', 'warn'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const done = CHECKS.filter(([k]) => data.commissioning[k]).length;

  return (
    <form onSubmit={submit} noValidate>
      <div style={{ marginBottom: 12 }}>
        <Link className="back-link" href={editing ? '/meters/' + serial : '/meters'}><Icon name="back" size={15} />{editing ? serial : 'Meter register'}</Link>
      </div>
      <div className="meter-form">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Card className="form-section">
            <h3>Meter</h3>
            <span className="sub">Kalahari Ultrasonic DN15 · STS prepaid · LoRaWAN. Copy the numbers from the label on the meter.</span>
            <div className="form-grid">
              <Field label="Serial (asset tag)" error={e.serial} hint={editing ? 'Can’t be changed' : 'WM- and six digits'}>
                <input className="mono" value={data.serial} readOnly={editing} onChange={(ev) => setData('serial', ev.target.value.toUpperCase())} />
              </Field>
              <Field label="Meter address" error={addrErr} hint={editing ? 'Can’t be changed' : addrHint}>
                <input className="mono" inputMode="numeric" maxLength={13} value={data.meter_address} readOnly={editing} placeholder="0288260510566"
                  onChange={(ev) => setData('meter_address', ev.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label="STS meter number" hint="Same as the meter address">
                <input className="mono" value={addr || '—'} readOnly tabIndex={-1} />
              </Field>
            </div>
          </Card>

          <Card className="form-section">
            <h3>LoRaWAN</h3>
            <span className="sub">Over-the-air activation (OTAA). Enter the same keys on the network server; the server decrypts uplinks and forwards them here.</span>
            <div className="form-grid">
              <Field label="DevEUI" error={e.dev_eui} hint={`${hex(data.dev_eui).length}/16 hex`}>
                <input className="hex-input" maxLength={23} value={data.dev_eui} onChange={(ev) => setData('dev_eui', ev.target.value)} placeholder="9CD9CB0000CD51F3" />
              </Field>
              <Field label="JoinEUI (AppEUI)" error={e.join_eui} hint={`${hex(data.join_eui).length}/16 hex`}>
                <input className="hex-input" maxLength={23} value={data.join_eui} onChange={(ev) => setData('join_eui', ev.target.value)} placeholder="70B3D57ED0000000" />
              </Field>
              <Field label="AppKey" error={e.app_key} hint={editing && m!.has_app_key ? 'Stored encrypted. Leave blank to keep it.' : `${hex(data.app_key).length}/32 hex · kept encrypted`}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="hex-input" type={showKey ? 'text' : 'password'} autoComplete="off" maxLength={47} value={data.app_key} style={{ flex: 1, minWidth: 0 }}
                    onChange={(ev) => setData('app_key', ev.target.value)} placeholder={editing && m!.has_app_key ? '•••• stored ••••' : '32 hex characters'} />
                  <button type="button" className="btn btn-sm" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Hide' : 'Show'}</button>
                </div>
              </Field>
              <Field label="Region / band" error={e.lorawan_region}>
                <select value={data.lorawan_region} onChange={(ev) => setData('lorawan_region', ev.target.value)}>{opts.regions.map((r) => <option key={r}>{r}</option>)}</select>
              </Field>
              <Field label="Device class" error={e.device_class} hint="Battery meters use class A">
                <select value={data.device_class} onChange={(ev) => setData('device_class', ev.target.value)}><option value="A">A (battery)</option><option value="C">C (always listening)</option></select>
              </Field>
              <Field label="Reporting" error={e.reporting_hours} hint="Hourly records are packaged per uplink">
                <select value={data.reporting_hours} onChange={(ev) => setData('reporting_hours', Number(ev.target.value))}>
                  {opts.reportingHours.map((h) => <option key={h} value={h}>{h} h per package · {REPORTS_PER_DAY[h]}/day{h === 24 ? ' (factory default)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Sampling" error={e.sampling_minutes}>
                <select value={data.sampling_minutes} onChange={(ev) => setData('sampling_minutes', Number(ev.target.value))}>
                  {opts.samplingMinutes.map((s) => <option key={s} value={s}>Every {s === 60 ? 'hour (default)' : s + ' min'}</option>)}
                </select>
              </Field>
              {!editing && (
                <div className="span2" style={{ alignSelf: 'end', paddingBottom: 6 }}>
                  <button type="button" className="link" style={{ fontSize: 11.5 }} onClick={() => { setData('app_key', randomHex(16)); setShowKey(true); }}>Generate a new AppKey</button>
                  <span className="sub"> only if you will also program it into the meter. Otherwise use the key from the supplier’s sheet.</span>
                </div>
              )}
            </div>
          </Card>

          <Card className="form-section">
            <h3>STS prepayment</h3>
            <span className="sub">STS Edition 2. Credit on the meter is water volume (m³); tokens are 20 digits entered on the CIU or delivered remotely.</span>
            <div className="form-grid">
              <Field label="Supply group code (SGC)" error={e.sts_sgc}><input className="mono" inputMode="numeric" maxLength={6} value={data.sts_sgc} onChange={(ev) => setData('sts_sgc', ev.target.value.replace(/\D/g, ''))} /></Field>
              <Field label="Key revision (KRN)" error={e.sts_krn}><input className="mono" type="number" min={1} max={9} value={data.sts_krn} onChange={(ev) => setData('sts_krn', Number(ev.target.value))} /></Field>
              <Field label="Tariff index (TI)" error={e.sts_ti}><input className="mono" inputMode="numeric" maxLength={2} value={data.sts_ti} onChange={(ev) => setData('sts_ti', ev.target.value.replace(/\D/g, ''))} /></Field>
            </div>
          </Card>

          <Card className="form-section">
            <h3>Installation</h3>
            <span className="sub">Where the meter is and what it read when it was fitted.</span>
            <div className="form-grid">
              <Field label="Plot / address" error={e.plot}><input value={data.plot} onChange={(ev) => setData('plot', ev.target.value)} placeholder="Plot 9000, Block 8" /></Field>
              <Field label="Suburb" error={e.suburb}>
                <input list="suburbs" value={data.suburb} onChange={(ev) => setData('suburb', ev.target.value)} />
              </Field>
              <datalist id="suburbs">{opts.suburbs.map((s) => <option key={s} value={s} />)}</datalist>
              <Field label="Installed on" error={e.installed_at}><input type="date" value={data.installed_at} max={new Date().toISOString().slice(0, 10)} onChange={(ev) => setData('installed_at', ev.target.value)} /></Field>
              <Field label="Latitude" error={e.lat}><input className="mono" inputMode="decimal" value={data.lat} onChange={(ev) => setData('lat', ev.target.value)} placeholder="-24.6217" /></Field>
              <Field label="Longitude" error={e.lng}><input className="mono" inputMode="decimal" value={data.lng} onChange={(ev) => setData('lng', ev.target.value)} placeholder="25.9478" /></Field>
              <div style={{ alignSelf: 'end', paddingBottom: 4 }}><button type="button" className="btn" onClick={locate}><Icon name="locate" size={14} /> Use my location</button></div>
              <Field label="Reading at install (m³)" error={e.initial_reading} hint="P-0 on the meter display"><input className="mono" inputMode="decimal" value={data.initial_reading} onChange={(ev) => setData('initial_reading', ev.target.value)} /></Field>
              <Field label="Seal number" error={e.seal_no}><input className="mono" value={data.seal_no} onChange={(ev) => setData('seal_no', ev.target.value)} /></Field>
              <Field label="Valve left" error={e.valve}><select value={data.valve} onChange={(ev) => setData('valve', ev.target.value)}><option value="open">Open</option><option value="closed">Closed</option></select></Field>
            </div>
          </Card>

          <Card className="form-section">
            <h3>Customer</h3>
            <span className="sub">Leave unassigned to register stock; vending is refused until the meter is linked to an account.</span>
            <div className="form-grid">
              <Field label="Account" error={e.client_id}>
                <select value={data.client_id} onChange={(ev) => setData('client_id', ev.target.value)}>
                  <option value="">Unassigned (stock)</option>
                  {opts.clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}
                </select>
              </Field>
              <Field label="Occupant" error={e.occupant} hint={client ? 'Blank if the owner lives there' : undefined}>
                <input value={data.occupant} disabled={!client} onChange={(ev) => setData('occupant', ev.target.value)} />
              </Field>
              <Field label="Who may buy tokens" error={e.vending_party}>
                <select value={client ? data.vending_party : 'none'} disabled={!client} onChange={(ev) => setData('vending_party', ev.target.value)}>
                  <option value="occupant">Occupant (tenant)</option><option value="owner">Owner</option><option value="none">Nobody (vending off)</option>
                </select>
              </Field>
            </div>
          </Card>
        </div>

        <div className="sticky" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card className="form-section">
            <h3>Commissioning</h3>
            <span className="sub">From the Kalahari manual. Tick what’s done on site; joining and reporting are confirmed automatically when the first uplink arrives.</span>
            <div className="checklist">
              {CHECKS.map(([k, title, how]) => (
                <label key={k} className="check-row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!data.commissioning[k]} onChange={(ev) => setData('commissioning', { ...data.commissioning, [k]: ev.target.checked })} style={{ marginTop: 2 }} />
                  <span><b style={{ fontWeight: 600 }}>{title}</b><span className="sub" style={{ display: 'block', marginTop: 2, lineHeight: 1.45 }}>{how}</span></span>
                </label>
              ))}
            </div>
            {editing && (
              <label className="check-row" style={{ cursor: 'pointer', marginTop: 6, borderTop: '1px solid var(--line-3)' }}>
                <input type="checkbox" checked={data.decommissioned} onChange={(ev) => setData('decommissioned', ev.target.checked)} style={{ marginTop: 2 }} />
                <span><b style={{ fontWeight: 600, color: 'var(--bad)' }}>Decommissioned</b><span className="sub" style={{ display: 'block', marginTop: 2 }}>Removed from service. Vending is refused; history is kept.</span></span>
              </label>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
              <span className="sub flex1">{done} of {CHECKS.length} done</span>
              <Link href={editing ? '/meters/' + serial : '/meters'} className="btn" style={{ textDecoration: 'none' }}>Cancel</Link>
              <button type="submit" className="btn-primary" disabled={form.processing}>{form.processing ? 'Saving…' : editing ? 'Save changes' : 'Register meter'}</button>
            </div>
            {Object.keys(errors).length > 0 && <div role="alert" className="login-error" style={{ marginTop: 10 }}>{Object.keys(errors).length} field{Object.keys(errors).length > 1 ? 's need' : ' needs'} attention.</div>}
          </Card>
        </div>
      </div>
    </form>
  );
}
