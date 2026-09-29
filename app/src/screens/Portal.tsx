import { useState } from 'react';
import { Segmented, TableHead } from '../components/ui';
import { PURCHASES } from '../data/admin';
import { domesticProperties } from '../data/clients';
import { N, P, litres, rnd } from '../data/format';

const VIEWS = ['Tenant', 'Landlord'] as const;
type View = (typeof VIEWS)[number];

const PORTAL_NAV = ['Overview', 'Usage', 'Purchases', 'Support'];

const STATS = [
  { label: 'This month', value: '14,820 L', sub: '18% below your average', tone: '#2A7A7E' },
  { label: 'Spend YTD', value: 'P 2,184.00', sub: '14 purchases', tone: '#181D23' },
  { label: 'Daily average', value: '478 L', sub: 'household of 4', tone: '#181D23' },
];

const USAGE = [12400, 13900, 15600, 14100, 16800, 18200, 17400, 15900, 14700, 13800, 15200, 14820];
const MONTHS = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

const METER_DATA = [
  { k: 'Meter serial', v: 'WM-104882' }, { k: 'DevEUI', v: 'A840419B2C7D' },
  { k: 'Last reading', v: '1,428,905 L' }, { k: 'Last uplink', v: '19 Aug 12:58', tone: '#237A48' },
  { k: 'Signal (RSSI)', v: '-94 dBm' }, { k: 'Battery', v: '82%', tone: '#237A48' },
  { k: 'Serving gateway', v: 'GW-GAB-02' }, { k: 'Tariff', v: 'Domestic Band 2' },
];

/** Landlord Mpho Sebego's portfolio (domestic client 0). */
const PORTFOLIO = (() => {
  const r = rnd(8181);
  return domesticProperties(0).map((p) => {
    const bal = Math.round((r() * 360 - 80) * 100) / 100;
    return { ...p, usage: N(Math.round(6000 + r() * 16000)) + ' L', balN: bal };
  });
})();

