/* Small chart building blocks shared by the client profile and the meter dashboard. */
import { useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Card } from './ui';

export function Panel({ title, note, children, icon, actions }: { title: string; note?: ReactNode; children: ReactNode; icon?: IconName; actions?: ReactNode }) {
  return (
    <Card style={{ padding: '18px 20px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 11 }}>
        {icon && <span style={{ color: 'var(--muted)', alignSelf: 'center' }}><Icon name={icon} size={15} /></span>}
        <span className="card-title flex1">{title}</span>
        {note && <span className="meta">{note}</span>}
        {actions}
      </div>
      {children}
    </Card>
  );
}

export function KeyValues({ title, icon, rows, note }: { title: string; icon: IconName; rows: [string, ReactNode][]; note?: ReactNode }) {
  return (
    <Panel title={title} icon={icon} note={note}>
      <div className="kv">
        {rows.map(([k, v]) => (
          <div key={k}><span>{k}</span><span className="mono">{v}</span></div>
        ))}
      </div>
    </Panel>
  );
}

export function Legend({ color, label }: { color: string; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />{label}</span>;
}

/** Vertical bars with a hover tooltip. */
export function Bars({ values, labels, color, tip, height = 130 }: { values: number[]; labels: string[]; color: (v: number, i: number) => string; tip: (v: number, i: number) => string; height?: number }) {
  const max = Math.max(...values, 1e-9);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: values.length > 20 ? 2 : 4, height }} role="img" aria-label={labels.filter(Boolean).length ? `Bar chart, ${values.length} bars` : undefined}>
        {values.map((v, i) => (
          <div key={i} onMouseEnter={() => setHover(i)} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4, height: '100%', cursor: 'default' }}>
            <div style={{ width: '100%', height: (v / max) * 100 + '%', minHeight: v ? 2 : 0, background: color(v, i), borderRadius: '3px 3px 0 0', opacity: hover === null || hover === i ? 1 : 0.55, transition: 'opacity .1s' }} />
            <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--faint)', height: 12, whiteSpace: 'nowrap' }}>{labels[i]}</span>
          </div>
        ))}
      </div>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((hover + 0.5) / values.length) * 100}%` }}>{tip(values[hover], hover)}</div>
      )}
    </div>
  );
}

/**
 * Single-series line (optionally filled) with a crosshair tooltip. One y-axis only;
 * plot a second measure as its own chart.
 */
export function LineChart({ points, label, format, tick, color = '#00468C', fill = true, height = 150, markers, step, minSpan = 0 }: {
  points: { x: number; y: number | null }[];
  label: string;
  format: (y: number, x: number) => string;
  tick: (x: number) => string;
  color?: string;
  fill?: boolean;
  height?: number;
  /** Indexes to mark with a ring (e.g. top-ups). */
  markers?: { i: number; title: string }[];
  /** Draw as steps (registers, balances) rather than slopes. */
  step?: boolean;
  /** Smallest y range to show, so rounding noise doesn't look like a trend (e.g. 0.2 V). */
  minSpan?: number;
}) {
  const W = 560, H = height, padL = 42, padR = 8, padT = 8, padB = 18;
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const ys = points.map((p) => p.y).filter((y): y is number => y !== null);
  if (points.length < 2 || !ys.length) return <div className="empty-chart">Not enough data yet.</div>;
  let min = Math.min(...ys), max = Math.max(...ys);
  if (max - min < Math.max(minSpan, 1e-9)) { const mid = (min + max) / 2, half = (minSpan || 2) / 2; min = mid - half; max = mid + half; }
  const span = max - min;
  min -= span * 0.08; max += span * 0.08;
  const x0 = points[0].x, x1 = points[points.length - 1].x;
  const x = (v: number) => padL + ((v - x0) / (x1 - x0 || 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  let d = '';
  let prev: { x: number; y: number } | null = null;
  for (const p of points) {
    if (p.y === null) { prev = null; continue; }
    if (!prev) d += `M${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`;
    else if (step) d += `H${x(p.x).toFixed(1)}V${y(p.y).toFixed(1)}`;
    else d += `L${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`;
    prev = { x: p.x, y: p.y };
  }
  const ticks = [min + (max - min) * 0.1, (min + max) / 2, max - (max - min) * 0.1];
  const fmtTick = (v: number) => (Math.abs(max - min) < 3 ? v.toFixed(2) : Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(Math.abs(max - min) < 30 ? 1 : 0));
  const first = points.findIndex((p) => p.y !== null);
  const area = fill ? `${d}V${y(min)}H${x(points[first].x)}Z` : '';
  const xTicks = [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3), points.length - 1];
  const onMove = (e: React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    points.forEach((p, i) => { const dd = Math.abs(x(p.x) - px); if (p.y !== null && dd < bd) { bd = dd; best = i; } });
    setHover(best);
  };
  const hp = hover !== null ? points[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#ECEEF1" />
            <text x={padL - 6} y={y(t) + 3} fontSize={9} textAnchor="end" fill="#A1A8B2" fontFamily="IBM Plex Mono, monospace">{fmtTick(t)}</text>
          </g>
        ))}
        {fill && <path d={area} fill={color} fillOpacity={0.08} />}
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {markers?.map((m) => points[m.i]?.y != null && (
          <circle key={m.i} cx={x(points[m.i].x)} cy={y(points[m.i].y!)} r={4} fill="#fff" stroke="#2E9D5B" strokeWidth={2}><title>{m.title}</title></circle>
        ))}
        {xTicks.map((i, k) => (
          <text key={k} x={x(points[i].x)} y={H - 4} fontSize={9} textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'} fill="#A1A8B2" fontFamily="IBM Plex Mono, monospace">{tick(points[i].x)}</text>
        ))}
        {hp && hp.y !== null && (
          <g pointerEvents="none">
            <line x1={x(hp.x)} x2={x(hp.x)} y1={padT} y2={H - padB} stroke="#A1A8B2" strokeDasharray="3 3" />
            <circle cx={x(hp.x)} cy={y(hp.y)} r={4.5} fill={color} stroke="#fff" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && hp.y !== null && (
        <div className="chart-tip" style={{ left: `${(x(hp.x) / W) * 100}%` }}>{format(hp.y, hp.x)}</div>
      )}
    </div>
  );
}
