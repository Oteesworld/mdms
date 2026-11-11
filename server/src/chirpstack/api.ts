// Typed helpers over the ChirpStack v4 API for the operations this service needs:
// tenant lookup, application + device profile + HTTP integration setup,
// gateway registration and meter (device) provisioning.

import applicationPb from '@chirpstack/chirpstack-api/api/application_pb.js';
import commonPb from '@chirpstack/chirpstack-api/common/common_pb.js';
import devicePb from '@chirpstack/chirpstack-api/api/device_pb.js';
import deviceProfilePb from '@chirpstack/chirpstack-api/api/device_profile_pb.js';
import gatewayPb from '@chirpstack/chirpstack-api/api/gateway_pb.js';
import tenantPb from '@chirpstack/chirpstack-api/api/tenant_pb.js';
import emptyMod from 'google-protobuf/google/protobuf/empty_pb.js';
import { GrpcError, GrpcWebClient } from './grpcweb.js';

const A = applicationPb;
const C = commonPb;
const D = devicePb;
const DP = deviceProfilePb;
const G = gatewayPb;
const T = tenantPb;

const MAC_VERSIONS: Record<string, number> = {
  '1.0.0': C.MacVersion.LORAWAN_1_0_0,
  '1.0.1': C.MacVersion.LORAWAN_1_0_1,
  '1.0.2': C.MacVersion.LORAWAN_1_0_2,
  '1.0.3': C.MacVersion.LORAWAN_1_0_3,
  '1.0.4': C.MacVersion.LORAWAN_1_0_4,
  '1.1.0': C.MacVersion.LORAWAN_1_1_0,
};

const REG_PARAMS: Record<string, number> = {
  A: C.RegParamsRevision.A,
  B: C.RegParamsRevision.B,
  'RP002-1.0.0': C.RegParamsRevision.RP002_1_0_0,
  'RP002-1.0.1': C.RegParamsRevision.RP002_1_0_1,
  'RP002-1.0.2': C.RegParamsRevision.RP002_1_0_2,
  'RP002-1.0.3': C.RegParamsRevision.RP002_1_0_3,
  'RP002-1.0.4': C.RegParamsRevision.RP002_1_0_4,
  'RP002-1.0.5': C.RegParamsRevision.RP002_1_0_5,
};

const REGIONS: Record<string, number> = {
  eu868: C.Region.EU868, us915: C.Region.US915, au915: C.Region.AU915, as923: C.Region.AS923,
  as923_2: C.Region.AS923_2, as923_3: C.Region.AS923_3, as923_4: C.Region.AS923_4,
  in865: C.Region.IN865, kr920: C.Region.KR920, ru864: C.Region.RU864, cn470: C.Region.CN470,
  eu433: C.Region.EU433, cn779: C.Region.CN779, ism2400: C.Region.ISM2400,
};

const GATEWAY_STATES = ['never_seen', 'online', 'offline'] as const;
export type GatewayState = (typeof GATEWAY_STATES)[number];

export interface DeviceProfileSettings {
  name: string;
  regionConfigId: string;
  macVersion: string;
  regParamsRevision: string;
  uplinkIntervalS: number;
  codecScript: string;
}

export interface GatewayInput {
  gatewayId: string;
  name: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  tags?: Record<string, string>;
}

export interface MeterInput {
  devEui: string;
  joinEui: string;
  appKey: string;
  name: string;
  description?: string;
  tags?: Record<string, string>;
}

export interface GatewaySummary {
  gatewayId: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  state: GatewayState;
  lastSeenAt: string | null;
}

export interface DeviceSummary {
  devEui: string;
  name: string;
  description: string;
  deviceProfileName: string;
  lastSeenAt: string | null;
  batteryLevel: number | null;
  margin: number | null;
  tags: Record<string, string>;
}

const PAGE = 500;

function tsToIso(ts: { getSeconds(): number; getNanos(): number } | undefined): string | null {
  if (!ts || !ts.getSeconds()) return null;
  return new Date(ts.getSeconds() * 1000 + Math.floor(ts.getNanos() / 1e6)).toISOString();
}

