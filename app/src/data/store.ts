/* Tiny in-memory store for state shared across screens (work orders, downlink queue). */
import { useSyncExternalStore } from 'react';
import { currentHandle } from '../auth';
import { COMMAND_SEED, WORK_ORDERS, type Command, type CommandType, type WorkOrder } from './mdm';
import type { Property } from './clients';

interface State {
  workOrders: WorkOrder[];
  commands: Command[];
  /** Properties added in this session, by client ID. */
  addedProps: Record<string, Property[]>;
  /** Tenant assignments made in this session, by meter serial. */
  tenancy: Record<string, { tenant: string; vends: string }>;
}

let state: State = { workOrders: WORK_ORDERS, commands: COMMAND_SEED, addedProps: {}, tenancy: {} };
const listeners = new Set<() => void>();

const set = (fn: (s: State) => State) => {
  state = fn(state);
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => pick(state));
}

/** Meters behind the offline gateway never answer, so their downlinks fail. */
const UNREACHABLE = new Set(['WM-118920']);
let seq = 55121;
let woSeq = 31409;

export const METER_ID = /^WM-\d{6}$/;

/**
 * Queue a LoRaWAN downlink. Class A devices only listen after they uplink,
 * so the demo walks each command through Queued → Sent → Acknowledged/Failed.
 */
export function queueCommand(meter: string, cmd: CommandType, by = currentHandle()) {
  const id = 'DL-' + seq++;
  const patch = (p: Partial<Command>) =>
    set((s) => ({ ...s, commands: s.commands.map((c) => (c.id === id ? { ...c, ...p } : c)) }));
  set((s) => ({
    ...s,
    commands: [{ id, meter, cmd, by, at: '13:01', status: 'Queued', note: 'Waiting for next uplink (class A)' }, ...s.commands],
  }));
  setTimeout(() => patch({ status: 'Sent', note: 'Sent in RX1 window via serving gateway' }), 2500);
  setTimeout(
    () =>
      UNREACHABLE.has(meter)
        ? patch({ status: 'Failed', note: 'No acknowledgement · serving gateway offline' })
        : patch({ status: 'Acknowledged', note: cmd === 'On-demand read' ? 'Fresh register read received' : 'Meter confirmed' }),
    6000,
  );
  return id;
}

export function addWorkOrder(wo: Omit<WorkOrder, 'id' | 'status'>) {
  const id = 'WO-' + woSeq++;
  set((s) => ({ ...s, workOrders: [{ ...wo, id, status: wo.assignee === 'Unassigned' ? 'New' : 'Assigned' }, ...s.workOrders] }));
  return id;
}

export function updateWorkOrder(id: string, p: Partial<WorkOrder>) {
  set((s) => ({ ...s, workOrders: s.workOrders.map((w) => (w.id === id ? { ...w, ...p } : w)) }));
}

const NO_PROPS: Property[] = [];

export function addProperty(clientId: string, p: Property) {
  set((s) => ({ ...s, addedProps: { ...s.addedProps, [clientId]: [...(s.addedProps[clientId] ?? []), p] } }));
}

export function assignTenant(meter: string, tenant: string, vends: string) {
  set((s) => ({ ...s, tenancy: { ...s.tenancy, [meter]: { tenant, vends } } }));
}

/** A client's properties with this session's additions and tenant assignments applied. */
export function useClientProps(clientId: string, base: Property[]): Property[] {
  const added = useStore((s) => s.addedProps[clientId] ?? NO_PROPS);
  const tenancy = useStore((s) => s.tenancy);
  return [...base, ...added].map((p) => (tenancy[p.meter] ? { ...p, ...tenancy[p.meter], tone: '#00468C' } : p));
}
