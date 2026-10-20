import { Head } from '@inertiajs/react';
import type { ReactNode } from 'react';

/** Split sign-in layout: the logo over the meter photo on the left, the form on the right. */
export function AuthLayout({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="login-page">
      <Head title={title} />
      <section className="login-brand" aria-label="Leeroy Systems">
        <img src="/assets/leeroy-logo.png" alt="Leeroy Systems" />
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-.02em' }}>{title}</h1>
          {intro && <p className="sub" style={{ margin: '0 0 26px', fontSize: 12.5, lineHeight: 1.5 }}>{intro}</p>}
          {children}
        </div>
      </section>
    </div>
  );
}