function setMap(map: { set(k: string, v: string): unknown; clear(): void }, values: Record<string, string> = {}) {
  map.clear();
  for (const [k, v] of Object.entries(values)) map.set(k, v);
}

export function isNotFound(e: unknown): boolean {
  return e instanceof GrpcError && e.code === 5;
}

export class ChirpStackApi {
  readonly rpc: GrpcWebClient;

  constructor(baseUrl: string, token: string) {
    this.rpc = new GrpcWebClient(baseUrl, token);
  }

  // --- tenants -----------------------------------------------------------

  async listTenants(): Promise<{ id: string; name: string }[]> {
    const req = new T.ListTenantsRequest();
    req.setLimit(PAGE);
    const res = await this.rpc.unary('api.TenantService/List', req, T.ListTenantsResponse);
    return res.getResultList().map((t) => ({ id: t.getId(), name: t.getName() }));
  }

  /** Use the configured tenant, or the only tenant the API key can see. */
  async resolveTenantId(configured?: string): Promise<string> {
    if (configured) return configured;
    const tenants = await this.listTenants();
    if (tenants.length === 1) return tenants[0].id;
    throw new Error(
      `Set CHIRPSTACK_TENANT_ID: the API key can see ${tenants.length} tenants (${tenants
        .map((t) => `${t.name}=${t.id}`)
        .join(', ')}).`,
    );
  }

  // --- applications ------------------------------------------------------

  async findApplication(tenantId: string, name: string): Promise<string | null> {
    const req = new A.ListApplicationsRequest();
    req.setTenantId(tenantId);
    req.setSearch(name);
    req.setLimit(PAGE);
    const res = await this.rpc.unary('api.ApplicationService/List', req, A.ListApplicationsResponse);
    return res.getResultList().find((a) => a.getName() === name)?.getId() ?? null;
  }

  async ensureApplication(tenantId: string, name: string, description: string): Promise<{ id: string; created: boolean }> {
    const existing = await this.findApplication(tenantId, name);
    if (existing) return { id: existing, created: false };
    const app = new A.Application();
    app.setTenantId(tenantId);
    app.setName(name);
    app.setDescription(description);
    const req = new A.CreateApplicationRequest();
    req.setApplication(app);
    const res = await this.rpc.unary('api.ApplicationService/Create', req, A.CreateApplicationResponse);
    return { id: res.getId(), created: true };
  }

  /** Point the application's HTTP integration at this service (creates or updates it). */
  async ensureHttpIntegration(applicationId: string, eventEndpointUrl: string, headers: Record<string, string>) {
    const integ = new A.HttpIntegration();
    integ.setApplicationId(applicationId);
    integ.setEncoding(A.Encoding.JSON);
    integ.setEventEndpointUrl(eventEndpointUrl);
    setMap(integ.getHeadersMap(), headers);

    const get = new A.GetHttpIntegrationRequest();
    get.setApplicationId(applicationId);
    let exists = true;
    try {
      await this.rpc.unary('api.ApplicationService/GetHttpIntegration', get, A.GetHttpIntegrationResponse);
    } catch (e) {
      if (!isNotFound(e)) throw e;
      exists = false;
    }
    if (exists) {
      const req = new A.UpdateHttpIntegrationRequest();
      req.setIntegration(integ);
      await this.rpc.unary('api.ApplicationService/UpdateHttpIntegration', req, emptyPb());
      return { created: false };
    }
    const req = new A.CreateHttpIntegrationRequest();
    req.setIntegration(integ);
    await this.rpc.unary('api.ApplicationService/CreateHttpIntegration', req, emptyPb());
    return { created: true };
  }

  // --- device profiles ---------------------------------------------------

  async findDeviceProfile(tenantId: string, name: string): Promise<string | null> {
    const req = new DP.ListDeviceProfilesRequest();
    req.setTenantId(tenantId);
    req.setSearch(name);
    req.setLimit(PAGE);
    const res = await this.rpc.unary('api.DeviceProfileService/List', req, DP.ListDeviceProfilesResponse);
    return res.getResultList().find((p) => p.getName() === name)?.getId() ?? null;
  }

