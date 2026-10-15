import { useEffect, useState } from 'react';
import type { IconName } from './components/Icon';

export type Screen =
  | 'dash' | 'map' | 'reports'
  | 'mdm' | 'vee' | 'vending'
  | 'operations'
  | 'network' | 'gateways' | 'sites'
  | 'domestic' | 'business' | 'gov'
  | 'meters' | 'bulk'
  | 'portal' | 'settings';

type NavEntry = { group: string } | { screen: Screen & IconName; label: string; badge?: string };

export const NAV: NavEntry[] = [
  { group: 'Analytics' }, { screen: 'dash', label: 'Dashboard' }, { screen: 'map', label: 'Network map' }, { screen: 'reports', label: 'Reports' },
  { group: 'Meter data' }, { screen: 'mdm', label: 'Data pipeline' }, { screen: 'vee', label: 'Validation (VEE)', badge: '1.6k' }, { screen: 'vending', label: 'Vending' },
  { group: 'Network' }, { screen: 'network', label: 'LoRaWAN', badge: '3' }, { screen: 'gateways', label: 'Gateways' }, { screen: 'sites', label: 'Sites' }, { screen: 'operations', label: 'Field operations' },
  { group: 'Clients' }, { screen: 'domestic', label: 'Domestic' }, { screen: 'business', label: 'Business' }, { screen: 'gov', label: 'Government' },
  { group: 'Assets' }, { screen: 'meters', label: 'Meters' }, { screen: 'bulk', label: 'Bulk meters' },
  { group: 'Portal' }, { screen: 'portal', label: 'Customer portal' },
  { group: 'System' }, { screen: 'settings', label: 'Settings' },
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
};

const parse = (): [Screen, string | undefined] => {
  const [s, param] = window.location.hash.replace(/^#\/?/, '').split('/') as [Screen, string | undefined];
  return s in TITLES ? [s, param || undefined] : ['dash', undefined];
};

/** Minimal hash router: `#/map`, `#/domestic`, `#/domestic/3` (screen + optional param). */
export function useScreen(): [Screen, (s: Screen, param?: string | number) => void, string | undefined] {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [route[0], (s, param) => { window.location.hash = '/' + s + (param !== undefined ? '/' + param : ''); }, route[1]];
}
