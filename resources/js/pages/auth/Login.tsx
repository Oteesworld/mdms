import { Link, useForm } from '@inertiajs/react';
import type { FormEvent } from 'react';
import { AuthLayout } from '../../components/AuthLayout';
import { Field } from '../../components/overlay';

interface DemoAccount { name: string; email: string; role: string; status: string }

export default function Login({ status, canResetPassword, demo }: {
  status?: string | null;
  canResetPassword: boolean;
  demo: { password: string; accounts: DemoAccount[] } | null;
}) {
  const form = useForm({ email: '', password: '', remember: true });
  const { data, setData, errors, processing } = form;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    form.post('/login', { onFinish: () => form.reset('password') });
  };

  return (
    <AuthLayout title="Sign in" intro="Smart water metering and LoRaWAN network management">
      {status && <div className="login-status" role="status">{status}</div>}
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Work email" error={errors.email}>
          <input type="email" name="email" autoComplete="username" value={data.email} autoFocus required
            onChange={(e) => setData('email', e.target.value)} />
        </Field>
        <Field label="Password" error={errors.password}>
          <input type="password" name="password" autoComplete="current-password" value={data.password} required
            onChange={(e) => setData('password', e.target.value)} />
        </Field>
        <div className="login-links">
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--ink-4)' }}>
            <input type="checkbox" checked={data.remember} onChange={(e) => setData('remember', e.target.checked)} />
            Keep me signed in
          </label>
          {canResetPassword && <Link href="/forgot-password">Forgot password?</Link>}
        </div>
        <button type="submit" className="btn-primary login-submit" disabled={processing}>{processing ? 'Signing in…' : 'Sign in'}</button>
      </form>

      {demo && (
        <details className="login-demo">
          <summary>Use a demo account</summary>
          <div style={{ display: 'flex', alignItems: 'baseline', margin: '10px 0 6px' }}>
            <span className="sub flex1">Click an account to fill the form.</span>
            <span className="meta">password {demo.password}</span>
          </div>
          {demo.accounts.map((a) => {
            const active = a.status === 'Active';
            return (
              <button key={a.email} type="button" className="login-account" onClick={() => { form.clearErrors(); setData({ ...data, email: a.email, password: demo.password }); }}>
                <span className="flex1" style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 11.5 }}>{a.name}</span>
                  <span className="mono ellipsis" style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{a.email}</span>
                </span>
                <span className="badge" style={{ background: active ? 'var(--navy-tint)' : 'var(--line-3)', color: active ? 'var(--navy)' : 'var(--muted)' }}>
                  {active ? a.role : a.status}
                </span>
              </button>
            );
          })}
          <p className="sub" style={{ margin: '10px 0 0', lineHeight: 1.5 }}>Demo mode is on (MDMS_DEMO). Turn it off on a live server.</p>
        </details>
      )}
    </AuthLayout>
  );
}