  /** Create the meter device profile, or update its settings and payload codec. */
  async ensureDeviceProfile(tenantId: string, s: DeviceProfileSettings): Promise<{ id: string; created: boolean }> {
    const region = REGIONS[s.regionConfigId.toLowerCase()] ?? REGIONS[s.regionConfigId.split('_')[0].toLowerCase()];
    const mac = MAC_VERSIONS[s.macVersion];
    const rp = REG_PARAMS[s.regParamsRevision];
    if (region === undefined) throw new Error(`Unknown region config "${s.regionConfigId}"`);
    if (mac === undefined) throw new Error(`Unknown MAC version "${s.macVersion}"`);
    if (rp === undefined) throw new Error(`Unknown regional parameters revision "${s.regParamsRevision}"`);

    const existingId = await this.findDeviceProfile(tenantId, s.name);
    let p: InstanceType<typeof DP.DeviceProfile>;
    if (existingId) {
      const get = new DP.GetDeviceProfileRequest();
      get.setId(existingId);
      const res = await this.rpc.unary('api.DeviceProfileService/Get', get, DP.GetDeviceProfileResponse);
      p = res.getDeviceProfile() ?? new DP.DeviceProfile();
    } else {
      p = new DP.DeviceProfile();
      p.setTenantId(tenantId);
      p.setName(s.name);
      p.setAdrAlgorithmId('default');
      p.setFlushQueueOnActivate(true);
      // Ask each meter for battery + link margin once a day (DevStatusReq).
      p.setDeviceStatusReqInterval(1);
    }
    p.setDescription('Prepaid LoRaWAN water meter, Class A, OTAA. Payload codec managed from the mdms repo (server/codec/water-meter.js).');
    p.setRegion(region as never);
    p.setRegionConfigId(s.regionConfigId);
    p.setMacVersion(mac as never);
    p.setRegParamsRevision(rp as never);
    p.setSupportsOtaa(true);
    p.setSupportsClassB(false);
    p.setSupportsClassC(false);
    p.setUplinkInterval(s.uplinkIntervalS);
    p.setPayloadCodecRuntime(DP.CodecRuntime.JS);
    p.setPayloadCodecScript(s.codecScript);
    p.setAutoDetectMeasurements(true);

    if (existingId) {
      const req = new DP.UpdateDeviceProfileRequest();
      req.setDeviceProfile(p);
      await this.rpc.unary('api.DeviceProfileService/Update', req, emptyPb());
      return { id: existingId, created: false };
    }
    const req = new DP.CreateDeviceProfileRequest();
    req.setDeviceProfile(p);
    const res = await this.rpc.unary('api.DeviceProfileService/Create', req, DP.CreateDeviceProfileResponse);
    return { id: res.getId(), created: true };
  }

  // --- gateways ----------------------------------------------------------

  async upsertGateway(tenantId: string, g: GatewayInput): Promise<{ created: boolean }> {
    const gw = new G.Gateway();
    gw.setGatewayId(g.gatewayId.toLowerCase());
    gw.setName(g.name);
    gw.setDescription(g.description ?? '');
    gw.setTenantId(tenantId);
    gw.setStatsInterval(30);
    const loc = new C.Location();
    loc.setLatitude(g.latitude ?? 0);
    loc.setLongitude(g.longitude ?? 0);
    loc.setAltitude(g.altitude ?? 0);
    loc.setSource(C.LocationSource.CONFIG);
    gw.setLocation(loc);
    setMap(gw.getTagsMap(), g.tags);

    try {
      const get = new G.GetGatewayRequest();
      get.setGatewayId(gw.getGatewayId());
      await this.rpc.unary('api.GatewayService/Get', get, G.GetGatewayResponse);
    } catch (e) {
      if (!isNotFound(e)) throw e;
      const req = new G.CreateGatewayRequest();
      req.setGateway(gw);
      await this.rpc.unary('api.GatewayService/Create', req, emptyPb());
      return { created: true };
    }
    const req = new G.UpdateGatewayRequest();
    req.setGateway(gw);
    await this.rpc.unary('api.GatewayService/Update', req, emptyPb());
    return { created: false };
  }

