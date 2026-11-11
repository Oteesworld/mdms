// Periodically mirrors gateways and meters from ChirpStack so the dashboard
// lists every registered meter (even before its first uplink) and shows live
// gateway state.

import type { Config } from './config.js';
import type { Store } from './db.js';
import { ChirpStackApi } from './chirpstack/api.js';

export interface SyncState {
  enabled: boolean;
  ok: boolean;
  at: string | null;
  error: string | null;
}

export function startSync(config: Config, store: Store, log: (msg: string, err?: unknown) => void) {
  const state: SyncState = { enabled: Boolean(config.chirpstack.apiToken), ok: false, at: null, error: null };
  if (!state.enabled) {
    state.error = 'CHIRPSTACK_API_TOKEN not set; gateway and meter lists are not synced';
    return { state: () => state, stop: () => {} };
  }

  const api = new ChirpStackApi(config.chirpstack.url, config.chirpstack.apiToken);
  let tenantId = config.chirpstack.tenantId;
  let applicationId: string | null = null;

  async function run() {
    try {
      tenantId ||= await api.resolveTenantId();
      for (const g of await api.listGateways(tenantId)) store.upsertGateway(g);
      applicationId ??= await api.findApplication(tenantId, config.chirpstack.applicationName);
      if (applicationId) {
        for (const d of await api.listDevices(applicationId)) {
          store.ensureMeter({
            devEui: d.devEui,
            name: d.name,
            description: d.description,
            applicationId: applicationId,
            deviceProfile: d.deviceProfileName,
            tags: d.tags,
            lastSeenAt: d.lastSeenAt,
            batteryPct: d.batteryLevel,
            margin: d.margin,
          });
        }
      }
      Object.assign(state, {
        ok: true,
        at: new Date().toISOString(),
        error: applicationId ? null : `application "${config.chirpstack.applicationName}" not found; run: npm run cs -- setup`,
      });
    } catch (e) {
      Object.assign(state, { ok: false, at: new Date().toISOString(), error: String((e as Error).message ?? e) });
      log('ChirpStack sync failed', e);
    }
  }

  void run();
  const timer = setInterval(run, 60_000);
  timer.unref();
  return { state: () => state, stop: () => clearInterval(timer) };
}
