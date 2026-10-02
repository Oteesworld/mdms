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
      <div className="login-card card">
        <div className="brand" style={{ border: 0, padding: 0, height: 'auto', justifyContent: 'center', marginBottom: 22 }}>
          <img src="/assets/at-mark.png" alt="Amplified Trends" style={{ height: 30 }} />
          <span className="brand-bar" style={{ height: 36 }} />
          <div className="brand-word"><span style={{ fontSize: 16 }}>AMPLIFIED</span><span style={{ fontSize: 11.5 }}>IoT</span></div>
        </div>
        <h1 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 4px', letterSpacing: '-.01em' }}>Sign in</h1>
        <p className="sub" style={{ margin: '0 0 18px', fontSize: 11.5 }}>Smart water metering · LoRaWAN network management</p>

        <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--ink-4)' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Keep me signed in on this device
          </label>
          {error && <div role="alert" className="login-error">{error}</div>}
          <button type="submit" className="btn-primary" style={{ padding: 10, fontSize: 12.5, borderRadius: 7 }}>Sign in</button>
        </form>

        <div className="login-demo">
          <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 8 }}>
            <span className="label flex1">Demo accounts</span>
            <span className="meta">password {DEMO_PASSWORD}</span>
          </div>
          {ACCOUNTS.map((a) => (
            <button key={a.email} type="button" className="login-account" onClick={() => fill(a.email)}>
              <span className="flex1" style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 11.5 }}>{a.name}</span>
                <span className="mono ellipsis" style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>{a.email}</span>
              </span>
              <span className="badge" style={{ background: a.suspended ? 'var(--line-3)' : 'var(--navy-tint)', color: a.suspended ? 'var(--muted)' : 'var(--navy)' }}>
                {a.suspended ? 'Suspended' : a.role}
              </span>
            </button>
          ))}
          <p className="sub" style={{ margin: '10px 0 0', lineHeight: 1.5 }}>
            Demo sign-in: accounts are checked in the browser and don’t protect real data.
          </p>
        </div>
      </div>
    </div>
  );
}
