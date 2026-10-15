import { useState, type FormEvent } from 'react';
import { Badge, Card, Switch, TableHead } from '../components/ui';
import { Field, Modal, toast } from '../components/overlay';
import { MODULES, ROLE_COLS, ROLES, USERS } from '../data/admin';
import { initials } from '../data/format';

const TABS = ['Users', 'Roles & permissions', 'Modules'] as const;
type Tab = (typeof TABS)[number];

const LEVEL = [
  { mark: '—', color: '#C9CED6' },
  { mark: 'Limited', color: '#767E89' },
  { mark: 'Full', color: '#181D23' },
];

interface User { name: string; email: string; role: string; scope: string; seen: string; status: string }
const ROLE_TITLES = ['Network Administrator', 'Operations Controller', 'Revenue Analyst', 'Finance Controller', 'Vendor Agent', 'Field Supervisor', 'Field Technician', 'Municipal Manager'];
const SCOPES = ['All zones', 'Gaborone', 'Block 8, Block 9', 'Old Naledi', 'CBD counter', 'Read-only, all', 'Network only'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Settings() {
  const [tab, setTab] = useState<Tab>('Users');
  const [modules, setModules] = useState(() => MODULES.map((m) => m[3]));
  const [users, setUsers] = useState<User[]>(() => USERS.map(([name, email, role, scope, seen, status]) => ({ name, email, role, scope, seen, status })));
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [roles, setRoles] = useState(() => ROLES.map(([cap, levels]) => ({ cap, levels: [...levels] })));

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
          <div className="card-head">
            <span className="card-title flex1">Users · {users.length + 26} accounts</span>
            <button type="button" className="btn-primary" onClick={() => setEditing('new')}>+ Invite user</button>
          </div>
          <div className="table-wrap">
            <table className="tbl compact roomy">
              <TableHead cols={[{ label: 'User' }, { label: 'Role' }, { label: 'Scope' }, { label: 'Last seen' }, { label: 'Status', align: 'right' }, { label: '', align: 'right' }]} />
              <tbody>
                {users.map((u) => { const { name, email, role, scope, seen, status } = u; return (
                  <tr key={email + name}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span className="avatar" style={{ width: 24, height: 24, background: 'var(--line-2)' }}>{initials(name)}</span>
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 600 }}>{name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{email}</div>
                        </div>
                      </div>
                    </td>
                    <td>{role}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{scope}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{seen}</td>
                    <td className="num"><Badge status={status} /></td>
                    <td className="num" style={{ fontSize: 11 }}><button type="button" className="link" onClick={() => setEditing(u)}>Edit</button></td>
                  </tr>
                ); })}
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
              {roles.map(({ cap, levels }, r) => (
                <tr key={cap}>
                  <td>{cap}</td>
                  {levels.map((v, i) => (
                    <td key={i} style={{ textAlign: 'center' }}>
                      <button type="button" className="perm" disabled={i === 0} title={i === 0 ? 'Admin always has full access' : 'Click to change'}
                        aria-label={`${cap} for ${ROLE_COLS[i]}: ${LEVEL[v].mark === '—' ? 'none' : LEVEL[v].mark}`}
                        style={{ color: LEVEL[v].color }}
                        onClick={() => setRoles((rs) => rs.map((row, j) => (j === r ? { ...row, levels: row.levels.map((x, k) => (k === i ? (x + 2) % 3 : x)) } : row)))}>
                        {LEVEL[v].mark}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sub" style={{ padding: '10px 16px', borderTop: '1px solid var(--line-2)' }}>Click a cell to cycle Full → Limited → none. Admin is fixed at full access.</div>
        </Card>
      )}

      {tab === 'Modules' && (
        <div className="grid g-3">
          {MODULES.map(([name, desc, meta], i) => (
            <Card key={name} style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
                <span className="card-title flex1">{name}</span>
                <Switch large on={modules[i]} label={name} onClick={() => { setModules((m) => m.map((v, j) => (j === i ? !v : v))); toast(`${name} ${modules[i] ? 'disabled' : 'enabled'}`, modules[i] ? 'warn' : 'ok'); }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45 }}>{desc}</div>
              <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--line-3)', fontWeight: 500, fontSize: 11, color: 'var(--muted)' }}>{meta}</div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <UserDialog
          user={editing === 'new' ? null : editing}
          taken={users.filter((u) => u !== editing).map((u) => u.email.toLowerCase())}
          onClose={() => setEditing(null)}
          onSave={(u) => {
            if (editing === 'new') { setUsers((us) => [u, ...us]); toast(`Invitation sent to ${u.email}`); }
            else { setUsers((us) => us.map((x) => (x === editing ? u : x))); toast(`${u.name} updated`); }
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function UserDialog({ user, taken, onClose, onSave }: { user: User | null; taken: string[]; onClose: () => void; onSave: (u: User) => void }) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState(user?.role ?? ROLE_TITLES[2]);
  const [scope, setScope] = useState(user?.scope ?? SCOPES[0]);
  const [status, setStatus] = useState(user?.status ?? 'Pending');
  const [touched, setTouched] = useState(false);
  const errors = {
    name: !name.trim() && 'Enter the person’s name.',
    email: !EMAIL.test(email.trim()) ? 'Enter a valid email address.' : taken.includes(email.trim().toLowerCase()) ? 'Someone already uses this email.' : '',
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (errors.name || errors.email) return;
    onSave({ name: name.trim(), email: email.trim(), role, scope, status, seen: user?.seen ?? 'Invited' });
  };
  return (
    <Modal title={user ? `Edit ${user.name}` : 'Invite user'} onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" form="user-form" className="btn-primary">{user ? 'Save changes' : 'Send invitation'}</button>
    </>}>
      <form id="user-form" onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <div className="form-row">
          <Field label="Full name" error={touched && errors.name}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email" error={touched && errors.email}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@wuc.co.bw" /></Field>
        </div>
        <div className="form-row">
          <Field label="Role"><select value={role} onChange={(e) => setRole(e.target.value)}>{ROLE_TITLES.concat(ROLE_TITLES.includes(role) ? [] : [role]).map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Scope"><select value={scope} onChange={(e) => setScope(e.target.value)}>{SCOPES.concat(SCOPES.includes(scope) ? [] : [scope]).map((r) => <option key={r}>{r}</option>)}</select></Field>
        </div>
        {user && (
          <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}><option>Active</option><option>Suspended</option><option>Pending</option></select></Field>
        )}
        {!user && <div className="sub">They’ll get an email to set a password. The account shows as Pending until they sign in.</div>}
      </form>
    </Modal>
  );
}
