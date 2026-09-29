import { useState } from 'react';
import { Badge, Card, Switch, TableHead } from '../components/ui';
import { MODULES, ROLE_COLS, ROLES, USERS } from '../data/admin';
import { initials } from '../data/format';

const TABS = ['Users', 'Roles & permissions', 'Modules'] as const;
type Tab = (typeof TABS)[number];

const LEVEL = [
  { mark: '—', color: '#C9CED6' },
  { mark: 'Limited', color: '#767E89' },
  { mark: 'Full', color: '#181D23' },
];

export function Settings() {
  const [tab, setTab] = useState<Tab>('Users');
  const [modules, setModules] = useState(() => MODULES.map((m) => m[3]));

  return (
    <div>
      <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap' }} role="tablist">
        {TABS.map((t) => {
          const on = t === tab;
          return (
            <button key={t} type="button" role="tab" aria-selected={on} onClick={() => setTab(t)}
              style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: on ? 600 : 500, background: on ? 'var(--navy)' : '#fff', color: on ? '#fff' : 'var(--ink-4)', border: `1px solid ${on ? 'var(--navy)' : 'var(--line)'}` }}>
              {t}
            </button>
          );
        })}
      </div>

      {tab === 'Users' && (
        <Card clip>
          <div className="card-head" style={{ padding: '11px 14px' }}>
            <span className="card-title flex1">Users · 34 accounts</span>
            <button type="button" className="btn-primary">+ Invite user</button>
          </div>
          <div className="table-wrap">
            <table className="tbl compact roomy">
              <TableHead cols={[{ label: 'User' }, { label: 'Role' }, { label: 'Scope' }, { label: 'Last seen' }, { label: 'Status', align: 'right' }, { label: '', align: 'right' }]} />
              <tbody>
                {USERS.map(([name, email, role, scope, seen, status]) => (
                  <tr key={email + name}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span className="avatar" style={{ width: 24, height: 24, background: 'var(--line-2)' }}>{initials(name)}</span>
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 600 }}>{name}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{email}</div>
                        </div>
                      </div>
                    </td>
                    <td>{role}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{scope}</td>
                    <td className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{seen}</td>
                    <td className="num"><Badge status={status} /></td>
                    <td className="num" style={{ fontSize: 11 }}><button type="button" className="link">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'Roles & permissions' && (
        <Card style={{ overflow: 'auto' }}>
          <table className="tbl compact roomy" style={{ minWidth: 760 }}>
            <TableHead cols={[{ label: 'Capability' }, ...ROLE_COLS.map((c) => ({ label: c, align: 'center' as const }))]} />
            <tbody>
              {ROLES.map(([cap, levels]) => (
                <tr key={cap}>
                  <td>{cap}</td>
                  {levels.map((v, i) => (
                    <td key={i} style={{ textAlign: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: LEVEL[v].color }}>{LEVEL[v].mark}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'Modules' && (
        <div className="grid g-3">
          {MODULES.map(([name, desc, meta], i) => (
            <Card key={name} style={{ padding: '13px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
                <span className="card-title flex1">{name}</span>
                <Switch large on={modules[i]} label={name} onClick={() => setModules((m) => m.map((v, j) => (j === i ? !v : v)))} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45 }}>{desc}</div>
              <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--line-3)', fontWeight: 500, fontSize: 11, color: 'var(--muted)' }}>{meta}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
