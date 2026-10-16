import { Link, useForm } from '@inertiajs/react';
import { useState, type FormEvent } from 'react';
import { AuthLayout } from '../../components/AuthLayout';
import { Field } from '../../components/overlay';

/** Second sign-in step for accounts with two-factor authentication on. */
export default function TwoFactorChallenge() {
  const [recovery, setRecovery] = useState(false);
  const form = useForm({ code: '', recovery_code: '' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    form.transform((d) => (recovery ? { recovery_code: d.recovery_code } : { code: d.code }));
    form.post('/two-factor-challenge');
  };
  return (
    <AuthLayout
      title="Two-factor sign-in"
      intro={recovery ? 'Enter one of the recovery codes you saved when you turned on two-factor authentication.' : 'Open your authenticator app and enter the 6-digit code for Amplified IoT.'}
    >
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {recovery ? (
          <Field label="Recovery code" error={form.errors.recovery_code}>
            <input className="mono" autoComplete="one-time-code" value={form.data.recovery_code} autoFocus onChange={(e) => form.setData('recovery_code', e.target.value)} />
          </Field>
        ) : (
          <Field label="Authentication code" error={form.errors.code}>
            <input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={form.data.code} autoFocus
              onChange={(e) => form.setData('code', e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        <button type="submit" className="btn-primary login-submit" disabled={form.processing}>Verify</button>
        <div className="login-links">
          <button type="button" className="link" style={{ fontSize: 12 }} onClick={() => { setRecovery((r) => !r); form.clearErrors(); }}>
            {recovery ? 'Use an authentication code' : 'Use a recovery code'}
          </button>
          <Link href="/login" className="auth-back">Back to sign in</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
