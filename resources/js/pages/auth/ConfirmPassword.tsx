import { useForm } from '@inertiajs/react';
import type { FormEvent } from 'react';
import { AuthLayout } from '../../components/AuthLayout';
import { Field } from '../../components/overlay';

export default function ConfirmPassword() {
  const form = useForm({ password: '' });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    form.post('/user/confirm-password', { onFinish: () => form.reset() });
  };
  return (
    <AuthLayout title="Confirm your password" intro="This is a protected area. Confirm your password to continue.">
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Password" error={form.errors.password}>
          <input type="password" autoComplete="current-password" value={form.data.password} autoFocus onChange={(e) => form.setData('password', e.target.value)} />
        </Field>
        <button type="submit" className="btn-primary login-submit" disabled={form.processing}>Confirm</button>
      </form>
    </AuthLayout>
  );
}
