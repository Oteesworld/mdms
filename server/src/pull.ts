// Pull device events straight from ChirpStack, for when ChirpStack cannot push
// to this service (no public URL for the HTTP integration, no MQTT access).
//
// ChirpStack's InternalService/StreamDeviceEvents replays a device's recent
// events and then streams new ones, as JSON in the same shape as the HTTP
// integration. One stream per registered meter; streams reconnect when the
// network or a proxy drops them, and replays are de-duplicated on ingest.
// Suited to tens of meters; for large fleets use the HTTP or MQTT integration.

import internalPb from '@chirpstack/chirpstack-api/api/internal_pb.js';
import type { Config } from './config.js';
import { ChirpStackApi } from './chirpstack/api.js';
import { streamCall } from './chirpstack/grpcweb.js';
import type { Ingestor } from './ingest.js';

export function startPull(config: Config, ingestor: Ingestor, log: (msg: string, err?: unknown) => void) {
  const { url, apiToken } = config.chirpstack;
  if (!apiToken || !config.chirpstack.pullEvents) return { stop: () => {}, devices: () => [] as string[] };

  const api = new ChirpStackApi(url, apiToken);
  const running = new Map<string, AbortController>();
  let stopped = false;

  async function follow(devEui: string, ctl: AbortController) {
    let backoff = 2_000;
    while (!stopped && !ctl.signal.aborted) {
      const started = Date.now();
      try {
        const req = new internalPb.StreamDeviceEventsRequest();
        req.setDevEui(devEui);
        for await (const item of streamCall(url, apiToken, 'api.InternalService/StreamDeviceEvents', req, internalPb.LogItem, ctl.signal)) {
          try {
            ingestor.handle(item.getDescription(), JSON.parse(item.getBody()));
          } catch (e) {
            log(`pull: event for ${devEui} rejected`, e);
          }
        }
      } catch (e) {
        if (ctl.signal.aborted) return;
        log(`pull: stream for ${devEui} dropped`, e);
      }
      // A stream that lived a while was healthy: reconnect quickly. Otherwise back off.
      backoff = Date.now() - started > 60_000 ? 2_000 : Math.min(backoff * 2, 60_000);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  async function refresh() {
    try {
      const tenantId = await api.resolveTenantId(config.chirpstack.tenantId);
      const appId = await api.findApplication(tenantId, config.chirpstack.applicationName);
      if (!appId) return;
      const wanted = new Set((await api.listDevices(appId)).map((d) => d.devEui));
      for (const eui of wanted) {
        if (running.has(eui)) continue;
        const ctl = new AbortController();
        running.set(eui, ctl);
        log(`pull: following ChirpStack events for ${eui}`);
        void follow(eui, ctl);
      }
      for (const [eui, ctl] of running) {
        if (!wanted.has(eui)) {
          ctl.abort();
          running.delete(eui);
        }
      }
    } catch (e) {
      log('pull: could not list meters', e);
    }
  }

  void refresh();
  const timer = setInterval(refresh, 5 * 60_000);
  timer.unref();
  return {
    devices: () => [...running.keys()],
    stop: () => {
      stopped = true;
      clearInterval(timer);
      for (const ctl of running.values()) ctl.abort();
    },
  };
}
