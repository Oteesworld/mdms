import { useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useAuth } from '../auth';
import { TABLES } from '../data/clients';
import { GATEWAYS } from '../data/fleet';
import { NAV, type Screen } from '../routes';
import { meterIndex } from '../data/meters';

interface Hit { kind: 'Client' | 'Meter' | 'Gateway' | 'Screen'; label: string; sub: string; screen: Screen; param?: number | string; key: string }

function buildIndex(): Hit[] {
  const hits: Hit[] = [];
  const clientIdx = new Map<string, { screen: Screen; i: number }>();
  for (const screen of ['domestic', 'business'] as const) {
    const cfg = TABLES[screen];
    cfg.rows().forEach((_, i) => {
      const k = cfg.kyc!(i);
      clientIdx.set(k.id, { screen, i });
      hits.push({ kind: 'Client', label: k.name, sub: `${k.id} · ${k.kind}`, screen, param: i, key: (k.name + ' ' + k.id).toLowerCase() });
    });
  }
  meterIndex().forEach((m) => {
    const c = clientIdx.get(m.clientId);
    // The meter dashboard when the role has the meter register, otherwise the client's profile.
    const key = (m.serial + ' ' + m.plot).toLowerCase();
    hits.push({ kind: 'Meter', label: m.serial, sub: `${m.clientName} · ${m.plot}`, screen: 'meters', param: m.serial, key });
    if (c) hits.push({ kind: 'Meter', label: m.serial, sub: `${m.clientName} · ${m.plot}`, screen: c.screen, param: c.i, key });
  });
  GATEWAYS.forEach((g) => hits.push({ kind: 'Gateway', label: g.id, sub: g.site, screen: 'gateways', key: (g.id + ' ' + g.site).toLowerCase() }));
  NAV.forEach((n) => 'screen' in n && hits.push({ kind: 'Screen', label: n.label, sub: 'Go to screen', screen: n.screen, key: n.label.toLowerCase() }));
  return hits;
}

/** Top-bar search across clients, meters, gateways and screens the user may open. */
export function GlobalSearch({ go }: { go: (s: Screen, param?: number | string) => void }) {
  const { canOpen } = useAuth();
  const index = useMemo(buildIndex, []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const needle = q.trim().toLowerCase();
  const results = needle.length < 2 ? [] : index.filter((h, i, all) => canOpen(h.screen) && h.key.includes(needle)
    && all.findIndex((o) => o.kind === h.kind && o.label === h.label && canOpen(o.screen)) === i).slice(0, 8);

  const pick = (h: Hit) => {
    go(h.screen, h.param);
    setQ('');
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="search-wrap">
      <label className="search">
        <Icon name="search" size={15} />
        <input
          ref={input}
          value={q}
          placeholder="Search meter, client or gateway"
          aria-label="Search meter, client or gateway"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="search-results"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && results[active]) pick(results[active]);
            if (e.key === 'Escape') { setQ(''); setOpen(false); }
          }}
        />
      </label>
      {open && needle.length >= 2 && (
        <div className="search-pop" id="search-results" role="listbox">
          {results.length === 0 && <div className="search-empty">No matches for “{q.trim()}”</div>}
          {results.map((h, i) => (
            <button key={h.kind + h.label + i} type="button" role="option" aria-selected={i === active} className={`search-hit${i === active ? ' on' : ''}`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)} onMouseEnter={() => setActive(i)}>
              <span className="search-kind">{h.kind}</span>
              <span className="flex1" style={{ minWidth: 0 }}>
                <span className={`ellipsis${h.kind === 'Meter' || h.kind === 'Gateway' ? ' mono' : ''}`} style={{ display: 'block', fontWeight: 600, fontSize: 12.5 }}>{h.label}</span>
                <span className="ellipsis sub" style={{ display: 'block' }}>{h.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
