/**
 * Seeded PRNG (mulberry32) so mock data is identical on every load. The
 * prototype's bare LCG gave nearly the same first value for neighbouring
 * seeds, so every row looked alike and no client ever went into arrears.
 */
export const rnd = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const P = (n: number) =>
  'P ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const N = (n: number) => n.toLocaleString('en-US');
export const litres = (n: number) => N(n) + ' L';
export const short = (n: number) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n);
export const pct = (v: number, max: number, digits = 1) => ((v / max) * 100).toFixed(digits) + '%';
export const initials = (name: string, max = 3) =>
  name.split(' ').map((w) => w[0]).slice(0, max).join('');
