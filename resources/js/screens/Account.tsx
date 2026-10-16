import { router, useForm } from '@inertiajs/react';
import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { Badge, Card } from '../components/ui';
import { Field, Modal, toast } from '../components/overlay';
import { initials } from '../data/format';
import { http, HttpError } from '../lib/http';

/** My account: profile, password and two-factor authentication (Laravel Fortify endpoints). */
export function AccountScreen() {
  const { user } = useAuth();
  const u = user!;
  return (
    <div className="account-grid">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Card style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="avatar" style={{ width: 48, height: 48, fontSize: 16 }}>{initials(u.name)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{u.name}</div>
              <div className="sub">{u.email}</div>
            </div>
          </div>
          <div className="kv" style={{ marginTop: 16 }}>
            <div><span>Role</span><span>{u.roleLabel}</span></div>
            <div><span>Title</span><span>{u.title || '—'}</span></div>
            <div><span>Scope</span><span>{u.scope || '—'}</span></div>
            <div><span>Audit handle</span><span className="mono">{u.handle}</span></div>
          </div>
          <div className="sub" style={{ marginTop: 12 }}>Your role and scope are set by an administrator in Settings → Users.</div>
        </Card>
        <PasswordCard />
      </div>
      <TwoFactorCard enabled={u.twoFactor} />
    </div>
  );
}

function PasswordCard() {
  const form = useForm({ current_password: '', password: '', password_confirmation: '' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    form.put('/user/password', {
      errorBag: 'updatePassword',
      preserveScroll: true,
      onSuccess: () => { form.reset(); toast('Password changed'); },
      onError: () => form.reset('password', 'password_confirmation'),
    });
  };
  return (
    <Card style={{ padding: '18px 20px' }}>
      <div className="card-title" style={{ marginBottom: 12 }}>Change password</div>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Current password" error={form.errors.current_password}>
          <input type="password" autoComplete="current-password" value={form.data.current_password} onChange={(e) => form.setData('current_password', e.target.value)} />
        </Field>
        <div className="form-row">
          <Field label="New password" error={form.errors.password}>
            <input type="password" autoComplete="new-password" value={form.data.password} onChange={(e) => form.setData('password', e.target.value)} />
          </Field>
          <Field label="Confirm new password" error={form.errors.password_confirmation}>
            <input type="password" autoComplete="new-password" value={form.data.password_confirmation} onChange={(e) => form.setData('password_confirmation', e.target.value)} />
          </Field>
        </div>
        <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start' }} disabled={form.processing}>Update password</button>
      </form>
    </Card>
  );
}

type Step = 'idle' | 'setup' | 'codes';

function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const [step, setStep] = useState<Step>('idle');
  const [qr, setQr] = useState<{ svg: string; secret: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = usePasswordConfirm();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      if (!(await confirm.ensure())) return;
      await fn();
    } catch (e) {
      setError(e instanceof HttpError ? e.field('code') ?? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const loadCodes = async () => setCodes(await http<string[]>('GET', '/user/two-factor-recovery-codes'));

  const start = () => run(async () => {
    await http('POST', '/user/two-factor-authentication');
    const [q, s] = await Promise.all([
      http<{ svg: string }>('GET', '/user/two-factor-qr-code'),
      http<{ secretKey: string }>('GET', '/user/two-factor-secret-key'),
    ]);
    setQr({ svg: q.svg, secret: s.secretKey });
    setCode('');
    setStep('setup');
  });

  const verify = (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) { setError('Enter the 6-digit code from your app.'); return; }
    run(async () => {
      await http('POST', '/user/confirmed-two-factor-authentication', { code });
      await loadCodes();
      setStep('codes');
      router.reload({ only: ['auth'] });
      toast('Two-factor authentication is on');
    });
  };

  const disable = () => run(async () => {
    await http('DELETE', '/user/two-factor-authentication');
    setStep('idle');
    setCodes([]);
    router.reload({ only: ['auth'] });
    toast('Two-factor authentication turned off', 'warn');
  });

  return (
    <Card style={{ padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="card-title flex1">Two-factor authentication</span>
        <Badge status={enabled ? 'Verified' : 'Pending'} label={enabled ? 'On' : 'Off'} />
      </div>
      <div className="sub" style={{ lineHeight: 1.55, marginBottom: 14 }}>
        Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) as well as your password when you sign in.
      </div>

      {step === 'setup' && qr && (
        <form onSubmit={verify} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="qr-box">
            <div className="qr" dangerouslySetInnerHTML={{ __html: qr.svg }} aria-label="QR code for your authenticator app" role="img" />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>1. Scan this with your app</div>
              <div className="sub" style={{ marginBottom: 8 }}>Or enter this key by hand:</div>
              <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all', background: 'var(--surface-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '6px 8px' }}>{qr.secret}</div>
            </div>
          </div>
          <Field label="2. Enter the 6-digit code it shows" error={error}>
            <input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} autoFocus
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }} style={{ maxWidth: 200 }} />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn-primary" disabled={busy}>Turn on</button>
            <button type="button" className="btn" disabled={busy} onClick={disable}>Cancel</button>
          </div>
        </form>
      )}

      {step === 'codes' && codes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>Recovery codes</div>
          <div className="sub" style={{ lineHeight: 1.5 }}>Keep these somewhere safe. Each one signs you in once if you lose your phone.</div>
          <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" className="link" style={{ fontSize: 11.5 }} onClick={() => { navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Recovery codes copied'), () => toast('Copy failed', 'warn')); }}>Copy</button>
            <button type="button" className="link" style={{ fontSize: 11.5 }} disabled={busy} onClick={() => run(async () => {
              await http('POST', '/user/two-factor-recovery-codes');
              await loadCodes();
              toast('New recovery codes generated; the old ones no longer work', 'info');
            })}>Generate new codes</button>
            <button type="button" className="link" style={{ fontSize: 11.5 }} onClick={() => setStep('idle')}>Hide</button>
          </div>
        </div>
      )}

      {step !== 'setup' && (
        <>
          {error && <div role="alert" className="login-error" style={{ marginBottom: 10 }}>{error}</div>}
          {enabled ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {step !== 'codes' && <button type="button" className="btn" disabled={busy} onClick={() => run(async () => { await loadCodes(); setStep('codes'); })}>Show recovery codes</button>}
              <button type="button" className="btn" disabled={busy} onClick={disable} style={{ color: 'var(--bad)' }}>Turn off</button>
            </div>
          ) : (
            <button type="button" className="btn-primary" disabled={busy} onClick={start}>Set up two-factor authentication</button>
          )}
        </>
      )}
      {confirm.dialog}
    </Card>
  );
}

