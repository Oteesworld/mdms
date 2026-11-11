// Milesight Development Platform (MDP) OpenAPI client: just enough to find a
// UG6x gateway, read its configuration and point its packet forwarder at
// ChirpStack (Semtech UDP) with a PROFILE configuration task.
//
// Docs: https://www.milesight.com/development-platform/docs/en/api-reference/api-interface-list.html

import './chirpstack/grpcweb.js'; // installs the HTTPS proxy dispatcher when HTTPS_PROXY is set

/** UG6x profile `pkt_type` values (from Milesight's UG56/UG65 profile templates). */
export const PKT_TYPE = {
  embedded_ns: 0,
  semtech: 1,
  basic_station: 2,
  chirpstack_generic: 3,
  chirpstack_v4: 4,
  remote_embedded_ns: 5,
  devicehub_lns: 6,
  mdp_lns: 7,
  everynet: 8,
} as const;

export const PKT_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(PKT_TYPE).map(([k, v]) => [v, k]),
);

/** Profile keys that make up the packet forwarder destination. Nothing else is touched. */
export const FORWARDER_KEYS = ['pkt_enable', 'pkt_type', 'semtech_addr', 'semtech_up_port', 'semtech_down_port'] as const;

export interface ProfileValue {
  key: string;
  value: unknown;
}

export interface MdpDevice {
  deviceId: string;
  sn?: string;
  devEUI?: string;
  name?: string;
  model?: string;
  connectStatus?: string;
  firmwareVersion?: string;
  [k: string]: unknown;
}

export class MdpError extends Error {}

export class MilesightApi {
  private token: string | null = null;
  private tokenExpires = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpires - 60_000) return this.token;
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    if (this.clientId && this.clientSecret) {
      body.set('client_id', this.clientId);
      body.set('client_secret', this.clientSecret);
    } else {
      // No secret in the environment: rely on an outbound proxy that injects
      // HTTP Basic client credentials for this host.
      headers.authorization = 'Basic cHJveHk6aW5qZWN0ZWQ=';
    }
    const res = await fetch(`${this.baseUrl}/oauth/token`, { method: 'POST', headers, body });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { access_token?: string; expires_in?: number };
      errCode?: string;
      errMsg?: string;
    };
    if (!res.ok || !json.data?.access_token) {
      throw new MdpError(`MDP token request failed (HTTP ${res.status}): ${json.errCode ?? ''} ${json.errMsg ?? ''}`.trim());
    }
    this.token = json.data.access_token;
    this.tokenExpires = Date.now() + (json.data.expires_in ?? 3600) * 1000;
    return this.token;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; status?: string; errCode?: string; errMsg?: string };
    if (!res.ok || json.status === 'Failed') {
      throw new MdpError(`MDP ${method} ${path} failed (HTTP ${res.status}): ${json.errCode ?? ''} ${json.errMsg ?? ''}`.trim());
    }
    return json.data as T;
  }

  async searchDevices(filter: Record<string, unknown> = {}): Promise<MdpDevice[]> {
    const out: MdpDevice[] = [];
    for (let page = 1; ; page++) {
      const data = await this.call<{ total: number; content: MdpDevice[] }>('POST', '/device/openapi/v1/devices/search', {
        pageSize: 100,
        pageNumber: page,
        ...filter,
      });
      out.push(...(data.content ?? []));
      if (out.length >= (data.total ?? 0) || !data.content?.length) break;
    }
    return out;
  }

  async getConfig(deviceId: string): Promise<{ version?: string; values?: ProfileValue[] }> {
    return this.call('GET', `/device/openapi/v1/devices/${encodeURIComponent(deviceId)}/config`);
  }

  async createProfileTask(deviceId: string, values: ProfileValue[]) {
    return this.call<{ deviceTaskRelations: { deviceId: string; taskId: string }[] }>('POST', '/device/openapi/v1/tasks', {
      type: 'PROFILE',
      deviceIds: [deviceId],
      config: { values },
    });
  }
}

/** The profile values that switch a gateway's packet forwarder to Semtech UDP. */
export function semtechForwarderValues(host: string, upPort = 1700, downPort = 1700): ProfileValue[] {
  return [
    { key: 'pkt_enable', value: 1 },
    { key: 'pkt_type', value: PKT_TYPE.semtech },
    { key: 'semtech_addr', value: host },
    { key: 'semtech_up_port', value: upPort },
    { key: 'semtech_down_port', value: downPort },
  ];
}

export function pick(values: ProfileValue[] | undefined, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const v of values ?? []) if (keys.includes(v.key)) out[v.key] = v.value;
  return out;
}
