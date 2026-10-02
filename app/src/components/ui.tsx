import type { CSSProperties, ReactNode } from 'react';
import { BADGE } from '../data/admin';

export function Card({ children, clip, hover, style, className = '' }: { children: ReactNode; clip?: boolean; hover?: boolean; style?: CSSProperties; className?: string }) {
  return <div className={`card${clip ? ' clip' : ''}${hover ? ' card-hover' : ''} ${className}`} style={style}>{children}</div>;
}

/** Small stat tile used at the top of register-style screens. */
export function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card" style={{ padding: '11px 13px' }}>
      <div className="label" style={{ marginBottom: 6 }}>{label}</div>
      <div className="stat-value">{value}</div>
      <div className="sub" style={{ marginTop: 4 }}>{sub}</div>
    </div>
  );
}

/** Section heading with a hairline rule and an optional right-hand note. */
export function SectionRule({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <div className="section-rule">
      <span>{title}</span>
      <span className="rule" />
      {note && <span className="meta">{note}</span>}
    </div>
  );
}

/** Status pill; colours come from the shared BADGE palette. */
export function Badge({ status, label }: { status: string; label?: string }) {
  const [color, background] = BADGE[status] ?? ['#49515C', '#F0F2F4'];
  return <span className="badge" style={{ color, background }}>{label ?? status}</span>;
}

export function Switch({ on, large, onClick, label }: { on: boolean; large?: boolean; onClick?: () => void; label?: string }) {
  const cls = `switch${on ? ' on' : ''}${large ? ' lg' : ''}`;
  if (!onClick) return <span className={cls} />;
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={cls} onClick={onClick} />;
}

/** Joined button group; `tone` picks the active style. */
export function Segmented<T extends string>({ options, value, onChange, labels, tone = 'tint' }: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  tone?: 'tint' | 'solid';
}) {
  return (
    <div className="segmented">
      {options.map((o) => {
        const on = o === value;
        const style: CSSProperties = on
          ? tone === 'solid'
            ? { background: 'var(--navy)', color: '#fff', fontWeight: 600 }
            : { background: 'var(--navy-tint)', color: 'var(--navy)', fontWeight: 600 }
          : {};
        return (
          <button key={o} type="button" style={style} onClick={() => onChange(o)} aria-pressed={on}>
            {labels?.[o] ?? o}
          </button>
        );
      })}
    </div>
  );
}

/** Horizontal bar row: label · track · value. */
export function BarRow({ label, value, width, color, labelWidth, valueWidth, height = 13, labelStyle }: {
  label: ReactNode;
  value: ReactNode;
  width: string;
  color: string;
  labelWidth: number;
  valueWidth: number;
  height?: number;
  labelStyle?: CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span className="mono" style={{ width: labelWidth, fontWeight: 600, fontSize: 10.5, color: 'var(--ink-4)', ...labelStyle }}>{label}</span>
      <div className="bar-track" style={{ flex: 1, height }}>
        <div className="bar-fill" style={{ background: color, width }} />
      </div>
      <span className="mono" style={{ width: valueWidth, fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

export interface Column {
  label: string;
  align?: 'left' | 'right' | 'center';
}

export function TableHead({ cols }: { cols: Column[] }) {
  return (
    <thead>
      <tr>
        {cols.map((c, i) => (
          <th key={i} style={{ textAlign: c.align ?? 'left' }}>{c.label}</th>
        ))}
      </tr>
    </thead>
  );
}
