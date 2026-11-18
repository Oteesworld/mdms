// Water usage per hour or per local day, from a meter's cumulative register readings.
//
// Usage between two readings (later minus earlier register) is counted in the
// bucket of the later reading. With hourly records (SH data reports) each hour
// is exact; with sparser readings (e.g. a status frame every 4 h) a bar holds
// everything used since the previous reading, and the hours between show 0.
// A drop in the register (meter replaced or reset) is skipped, not counted.

export type Interval = 'hour' | 'day';

export interface UsageBucket {
  key: string; // local "YYYY-MM-DD" or "YYYY-MM-DD HH"
  start: string; // ISO time the bucket starts
  usageL: number;
  readings: number; // readings that landed in this bucket
}

export interface UsageResult {
  interval: Interval;
  timeZone: string;
  from: string;
  to: string;
  buckets: UsageBucket[];
  totalL: number;
  /** Median hours between readings in the window, so the UI can explain lumped hourly bars. */
  readingSpacingH: number | null;
}

function keyFor(t: Date, interval: Interval, fmt: Intl.DateTimeFormat): string {
  const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return interval === 'day' ? `${p.year}-${p.month}-${p.day}` : `${p.year}-${p.month}-${p.day} ${hour}`;
}

export function usageBuckets(
  readings: { readAt: string; registerL: number | null }[],
  interval: Interval,
  timeZone: string,
  from: Date,
  to: Date,
): UsageResult {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });

  // Every bucket in the window, in order (stepping hourly covers DST and day edges).
  const buckets = new Map<string, UsageBucket>();
  const step = 3600_000;
  for (let t = Math.floor(from.getTime() / step) * step; t <= to.getTime(); t += step) {
    const k = keyFor(new Date(t), interval, fmt);
    if (!buckets.has(k)) buckets.set(k, { key: k, start: new Date(t).toISOString(), usageL: 0, readings: 0 });
  }

  const pts = readings
    .filter((r) => typeof r.registerL === 'number' && Number.isFinite(r.registerL))
    .map((r) => ({ t: Date.parse(r.readAt), v: r.registerL as number }))
    .sort((a, b) => a.t - b.t);

  const gaps: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    if (cur.t < from.getTime() || cur.t > to.getTime()) continue;
    const b = buckets.get(keyFor(new Date(cur.t), interval, fmt));
    if (!b) continue;
    b.readings++;
    gaps.push((cur.t - prev.t) / 3600_000);
    const delta = cur.v - prev.v;
    if (delta > 0) b.usageL = Math.round((b.usageL + delta) * 1000) / 1000;
  }

  gaps.sort((a, b) => a - b);
  const list = [...buckets.values()];
  return {
    interval,
    timeZone,
    from: from.toISOString(),
    to: to.toISOString(),
    buckets: list,
    totalL: Math.round(list.reduce((s, b) => s + b.usageL, 0) * 1000) / 1000,
    readingSpacingH: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)] * 10) / 10 : null,
  };
}