  async listGateways(tenantId: string): Promise<GatewaySummary[]> {
    const out: GatewaySummary[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const req = new G.ListGatewaysRequest();
      req.setTenantId(tenantId);
      req.setLimit(PAGE);
      req.setOffset(offset);
      const res = await this.rpc.unary('api.GatewayService/List', req, G.ListGatewaysResponse);
      for (const g of res.getResultList()) {
        out.push({
          gatewayId: g.getGatewayId(),
          name: g.getName(),
          description: g.getDescription(),
          latitude: g.getLocation()?.getLatitude() ?? 0,
          longitude: g.getLocation()?.getLongitude() ?? 0,
          state: GATEWAY_STATES[g.getState()] ?? 'never_seen',
          lastSeenAt: tsToIso(g.getLastSeenAt()),
        });
      }
      if (out.length >= res.getTotalCount() || res.getResultList().length === 0) break;
    }
    return out;
  }

  // --- devices (meters) --------------------------------------------------

  /** Register a meter for OTAA, or update it if the DevEUI already exists. */
  async upsertMeter(applicationId: string, deviceProfileId: string, m: MeterInput): Promise<{ created: boolean }> {
    const dev = new D.Device();
    dev.setDevEui(m.devEui.toLowerCase());
    dev.setName(m.name);
    dev.setDescription(m.description ?? '');
    dev.setApplicationId(applicationId);
    dev.setDeviceProfileId(deviceProfileId);
    dev.setJoinEui(m.joinEui.toLowerCase());
    setMap(dev.getTagsMap(), m.tags);

    let created = false;
    try {
      const get = new D.GetDeviceRequest();
      get.setDevEui(dev.getDevEui());
      await this.rpc.unary('api.DeviceService/Get', get, D.GetDeviceResponse);
      const req = new D.UpdateDeviceRequest();
      req.setDevice(dev);
      await this.rpc.unary('api.DeviceService/Update', req, emptyPb());
    } catch (e) {
      if (!isNotFound(e)) throw e;
      const req = new D.CreateDeviceRequest();
      req.setDevice(dev);
      await this.rpc.unary('api.DeviceService/Create', req, emptyPb());
      created = true;
    }

    // LoRaWAN 1.0.x: ChirpStack stores the device's AppKey in the nwk_key field.
    const keys = new D.DeviceKeys();
    keys.setDevEui(dev.getDevEui());
    keys.setNwkKey(m.appKey.toLowerCase());
    keys.setAppKey('00000000000000000000000000000000');
    if (created) {
      const req = new D.CreateDeviceKeysRequest();
      req.setDeviceKeys(keys);
      await this.rpc.unary('api.DeviceService/CreateKeys', req, emptyPb());
    } else {
      const req = new D.UpdateDeviceKeysRequest();
      req.setDeviceKeys(keys);
      try {
        await this.rpc.unary('api.DeviceService/UpdateKeys', req, emptyPb());
      } catch (e) {
        if (!isNotFound(e)) throw e;
        const creq = new D.CreateDeviceKeysRequest();
        creq.setDeviceKeys(keys);
        await this.rpc.unary('api.DeviceService/CreateKeys', creq, emptyPb());
      }
    }
    return { created };
  }

  async listDevices(applicationId: string): Promise<DeviceSummary[]> {
    const out: DeviceSummary[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const req = new D.ListDevicesRequest();
      req.setApplicationId(applicationId);
      req.setLimit(PAGE);
      req.setOffset(offset);
      const res = await this.rpc.unary('api.DeviceService/List', req, D.ListDevicesResponse);
      for (const d of res.getResultList()) {
        const st = d.getDeviceStatus();
        const tags: Record<string, string> = {};
        d.getTagsMap().forEach((v: string, k: string) => (tags[k] = v));
        out.push({
          devEui: d.getDevEui(),
          name: d.getName(),
          description: d.getDescription(),
          deviceProfileName: d.getDeviceProfileName(),
          lastSeenAt: tsToIso(d.getLastSeenAt()),
          batteryLevel: st && !st.getExternalPowerSource() ? st.getBatteryLevel() : null,
          margin: st ? st.getMargin() : null,
          tags,
        });
      }
      if (out.length >= res.getTotalCount() || res.getResultList().length === 0) break;
    }
    return out;
  }
}

/** google.protobuf.Empty, for RPCs that return nothing. */
function emptyPb() {
  return emptyMod.Empty;
}
