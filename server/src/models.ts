// The meter models this MDMS knows, each with its own ChirpStack device profile and
// payload codec. All share one tenant, one application and the same gateways.

export type ModelKey = 'sh' | 'kalahari' | 'honeywell';

export interface MeterModel {
  key: ModelKey;
  label: string;
  /** ChirpStack device profile name. */
  profileName: string;
  description: string;
  /** Codec files under codec/, concatenated in order into one ChirpStack script. */
  codecFiles: string[];
  /** Expected uplink interval in seconds (ChirpStack marks a device inactive after it). */
  uplinkIntervalS: number;
}

export const MODELS: Record<ModelKey, MeterModel> = {
  sh: {
    key: 'sh',
    label: 'SH Meters',
    profileName: 'SH Meters (EU868 OTAA)',
    description: 'SH Meters STS ultrasonic water meter (SH-L-EU868). C2 status frames every 4 h on fPort 2, C7 data reports after key code 11111. Codec: server/codec/lib/sh-frame.js + server/codec/sh-meters.js.',
    codecFiles: ['lib/sh-frame.js', 'sh-meters.js'],
    uplinkIntervalS: 4 * 3600,
  },
  kalahari: {
    key: 'kalahari',
    label: 'Kalahari',
    profileName: 'Kalahari (EU868 OTAA)',
    description: 'Kalahari prepaid ultrasonic water meter. Vendor C7 TLV data reports on fPort 2. Codec: server/codec/lib/sh-frame.js + server/codec/kalahari.js.',
    codecFiles: ['lib/sh-frame.js', 'kalahari.js'],
    uplinkIntervalS: 24 * 3600,
  },
  honeywell: {
    key: 'honeywell',
    label: 'Honeywell',
    profileName: 'Honeywell (EU868 OTAA)',
    description: 'Honeywell LoRaWAN water meter. 49-byte daily report on fPort 10. Codec: server/codec/honeywell.js.',
    codecFiles: ['honeywell.js'],
    uplinkIntervalS: 24 * 3600,
  },
};

/**
 * The single profile every meter was on before models were split. It says nothing
 * about the model, so events under it decode by frame shape (see decode.ts).
 */
export const LEGACY_PROFILE_NAME = 'Amplified IoT Water Meter (EU868 OTAA)';

export function modelForProfile(profileName: string | undefined | null): ModelKey | null {
  if (!profileName) return null;
  for (const m of Object.values(MODELS)) if (m.profileName === profileName) return m.key;
  return null;
}

export function parseModel(v: string | undefined | null): ModelKey | null {
  const k = String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['sh', 'shmeter', 'shmeters'].includes(k)) return 'sh';
  if (k === 'kalahari') return 'kalahari';
  if (['honeywell', 'hw'].includes(k)) return 'honeywell';
  return null;
}
