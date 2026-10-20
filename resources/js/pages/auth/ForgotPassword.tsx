import { Link, useForm } from '@inertiajs/react';
import type { FormEvent } from 'react';
import { AuthLayout } from '../../components/AuthLayout';
import { Field } from '../../components/overlay';

export default function ForgotPassword({ status }: { status?: string | null }) {
  const form = useForm({ email: '' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    form.post('/forgot-password');
  };
  return (
    <AuthLayout title="Reset your password" intro="Enter your work email and we’ll send you a link to choose a new password.">
      {status && <div className="login-status" role="status">{status}</div>}
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Work email" error={form.errors.email}>
          <input type="email" autoComplete="username" value={form.data.email} autoFocus required onChange={(e) => form.setData('email', e.target.value)} />
        </Field>
        <button type="submit" className="btn-primary login-submit" disabled={form.processing}>{form.processing ? 'Sending…' : 'Email reset link'}</button>
        <Link href="/login" className="auth-back">← Back to sign in</Link>
      </form>
    </AuthLayout>
  );
}
