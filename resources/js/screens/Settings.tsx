import { router, useForm, usePage } from '@inertiajs/react';
import { useState, type FormEvent } from 'react';
import { Badge, Card, Switch, TableHead } from '../components/ui';
import { Field, Modal, toast } from '../components/overlay';
import { MODULES } from '../data/admin';
import { initials } from '../data/format';
import { NAV, TITLES, type Screen } from '../routes';
import { useAuth, type Role } from '../auth';

const TABS = ['Users', 'Roles & access', 'Modules'] as const;
type Tab = (typeof TABS)[number];

interface User { id: number; name: string; email: string; role: Role; title: string | null; scope: string | null; status: 'Active' | 'Pending' | 'Suspended'; seen: string; twoFactor: boolean }
interface RoleAccess { role: Role; label: string; screens: Screen[] }
interface Props { users: User[]; roles: RoleAccess[]; screens: Screen[]; [key: string]: unknown }

const SCOPES = ['All zones', 'Gaborone', 'Block 8, Block 9', 'Old Naledi', 'CBD counter', 'Read-only, all', 'Network only'];
const SCREEN_LABEL = Object.fromEntries(NAV.flatMap((n) => ('screen' in n ? [[n.screen, n.label]] : []))) as Record<Screen, string>;

export function Settings() {
  const { users, roles, screens } = usePage<Props>().props;
  const [tab, setTab] = useState<Tab>('Users');
  const [modules, setModules] = useState(() => MODULES.map((m) => m[3]));
  const [editing, setEditing] = useState<User | 'new' | null>(null);

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
            <span className="card-title flex1">Users · {users.length} account{users.length === 1 ? '' : 's'}</span>
            <button type="button" className="btn-primary" onClick={() => setEditing('new')}>+ Invite user</button>
          </div>
          <div className="table-wrap">
            <table className="tbl compact roomy">
              <TableHead cols={[{ label: 'User' }, { label: 'Role' }, { label: 'Scope' }, { label: '2FA' }, { label: 'Last seen' }, { label: 'Status', align: 'right' }, { label: '', align: 'right' }]} />
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span className="avatar" style={{ width: 24, height: 24, background: 'var(--line-2)' }}>{initials(u.name)}</span>
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 600 }}>{u.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><div>{roles.find((r) => r.role === u.role)?.label ?? u.role}</div>{u.title && <div className="sub">{u.title}</div>}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{u.scope || '—'}</td>
                    <td style={{ fontSize: 11, color: u.twoFactor ? 'var(--ok-ink)' : 'var(--muted)' }}>{u.twoFactor ? 'On' : 'Off'}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{u.seen}</td>
                    <td className="num"><Badge status={u.status} /></td>
                    <td className="num" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {u.status === 'Pending' && (
                        <button type="button" className="link" style={{ marginRight: 10 }} onClick={() => router.post(`/settings/users/${u.id}/invite`, {}, { preserveScroll: true })}>Resend invite</button>
                      )}
                      <button type="button" className="link" onClick={() => setEditing(u)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'Roles & access' && (
        <Card style={{ overflow: 'auto' }}>
          <table className="tbl compact roomy matrix" style={{ minWidth: 760 }}>
            <TableHead cols={[{ label: 'Screen' }, ...roles.map((r) => ({ label: r.label, align: 'center' as const }))]} />
            <tbody>
              {screens.map((s) => (
                <tr key={s}>
                  <td><span style={{ fontWeight: 500 }}>{SCREEN_LABEL[s] ?? TITLES[s][1]}</span> <span className="sub">· {TITLES[s][0]}</span></td>
                  {roles.map((r) => {
                    const on = r.screens.includes(s);
                    return <td key={r.role} className={on ? 'on' : 'off'} style={{ textAlign: 'center' }} aria-label={`${r.label}: ${on ? 'can open' : 'no access'}`}>{on ? '✓' : '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sub" style={{ padding: '10px 16px', borderTop: '1px solid var(--line-2)', lineHeight: 1.5 }}>
            The server enforces this: a role is only served the screens ticked here, and anything else redirects to the role’s first screen. Access is defined per role in <span className="mono">app/Enums/Role.php</span>; change a person’s access by changing their role.
          </div>
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

      {editing && <UserDialog user={editing === 'new' ? null : editing} roles={roles} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserDialog({ user, roles, onClose }: { user: User | null; roles: RoleAccess[]; onClose: () => void }) {
  const { user: me } = useAuth();
  const self = user?.id === me?.id;
  const form = useForm({
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: user?.role ?? ('Finance' as Role),
    title: user?.title ?? '',
    scope: user?.scope ?? SCOPES[0],
    status: user?.status ?? 'Pending',
  });
  const { data, setData, errors } = form;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const opts = { preserveScroll: true, onSuccess: onClose };
    if (user) form.put(`/settings/users/${user.id}`, opts);
    else {
      form.transform(({ status: _s, ...rest }) => rest);
      form.post('/settings/users', opts);
    }
  };
  return (
    <Modal title={user ? `Edit ${user.name}` : 'Invite user'} onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" form="user-form" className="btn-primary" disabled={form.processing}>{user ? 'Save changes' : 'Send invitation'}</button>
    </>}>
      <form id="user-form" onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <div className="form-row">
          <Field label="Full name" error={errors.name}><input value={data.name} onChange={(e) => setData('name', e.target.value)} /></Field>
          <Field label="Email" error={errors.email}><input type="email" value={data.email} onChange={(e) => setData('email', e.target.value)} placeholder="name@wuc.co.bw" /></Field>
        </div>
        <div className="form-row">
          <Field label="Role" error={errors.role} hint={self ? 'You can’t change your own role.' : undefined}>
            <select value={data.role} disabled={self} onChange={(e) => setData('role', e.target.value as Role)}>{roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</select>
          </Field>
          <Field label="Job title" error={errors.title}><input value={data.title} onChange={(e) => setData('title', e.target.value)} placeholder="Revenue analyst" /></Field>
        </div>
        <div className="form-row">
          <Field label="Scope" error={errors.scope}><select value={data.scope} onChange={(e) => setData('scope', e.target.value)}>{SCOPES.concat(SCOPES.includes(data.scope) ? [] : [data.scope]).map((r) => <option key={r}>{r}</option>)}</select></Field>
          {user && (
            <Field label="Status" error={errors.status}>
              <select value={data.status} disabled={self} onChange={(e) => setData('status', e.target.value as User['status'])}>
                <option>Active</option><option>Suspended</option>{user.status === 'Pending' && <option>Pending</option>}
              </select>
            </Field>
          )}
        </div>
        <div className="sub" style={{ lineHeight: 1.5 }}>
          {user
            ? 'Suspending someone signs them out straight away and blocks sign-in until they are reactivated.'
            : 'They’ll get an email with a link to set their password. The account shows as Pending until they do.'}
        </div>
      </form>
    </Modal>
  );
}
