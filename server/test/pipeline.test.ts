import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFrames, encodeFrame } from '../src/chirpstack/grpcweb.ts';
import { parseMeterCsv } from '../src/cli.ts';
import { config } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { decodeLocally, loadCodec, codecSource, normalise } from '../src/decode.ts';
import { Ingestor } from '../src/ingest.ts';
import { buildServer } from '../src/server.ts';

const DEV = '24e124136b502217';

function upEvent(over: Record<string, unknown> = {}) {
  return {
    deduplicationId: crypto.randomUUID(),
    time: new Date().toISOString(),
    deviceInfo: {
      tenantId: 't', applicationId: 'a', applicationName: 'Amplified IoT Water Meters',
      deviceProfileName: 'Amplified IoT Water Meter (EU868 OTAA)', deviceName: 'WM-104882', devEui: DEV,
      tags: { serial: 'WM-104882' },
    },
    devAddr: '01ab23cd', dr: 5, fCnt: 12, fPort: 60, confirmed: false,
    data: Buffer.from([0x10, 0x27, 0x00, 0x00, 0x96]).toString('base64'),
    rxInfo: [
      { gatewayId: 'C0BA1FFFFE055AFA', rssi: -97, snr: 6.5 },
      { gatewayId: '24e124fffef00001', rssi: -88, snr: 9.2 },
    ],
    txInfo: { frequency: 868100000, modulation: { lora: { bandwidth: 125000, spreadingFactor: 7 } } },
    ...over,
  };
}

async function setup(token = '') {
  const store = new Store(':memory:');
  const ingestor = new Ingestor(store);
  const app = await buildServer({ config: { ...config, integrationToken: token }, store, ingestor });
  return { store, ingestor, app };
}

test('gRPC-web frames round-trip, trailers parsed', () => {
  const body = new Uint8Array([8, 10]);
  const frame = encodeFrame(body);
  assert.deepEqual([...frame], [0, 0, 0, 0, 2, 8, 10]);
  const trailer = new TextEncoder().encode('grpc-status:5\r\ngrpc-message:Object%20does%20not%20exist\r\n');
  const resp = new Uint8Array([...frame, 0x80, 0, 0, 0, trailer.length, ...trailer]);
  const { data, trailers } = decodeFrames(resp);
  assert.deepEqual([...data!], [8, 10]);
  assert.equal(trailers['grpc-status'], '5');
});

test('codec labels ports and returns raw bytes when no layout is defined', () => {
  const out = decodeLocally(new Uint8Array([0xde, 0xad]), 65);
  assert.equal(out.message, 'tamper_alarm');
  assert.equal(out.alarm, 'tamper');
  assert.equal(out.raw_hex, 'dead');
  assert.equal(out.decoded, false);
  assert.deepEqual(normalise(out).alarms, ['tamper']);
});

test('codec applies a byte layout once one is filled in', () => {
  const src = codecSource().replace(
    'var LAYOUTS = {};',
    "var LAYOUTS = { 60: [['register_l','u32le',1], ['battery_v','u8',0.02], ['status','flags8',['valve_closed','tamper','leak']]] };",
  );
  const codec = loadCodec(src);
  const res = codec.decodeUplink({ bytes: [0x10, 0x27, 0, 0, 0x96, 0b101], fPort: 60 });
  assert.equal(res.data!.register_l, 10000);
  assert.equal(res.data!.battery_v, 3);
  assert.equal(res.data!.valve, 'closed');
  assert.equal(res.data!.leak, true);
  assert.equal(res.data!.tamper, false);
  const n = normalise(res.data!);
  assert.equal(n.registerL, 10000);
  assert.deepEqual(n.alarms, ['leak']);
});

test('meter key CSV: aliases, cleaning, validation, no key echo', () => {
  const csv = [
    'Serial,ADDR,DEVEUI,APPEUI,APPKEY',
    'WM-1,2606001521,24E1 2413 6B50 2217,70B3D57ED0000000,2B7E151628AED2A6ABF7158809CF4F3C',
    'WM-2,,24e124136b502218,70b3d57ed0000000,tooShort',
    'WM-3,,24e124136b502217,70b3d57ed0000000,2b7e151628aed2a6abf7158809cf4f3c',
  ].join('\n');
  const { rows, errors } = parseMeterCsv(csv);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { serial: rows[0].serial, devAddr: rows[0].devAddr, devEui: rows[0].devEui, joinEui: rows[0].joinEui },
    { serial: 'WM-1', devAddr: '2606001521', devEui: '24e124136b502217', joinEui: '70b3d57ed0000000' },
  );
  assert.equal(errors.length, 2);
  assert.match(errors[0], /AppKey must be 32 hex/);
  assert.match(errors[1], /duplicate DevEUI/);
  assert.ok(!errors.join('').includes('2b7e1516'), 'errors must not contain key material');
});

