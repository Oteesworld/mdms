/** Seeded LCG so mock data is identical on every load. */
export const rnd = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
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
