import { useEffect, useState } from 'react';
import type { IconName } from './components/Icon';

export type Screen =
  | 'dash' | 'map' | 'reports'
  | 'network' | 'gateways' | 'sites'
  | 'domestic' | 'business' | 'gov'
  | 'meters' | 'bulk'
  | 'portal' | 'settings';

type NavEntry = { group: string } | { screen: Screen & IconName; label: string; badge?: string };

export const NAV: NavEntry[] = [
  { group: 'Analytics' }, { screen: 'dash', label: 'Dashboard' }, { screen: 'map', label: 'Network map' }, { screen: 'reports', label: 'Reports' },
  { group: 'Network' }, { screen: 'network', label: 'LoRaWAN', badge: '3' }, { screen: 'gateways', label: 'Gateways' }, { screen: 'sites', label: 'Sites' },
  { group: 'Clients' }, { screen: 'domestic', label: 'Domestic' }, { screen: 'business', label: 'Business' }, { screen: 'gov', label: 'Government' },
  { group: 'Assets' }, { screen: 'meters', label: 'Meters' }, { screen: 'bulk', label: 'Bulk meters' },
  { group: 'Portal' }, { screen: 'portal', label: 'Customer portal' },
  { group: 'System' }, { screen: 'settings', label: 'Settings' },
];

export const TITLES: Record<Screen, [crumb: string, title: string]> = {
  dash: ['Analytics', 'Sales and usage'],
  map: ['Analytics', 'Network map'],
  reports: ['Analytics', 'Reports'],
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

const parse = (): Screen => {
  const s = window.location.hash.replace(/^#\/?/, '') as Screen;
  return s in TITLES ? s : 'dash';
};

/** Minimal hash router: `#/map`, `#/domestic`, … */
export function useScreen(): [Screen, (s: Screen) => void] {
  const [screen, setScreen] = useState<Screen>(parse);
  useEffect(() => {
    const onHash = () => setScreen(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [screen, (s) => { window.location.hash = '/' + s; }];
}
