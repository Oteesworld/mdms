/*
 * Demo sign-in. Accounts and passwords live in this bundle and are checked in
 * the browser, so this gates the UI for demos only — it does not secure data.
 * Replace with a real identity provider before any live data is connected.
 */
import { useSyncExternalStore } from 'react';
import type { Screen } from './routes';

export type Role = 'Admin' | 'Ops' | 'Finance' | 'Vendor' | 'Field';

export interface Account {
  email: string;
  name: string;
  /** Short handle used in audit trails and the command queue. */
  handle: string;
  title: string;
  role: Role;
  suspended?: boolean;
}

export const DEMO_PASSWORD = 'amplified2026';

export const ACCOUNTS: Account[] = [
  { email: 'l.kgosi@amplifiediot.co.bw', name: 'Leeroy Kgosi', handle: 'l.kgosi', title: 'Network administrator', role: 'Admin' },
  { email: 'k.ramotswe@wuc.co.bw', name: 'Kefilwe Ramotswe', handle: 'k.ramotswe', title: 'Operations controller', role: 'Ops' },
  { email: 't.phiri@wuc.co.bw', name: 'Tebogo Phiri', handle: 't.phiri', title: 'Finance controller', role: 'Finance' },
  { email: 'n.seretse@wuc.co.bw', name: 'Naledi Seretse', handle: 'n.seretse', title: 'Vendor agent · CBD counter', role: 'Vendor' },
  { email: 'k.moloi@wuc.co.bw', name: 'Kabelo Moloi', handle: 'k.moloi', title: 'Field supervisor', role: 'Field' },
  { email: 'a.dube@wuc.co.bw', name: 'Amogelang Dube', handle: 'a.dube', title: 'Field technician', role: 'Field', suspended: true },
];

/** Screens each role may open; the first one is the role's home screen. */
export const ACCESS: Record<Role, Screen[] | 'all'> = {
  Admin: 'all',
  Ops: ['dash', 'map', 'reports', 'mdm', 'vee', 'vending', 'network', 'gateways', 'sites', 'operations', 'domestic', 'business', 'gov', 'meters', 'bulk', 'portal'],
  Finance: ['dash', 'reports', 'vending', 'mdm', 'vee', 'domestic', 'business', 'gov', 'portal'],
  Vendor: ['domestic', 'business', 'vending', 'portal'],
  Field: ['map', 'operations', 'meters', 'bulk', 'network', 'gateways', 'sites'],
};

export const canOpen = (role: Role, s: Screen) => {
  const a = ACCESS[role];
  return a === 'all' || a.includes(s);
};
export const homeOf = (role: Role): Screen => {
  const a = ACCESS[role];
  return a === 'all' ? 'dash' : a[0];
};

/* ---------- Session ---------- */

const KEY = 'amplified-iot.session';
const listeners = new Set<() => void>();

const load = (): Account | null => {
  try {
    const email = localStorage.getItem(KEY);
    return ACCOUNTS.find((a) => a.email === email && !a.suspended) ?? null;
  } catch {
    return null;
  }
};

let current: Account | null = load();

const emit = () => listeners.forEach((l) => l());

export function useAccount(): Account | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** Current account for non-React callers (audit trail, command queue). */
export const currentHandle = () => current?.handle ?? 'unknown';

export type SignInResult = { ok: true; account: Account } | { ok: false; error: string };

export function signIn(email: string, password: string, remember: boolean): SignInResult {
  const account = ACCOUNTS.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
  if (!account || password !== DEMO_PASSWORD) return { ok: false, error: 'Email or password is incorrect.' };
  if (account.suspended) return { ok: false, error: 'This account is suspended. Ask an administrator to reactivate it.' };
  current = account;
  try {
    if (remember) localStorage.setItem(KEY, account.email);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: session lasts for this tab only */
  }
  emit();
  return { ok: true, account };
}

export function signOut() {
  current = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}
