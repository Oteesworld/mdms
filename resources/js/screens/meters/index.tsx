import { usePage } from '@inertiajs/react';
import { MeterDashboard } from './MeterDashboard';
import { MeterForm } from './MeterForm';
import { MeterRegister } from './MeterRegister';

/** /meters, /meters/new, /meters/{serial} and /meters/{serial}?edit=1 */
export function Meters({ param }: { param?: string }) {
  const props = usePage().props;
  if (!param) return <MeterRegister />;
  if ('form' in props) return <MeterForm key={param} />;
  return <MeterDashboard key={param} />;
}

export function meterTitle(param: string | undefined, props: Record<string, unknown>): string | null {
  if (!param) return null;
  if (param === 'new') return 'Add a meter';
  return 'form' in props ? 'Edit meter' : 'Meter dashboard';
}