/** Customer self-service portal, previewed inside the admin shell. */
export function Portal() {
  const [view, setView] = useState<View>('Tenant');
  const owner = view === 'Landlord';
  const umax = Math.max(...USAGE);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div className="card clip" style={{ borderRadius: 10, boxShadow: '0 1px 3px rgba(16,24,40,.05)' }}>
        <div className="portal-chrome">
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Customer portal preview</span>
          <div className="mono portal-url">myaccount.amplifiediot.co.bw/usage</div>
        </div>

        <div className="portal-head">
          <img src="/assets/at-mark.png" alt="Amplified IoT" style={{ height: 22, width: 'auto', display: 'block' }} />
          <div className="flex1" style={{ minWidth: 180 }}>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-.2px' }}>My Water Account</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Meter WM-104882 · Plot 21455, Block 8, Gaborone</div>
          </div>
          <nav style={{ display: 'flex', gap: 14 }}>
            {PORTAL_NAV.map((p) => {
              const on = p === 'Usage';
              return (
                <button key={p} type="button" aria-current={on ? 'page' : undefined}
                  style={{ fontSize: 11.5, fontWeight: on ? 600 : 500, color: on ? 'var(--navy)' : 'var(--muted)', borderBottom: `2px solid ${on ? 'var(--navy)' : 'transparent'}`, paddingBottom: 3 }}>
                  {p}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="portal-relation">
          <span className="badge" style={{ background: 'var(--navy-tint)', color: 'var(--navy)', padding: '3px 8px' }}>
            {owner ? 'Landlord · owner' : 'Tenant · occupant'}
          </span>
          <span className="flex1" style={{ fontSize: 11.5, color: 'var(--ink-4)', minWidth: 220 }}>
            {owner
              ? 'You own 14 metered properties across Gaborone. Tenants vend in their own names; vacant units bill to you.'
              : 'Meter WM-104882 is owned by Mpho Sebego (landlord). You buy water in your own name — credit stays on this meter.'}
          </span>
          <span className="label">Signed in as</span>
          <Segmented options={VIEWS} value={view} onChange={setView} tone="solid" labels={{ Tenant: 'Tenant view', Landlord: 'Landlord view' }} />
        </div>

        {owner && (
          <div style={{ padding: '16px 22px 0' }}>
            <div className="card clip">
              <div className="card-head" style={{ padding: '11px 15px', gap: 10, flexWrap: 'wrap' }}>
                <span className="card-title flex1">My properties · 14 meters</span>
                <span className="meta">13 let · 1 vacant · P 384.20 owed on vacant units</span>
                <button type="button" className="link" style={{ fontSize: 11 }}>Statement</button>
              </div>
              <div className="table-wrap">
                <table className="tbl">
                  <TableHead cols={[{ label: 'Meter' }, { label: 'Property' }, { label: 'Occupant' }, { label: 'Vending', align: 'right' }, { label: 'Usage MTD', align: 'right' }, { label: 'Balance', align: 'right' }]} />
                  <tbody>
                    {PORTFOLIO.map((p) => (
                      <tr key={p.meter}>
                        <td className="mono" style={{ color: 'var(--navy)' }}>{p.meter}</td>
                        <td>{p.plot}</td>
                        <td style={{ color: 'var(--ink-4)' }}>{p.tenant}</td>
                        <td className="num">
                          <span style={{ fontWeight: 600, fontSize: 11, color: p.tone, border: '1px solid var(--line)', padding: '2px 6px', borderRadius: 3 }}>{p.vends}</span>
                        </td>
                        <td className="mono num" style={{ color: 'var(--teal)' }}>{p.usage}</td>
                        <td className="mono num" style={{ color: p.balN < 0 ? 'var(--bad)' : 'var(--ink)' }}>{P(p.balN)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sub" style={{ padding: '9px 15px', borderTop: '1px solid var(--line-2)', lineHeight: 1.5 }}>
                Tenants buy water in their own names against these meters. You keep ownership, see every meter's usage and balance, and are billed directly only for vacant units.
              </div>
            </div>
          </div>
        )}

        <div className="grid portal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <div className="grid g-3">
              {STATS.map((s) => (
                <div key={s.label} className="card" style={{ padding: '13px 14px', background: 'var(--surface-2)' }}>
                  <div className="label" style={{ marginBottom: 7 }}>{s.label}</div>
                  <div style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.6px', color: s.tone }}>{s.value}</div>
                  <div className="sub" style={{ marginTop: 5 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className="card-title">Usage history</div>
                <div className="meta">litres per month · 12 months</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 140 }}>
                {USAGE.map((v, i) => (
                  <div key={MONTHS[i]} title={`${MONTHS[i]} · ${litres(v)}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 5, height: '100%' }}>
                    <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--muted)' }}>{(v / 1000).toFixed(1)}k</span>
                    <div style={{ width: '100%', borderRadius: '3px 3px 0 0', background: i === 11 ? 'var(--navy)' : '#9CCBC8', height: ((v / umax) * 100).toFixed(1) + '%' }} />
                    <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--faint)' }}>{MONTHS[i]}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card clip">
              <div className="card-head" style={{ padding: '11px 15px' }}><span className="card-title">Purchase history</span></div>
              <div className="table-wrap">
                <table className="tbl">
                  <TableHead cols={[{ label: 'Date' }, { label: 'Token' }, { label: 'Channel' }, { label: 'Units', align: 'right' }, { label: 'Amount', align: 'right' }]} />
                  <tbody>
                    {PURCHASES.map(([date, token, channel, units, amount]) => (
                      <tr key={token}>
                        <td style={{ color: 'var(--ink-4)' }}>{date}</td>
                        <td className="mono">{token}</td>
                        <td style={{ color: 'var(--muted)' }}>{channel}</td>
                        <td className="mono num" style={{ color: 'var(--teal)' }}>{units}</td>
                        <td className="mono num" style={{ fontWeight: 600 }}>{amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ padding: '15px 16px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--navy)', marginBottom: 8 }}>Current balance</div>
              <div style={{ fontWeight: 600, fontSize: 30, letterSpacing: '-1.2px', color: 'var(--navy)' }}>P 142.60</div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>≈ 14,260 L at current tariff · about 19 days left</div>
              <button type="button" className="btn-primary" style={{ marginTop: 13, width: '100%', padding: 9, borderRadius: 7, fontSize: 12 }}>Buy water</button>
              <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                {['P 50', 'P 100', 'P 200'].map((q) => (
                  <button key={q} type="button" className="mono quick-buy">{q}</button>
                ))}
              </div>
            </div>

            <div className="card" style={{ padding: '14px 15px' }}>
              <div className="card-title" style={{ marginBottom: 10 }}>Meter data</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {METER_DATA.map((m) => (
                  <div key={m.k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, paddingBottom: 8, borderBottom: '1px solid var(--line-3)' }}>
                    <span className="flex1" style={{ color: 'var(--muted)' }}>{m.k}</span>
                    <span className="mono" style={{ fontSize: 11, color: m.tone ?? 'var(--ink)' }}>{m.v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ border: '1px solid #EFDDB8', borderRadius: 8, padding: '13px 15px', background: '#FBF6EC' }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--warn-ink)', marginBottom: 6 }}>Leak advisory</div>
              <div style={{ fontSize: 11.5, color: '#6B4200', lineHeight: 1.5 }}>
                Continuous flow of 42 L/h detected between 01:00 and 05:00 on 17 Aug. Check internal plumbing or log a technician visit.
              </div>
              <button type="button" style={{ marginTop: 10, fontSize: 11, fontWeight: 600, color: 'var(--warn-ink)' }}>Report a problem</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
