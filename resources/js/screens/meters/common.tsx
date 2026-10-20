/* Shared helpers for the meter register, form and dashboard. */
import { N } from '../../data/format';

export type MeterState = 'online' | 'offline' | 'awaiting' | 'decommissioned';

export const TZ = 'Africa/Gaborone';

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o });
const dayTime = fmt({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const dayOnly = fmt({ day: '2-digit', month: 'short' });
const hourOnly = fmt({ hour: '2-digit', hour12: false });

/** "20 Oct, 09:38" in Gaborone time. */
export const when = (iso: string | number | null | undefined) => (iso == null ? '—' : dayTime.format(new Date(iso)));
export const day = (iso: string | number) => dayOnly.format(new Date(iso));
export const hour = (iso: string | number) => hourOnly.format(new Date(iso)) + ':00';

export const m3 = (v: number | null | undefined, digits = 3) => (v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
export const litres = (v: number) => N(Math.round(v * 1000)) + ' L';

export function StatePill({ state }: { state: MeterState }) {
  const [cls, label] = {
    online: ['on', 'Online'],
    offline: ['off', 'Offline'],
    awaiting: ['wait', 'Awaiting first uplink'],
    decommissioned: ['gone', 'Decommissioned'],
  }[state];
  return <span className={`status-pill ${cls}`}><span className="dot" />{label}</span>;
}

/** The touch-key code from the manual, e.g. D1 U1 D1 U1 D1 for 11111 (trigger reporting). */
export function KeyCode({ steps }: { steps: string[] }) {
  return <span className="keycode" aria-label={steps.join(' ')}>{steps.map((s, i) => <span key={i}>{s}</span>)}</span>;
}

export const REPORTS_PER_DAY: Record<number, number> = { 1: 24, 2: 12, 3: 8, 4: 6, 6: 4, 8: 3, 24: 1 };
