// Runtime configuration, read once from the environment (see .env.example).

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function int(name: string, fallback: number): number {
  const v = Number.parseInt(env(name), 10);
  return Number.isFinite(v) ? v : fallback;
}

export const config = {
  port: int('PORT', 8080),
  host: env('HOST', '0.0.0.0'),
  /** Public base URL of this service, used when registering the ChirpStack HTTP integration. */
  publicUrl: env('PUBLIC_URL').replace(/\/$/, ''),
  dbPath: env('DB_PATH', 'data/mdms.sqlite'),

  chirpstack: {
    /** ChirpStack v4 base URL. The API is called over gRPC-web on the same port as the web UI. */
    url: env('CHIRPSTACK_URL', 'https://teemane.leeroysystems.co.bw').replace(/\/$/, ''),
    apiToken: env('CHIRPSTACK_API_TOKEN'),
    tenantId: env('CHIRPSTACK_TENANT_ID'),
    applicationName: env('CHIRPSTACK_APPLICATION_NAME', 'Amplified IoT Water Meters'),
    deviceProfileName: env('CHIRPSTACK_DEVICE_PROFILE_NAME', 'Amplified IoT Water Meter (EU868 OTAA)'),
    regionConfigId: env('CHIRPSTACK_REGION_CONFIG_ID', 'eu868'),
    /** LoRaWAN MAC version the meters implement: 1.0.2, 1.0.3, 1.0.4 or 1.1.0. */
    macVersion: env('METER_MAC_VERSION', '1.0.3'),
    /** Regional parameters revision: A, B, RP002-1.0.0 ... RP002-1.0.5. */
    regParamsRevision: env('METER_REG_PARAMS_REVISION', 'A'),
    /** Expected uplink interval in seconds; ChirpStack uses it to decide a device is inactive. */
    uplinkIntervalS: int('METER_UPLINK_INTERVAL_S', 86400),
  },

  /** Shared secret ChirpStack sends in the X-Integration-Token header of every HTTP integration call. */
  integrationToken: env('INTEGRATION_TOKEN'),

  /** Optional: subscribe to ChirpStack's MQTT integration instead of (or as well as) the HTTP push. */
  mqtt: {
    url: env('MQTT_URL'),
    username: env('MQTT_USERNAME'),
    password: env('MQTT_PASSWORD'),
    topic: env('MQTT_TOPIC', 'application/+/device/+/event/+'),
  },

  /** A meter is shown offline when nothing has been heard from it for this many seconds. */
  offlineAfterS: int('METER_OFFLINE_AFTER_S', 26 * 3600),
  /** Battery percentage at or below which a meter is flagged low battery. */
  lowBatteryPct: int('METER_LOW_BATTERY_PCT', 20),
};

export type Config = typeof config;
