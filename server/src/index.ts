import { config } from './config.js';
import { Store } from './db.js';
import { Ingestor } from './ingest.js';
import { startMqtt } from './mqtt.js';
import { buildServer } from './server.js';
import { startSync } from './sync.js';

const store = new Store(config.dbPath);
const ingestor = new Ingestor(store);
ingestor.setMaxListeners(1000); // one per open dashboard tab

let logger: { info(m: string): void; error(o: unknown, m: string): void } = {
  info: (m) => console.log(m),
  error: (o, m) => console.error(m, o),
};
const log = (msg: string, err?: unknown) => (err ? logger.error({ err }, msg) : logger.info(msg));

const sync = startSync(config, store, log);
const app = await buildServer({ config, store, ingestor, syncState: sync.state });
logger = app.log;
const mqttClient = startMqtt(config, ingestor, log);

if (!config.integrationToken) {
  app.log.warn('INTEGRATION_TOKEN is not set: anyone who can reach /integrations/chirpstack can post meter data');
}

await app.listen({ port: config.port, host: config.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    sync.stop();
    mqttClient?.end();
    await app.close();
    store.close();
    process.exit(0);
  });
}
