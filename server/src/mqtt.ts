// Optional: receive events from ChirpStack's MQTT integration instead of (or
// as well as) the HTTP integration. Requires JSON marshaling (ChirpStack's default).
// Topic: application/<application_id>/device/<dev_eui>/event/<event>

import mqtt from 'mqtt';
import type { Config } from './config.js';
import type { Ingestor } from './ingest.js';

export function startMqtt(config: Config, ingestor: Ingestor, log: (msg: string, err?: unknown) => void) {
  if (!config.mqtt.url) return null;
  const client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.username || undefined,
    password: config.mqtt.password || undefined,
    clientId: `amplified-iot-mdms-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
  });
  client.on('connect', () => {
    log(`MQTT connected, subscribing to ${config.mqtt.topic}`);
    client.subscribe(config.mqtt.topic, { qos: 1 });
  });
  client.on('error', (e) => log('MQTT error', e));
  client.on('message', (topic, payload) => {
    const event = topic.split('/').pop() ?? '';
    try {
      ingestor.handle(event, JSON.parse(payload.toString('utf8')));
    } catch (e) {
      log(`MQTT message on ${topic} rejected`, e);
    }
  });
  return client;
}
