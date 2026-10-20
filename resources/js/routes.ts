import { router, usePage } from '@inertiajs/react';
import type { IconName } from './components/Icon';

export type Screen =
  | 'dash' | 'map' | 'reports'
  | 'mdm' | 'vee' | 'vending'
  | 'operations'
  | 'network' | 'gateways' | 'sites'
  | 'domestic' | 'business' | 'gov'
  | 'meters' | 'bulk'
  | 'portal' | 'settings' | 'account';

type NavEntry = { group: string } | { screen: Screen & IconName; label: string; badge?: string };

export const NAV: NavEntry[] = [
  { group: 'Analytics' }, { screen: 'dash', label: 'Dashboard' }, { screen: 'map', label: 'Network map' }, { screen: 'reports', label: 'Reports' },
  { group: 'Meter data' }, { screen: 'mdm', label: 'Data pipeline' }, { screen: 'vee', label: 'Validation (VEE)', badge: '1.6k' }, { screen: 'vending', label: 'Vending' },
  { group: 'Network' }, { screen: 'network', label: 'LoRaWAN', badge: '3' }, { screen: 'gateways', label: 'Gateways' }, { screen: 'sites', label: 'Sites' }, { screen: 'operations', label: 'Field operations' },
  { group: 'Clients' }, { screen: 'domestic', label: 'Domestic' }, { screen: 'business', label: 'Business' }, { screen: 'gov', label: 'Government' },
  { group: 'Assets' }, { screen: 'meters', label: 'Meters' }, { screen: 'bulk', label: 'Bulk meters' },
  { group: 'Portal' }, { screen: 'portal', label: 'Customer portal' },
  { group: 'System' }, { screen: 'settings', label: 'Settings' }, { screen: 'account', label: 'My account' },
];

export const TITLES: Record<Screen, [crumb: string, title: string]> = {
  dash: ['Analytics', 'Sales and usage'],
  map: ['Analytics', 'Network map'],
  reports: ['Analytics', 'Reports'],
  mdm: ['Meter data', 'Meter data pipeline'],
  vee: ['Meter data', 'Validation, estimation and editing'],
  vending: ['Meter data', 'Vending validation'],
  operations: ['Network', 'Work orders and remote commands'],
  network: ['Network', 'LoRaWAN network health'],
  gateways: ['Network', 'Gateways'],
  sites: ['Network', 'Sites and zones'],
  domestic: ['Clients', 'Domestic clients'],
  business: ['Clients', 'Business clients'],
  gov: ['Clients', 'Government accounts'],
  meters: ['Assets', 'Meter register'],
  bulk: ['Assets', 'Bulk meters'],
  portal: ['Portal', 'Customer portal'],
  settings: ['System', 'Settings'],
  account: ['System', 'My account'],
};

/** URL of a screen: `/map`, `/domestic`, `/domestic/3` (screen + optional param). */
export const screenUrl = (s: Screen, param?: string | number) => '/' + s + (param !== undefined ? '/' + param : '');

/** Navigate to a screen without a full page load. */
export const goTo = (s: Screen, param?: string | number) => router.visit(screenUrl(s, param));

/** The screen Laravel served (`/{screen}/{param?}`) and a function to move to another. */
export function useScreen(): [Screen, (s: Screen, param?: string | number) => void, string | undefined] {
  const { screen, param } = usePage<{ screen: Screen; param?: string | null }>().props;
  return [screen, goTo, param ?? undefined];
}
