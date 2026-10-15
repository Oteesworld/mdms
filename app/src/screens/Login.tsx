import { useState, type FormEvent } from 'react';
import { ACCOUNTS, DEMO_PASSWORD, signIn } from '../auth';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const emailOk = EMAIL.test(email.trim());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!emailOk || !password) return;
    const r = signIn(email, password, remember);
    if (!r.ok) setError(r.error);
  };

  const fill = (addr: string) => {
    setEmail(addr);
    setPassword(DEMO_PASSWORD);
    setError('');
  };

  return (
    <div className="login-page">
      <section className="login-brand" aria-label="Leeroy Systems">
        <img src="/assets/leeroy-logo.png" alt="Leeroy Systems" />
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-.02em' }}>Sign in</h1>
          <p className="sub" style={{ margin: '0 0 26px', fontSize: 12.5 }}>Smart water metering and LoRaWAN network management</p>

          <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className={`form-field${touched && !emailOk ? ' invalid' : ''}`}>
              <span>Work email</span>
              <input type="email" autoComplete="username" value={email} autoFocus
                onChange={(e) => { setEmail(e.target.value); setError(''); }} />
              {touched && !emailOk && <span className="form-error">Enter a valid email address.</span>}
            </label>
            <label className={`form-field${touched && !password ? ' invalid' : ''}`}>
              <span>Password</span>
              <input type="password" autoComplete="current-password" value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }} />
              {touched && !password && <span className="form-error">Enter your password.</span>}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--ink-4)' }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Keep me signed in on this device
            </label>
            {error && <div role="alert" className="login-error">{error}</div>}
            <button type="submit" className="btn-primary login-submit">Sign in</button>
          </form>

          <details className="login-demo">
            <summary>Use a demo account</summary>
            <div style={{ display: 'flex', alignItems: 'baseline', margin: '10px 0 6px' }}>
              <span className="sub flex1">Click an account to fill the form.</span>
              <span className="meta">password {DEMO_PASSWORD}</span>
            </div>
            {ACCOUNTS.map((a) => (
              <button key={a.email} type="button" className="login-account" onClick={() => fill(a.email)}>
                <span className="flex1" style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 11.5 }}>{a.name}</span>
                  <span className="mono ellipsis" style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{a.email}</span>
                </span>
                <span className="badge" style={{ background: a.suspended ? 'var(--line-3)' : 'var(--navy-tint)', color: a.suspended ? 'var(--muted)' : 'var(--navy)' }}>
                  {a.suspended ? 'Suspended' : a.role}
                </span>
              </button>
            ))}
            <p className="sub" style={{ margin: '10px 0 0', lineHeight: 1.5 }}>
              Demo sign-in: accounts are checked in the browser and don’t protect real data.
            </p>
          </details>
        </div>
      </section>
    </div>
  );
}
