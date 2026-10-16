import { Link, useForm } from '@inertiajs/react';
import type { FormEvent } from 'react';
import { AuthLayout } from '../../components/AuthLayout';
import { Field } from '../../components/overlay';

/** New password from a reset link, or a first password from an invitation (?invite=1). */
export default function ResetPassword({ email, token, invite }: { email: string; token: string; invite: boolean }) {
  const form = useForm({ token, email, password: '', password_confirmation: '' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    form.post('/reset-password', { onFinish: () => form.reset('password', 'password_confirmation') });
  };
  return (
    <AuthLayout
      title={invite ? 'Welcome to Amplified IoT' : 'Choose a new password'}
      intro={invite ? 'Set a password to activate your account. You’ll use it with your work email to sign in.' : 'Pick a password you haven’t used here before.'}
    >
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Work email" error={form.errors.email}>
          <input type="email" autoComplete="username" value={form.data.email} readOnly={!!email} onChange={(e) => form.setData('email', e.target.value)} />
        </Field>
        <Field label="New password" error={form.errors.password} hint="At least 10 characters, with upper and lower case letters and a number.">
          <input type="password" autoComplete="new-password" value={form.data.password} autoFocus onChange={(e) => form.setData('password', e.target.value)} />
        </Field>
        <Field label="Confirm password" error={form.errors.password_confirmation}>
          <input type="password" autoComplete="new-password" value={form.data.password_confirmation} onChange={(e) => form.setData('password_confirmation', e.target.value)} />
        </Field>
        <button type="submit" className="btn-primary login-submit" disabled={form.processing}>{invite ? 'Activate account' : 'Reset password'}</button>
        <Link href="/login" className="auth-back">← Back to sign in</Link>
      </form>
    </AuthLayout>
  );
}