test('uplink webhook stores uplink, picks best gateway, dedups, streams live', async () => {
  const { app, store, ingestor } = await setup();
  const live: unknown[] = [];
  ingestor.on('uplink', (u) => live.push(u));
  const ev = upEvent();
  let res = await app.inject({ method: 'POST', url: '/integrations/chirpstack?event=up', payload: ev });
  assert.equal(res.statusCode, 200, res.body);
  res = await app.inject({ method: 'POST', url: '/integrations/chirpstack?event=up', payload: ev });
  assert.equal(res.json().duplicate, true);
  assert.equal(live.length, 1);

  const meters = (await app.inject({ url: '/api/meters' })).json();
  assert.equal(meters.length, 1);
  assert.equal(meters[0].name, 'WM-104882');
  assert.equal(meters[0].status, 'online');
  assert.equal(meters[0].lastRssi, -88);
  assert.equal(meters[0].lastGatewayId, '24e124fffef00001');
  assert.equal(meters[0].lastSf, 7);
  assert.equal(meters[0].lastPortLabel, 'Midnight data');
  assert.equal(meters[0].devAddr, '01ab23cd');

  const summary = (await app.inject({ url: '/api/summary' })).json();
  assert.equal(summary.uplinks24h, 1);
  assert.deepEqual(summary.ports, [{ fPort: 60, label: 'Midnight data', count: 1 }]);
  await app.close();
  store.close();
});

test('ChirpStack-decoded object wins and produces readings + alarms', async () => {
  const { app, store } = await setup();
  const base = Date.now() - 3600_000;
  for (const [i, reg] of [1000, 1250].entries()) {
    await app.inject({
      method: 'POST',
      url: '/integrations/chirpstack?event=up',
      payload: upEvent({
        time: new Date(base + i * 60_000).toISOString(),
        fCnt: 20 + i,
        object: { register_l: reg, credit_l: 5000 - reg, battery_pct: 18, valve: 'open', decoded: true, burst: i === 1 },
      }),
    });
  }
  const d = (await app.inject({ url: `/api/meters/${DEV.toUpperCase()}` })).json();
  assert.equal(d.meter.registerL, 1250);
  assert.equal(d.meter.creditL, 3750);
  assert.equal(d.meter.lowBattery, true);
  assert.equal(d.readings.length, 2);
  assert.equal(d.alarms.length, 1);
  assert.equal(d.alarms[0].type, 'burst');

  const clear = await app.inject({ method: 'POST', url: `/api/alarms/${d.alarms[0].id}/clear` });
  assert.equal(clear.statusCode, 200);
  const low = (await app.inject({ url: '/api/meters?status=low_battery' })).json();
  assert.equal(low.length, 1);
  await app.close();
  store.close();
});

test('join and status events update the meter', async () => {
  const { app, store } = await setup();
  const info = upEvent().deviceInfo;
  await app.inject({ method: 'POST', url: '/integrations/chirpstack?event=join', payload: { deviceInfo: info, devAddr: '0099aabb', time: new Date().toISOString() } });
  await app.inject({ method: 'POST', url: '/integrations/chirpstack?event=status', payload: { deviceInfo: info, margin: 12, batteryLevel: 81.5, externalPowerSource: false } });
  const m = (await app.inject({ url: `/api/meters/${DEV}` })).json().meter;
  assert.equal(m.devAddr, '0099aabb');
  assert.equal(m.batteryPct, 81.5);
  assert.equal(m.margin, 12);
  assert.ok(m.joinedAt);
  await app.close();
  store.close();
});

test('webhook rejects bad token, unknown events and malformed bodies', async () => {
  const { app, store } = await setup('s3cret');
  const url = '/integrations/chirpstack?event=up';
  assert.equal((await app.inject({ method: 'POST', url, payload: upEvent() })).statusCode, 401);
  const h = { 'x-integration-token': 's3cret' };
  assert.equal((await app.inject({ method: 'POST', url, headers: h, payload: upEvent() })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/integrations/chirpstack?event=nope', headers: h, payload: upEvent() })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url, headers: h, payload: { deviceInfo: { devEui: 'xyz' } } })).statusCode, 400);
  await app.close();
  store.close();
});
