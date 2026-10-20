/*
 * The signed-in user, as shared by Laravel on every page (HandleInertiaRequests).
 * Sign-in happens on the server (Laravel Fortify). Role access is enforced there too;
 * `access` lists the screens the server will serve to this user.
 */
import { router, usePage } from '@inertiajs/react';
import type { Screen } from './routes';

export type Role = 'Admin' | 'Ops' | 'Finance' | 'Vendor' | 'Field';

export interface Account {
  id: number;
  name: string;
  email: string;
  /** Short handle used in audit trails and the command queue. */
  handle: string;
  role: Role;
  roleLabel: string;
  title: string | null;
  scope: string | null;
  twoFactor: boolean;
}

export interface SharedProps {
  auth: { user: Account | null; access: Screen[] };
  flash: { status?: string | null; toast?: string | null };
  errors: Record<string, string>;
  [key: string]: unknown;
}

export function useAuth() {
  const { auth } = usePage<SharedProps>().props;
  return { user: auth.user, access: auth.access, canOpen: (s: Screen) => auth.access.includes(s) };
}

let handle = 'unknown';

/** Remember who is signed in for non-React callers (audit trail, command queue). */
export const setCurrentHandle = (h: string) => { handle = h; };
export const currentHandle = () => handle;

export const signOut = () => router.post('/logout');