/**
 * Fortify asks for the password again before two-factor changes. `ensure()` resolves true
 * once the password has been confirmed (recently or now), false if the user cancels.
 */
function usePasswordConfirm() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  const ensure = async () => {
    const { confirmed } = await http<{ confirmed: boolean }>('GET', '/user/confirmed-password-status');
    if (confirmed) return true;
    setPassword('');
    setError('');
    setOpen(true);
    return new Promise<boolean>((resolve) => { pending.current = resolve; });
  };
  const close = (ok: boolean) => {
    setOpen(false);
    pending.current?.(ok);
    pending.current = null;
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await http('POST', '/user/confirm-password', { password });
      close(true);
    } catch (err) {
      setError(err instanceof HttpError ? err.field('password') ?? err.message : 'Could not confirm your password.');
    } finally {
      setBusy(false);
    }
  };

  const dialog = open && (
    <Modal title="Confirm your password" onClose={() => close(false)} width={400} footer={<>
      <button type="button" className="btn" onClick={() => close(false)}>Cancel</button>
      <button type="submit" form="confirm-pw" className="btn-primary" disabled={busy}>Confirm</button>
    </>}>
      <form id="confirm-pw" onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <div className="sub">For your security, enter your password to change two-factor settings.</div>
        <Field label="Password" error={error}>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} />
        </Field>
      </form>
    </Modal>
  );
  return { ensure, dialog };
}
