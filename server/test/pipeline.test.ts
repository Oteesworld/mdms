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

// Real frames: an SH meter's C7 data reports (from the vendor's ChirpStack v3 export)
// and the first uplink of meter 0288260615217 (address 2606001521) after joining.
const C7_REPORT = '68240026230011c70126092520445783000000158400000085000000008722238903700a08400316';
const C7_CREDIT = '68250026230011c70126092515584183000000168723688903690a4840a000000001a1000000324f16';
const C2_STATUS = '68202606001521c2000000c2000000700365030010000000000000003001120501224416';
const hex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));

test('SH C7 data report decodes like the vendor decoder', () => {
  const out = decodeLocally(hex(C7_REPORT), 2);
  assert.equal(out.address, '0026230011');
  assert.equal(out.function_code, '0xC7');
  assert.equal(out.crc_ok, true);
  assert.equal(out.meterTime, '2026-09-25 20:44:57');
  assert.equal(out.totalFlow, 0.21);
  assert.equal(out.register_l, 210);
  assert.equal(out.waterTemperature, 22.23);
  assert.equal(out.battery_v, 3.7);
  assert.equal(out.decoded, true);
  const n = normalise(out);
  assert.equal(n.registerL, 210);
  assert.equal(n.batteryV, 3.7);
  assert.deepEqual(n.alarms, []);

  const credit = decodeLocally(hex(C7_CREDIT), 2);
  assert.equal(credit.totalPurchase, 0.5);
  assert.equal(credit.totalConsumption, 0.01);
  assert.equal(credit.credit_l, 490);
});

test('SH C2 status frame passes through raw; fPort 223 link message is labelled', () => {
  const out = decodeLocally(hex(C2_STATUS), 2);
  assert.equal(out.address, '2606001521');
  assert.equal(out.function_code, '0xC2');
  assert.equal(out.crc_ok, true);
  assert.equal(out.decoded, false);
  assert.equal(out.register_l, undefined);
  assert.equal(out.meterTime, '2022-01-05 12:01:30');
  const link = decodeLocally(hex('ffffbb0800ff'), 223);
  assert.equal(link.message_label, 'Link message');
});

test('SH multi-record report: alarms, valve and back-dated history', () => {
  const codec = loadCodec(codecSource()) as unknown as { calculateCRC8(b: number[]): number };
  // addr, C7, totalFlow(dot 2)=1.50, status: leak + magnetic, valve 0x7E, GAP 1h, totalFlow 1.40
  const body = [0x26, 0x06, 0x00, 0x15, 0x21, 0xc7, 0x83, 0, 0, 0, 0x96, 0x0a, 0x01, 0x80, 0x27, 0x7e, 0x29, 0x01, 0x83, 0, 0, 0, 0x8c];
  const frame = [0x68, body.length, ...body, codec.calculateCRC8(body), 0x16];
  const out = decodeLocally(new Uint8Array(frame), 2);
  assert.equal(out.crc_ok, true);
  assert.equal(out.register_l, 1500);
  assert.equal(out.valve, 'open');
  assert.deepEqual(normalise(out).alarms.sort(), ['leak', 'magnetic']);
  const history = out.history as Record<string, unknown>[];
  assert.equal(history.length, 1);
  assert.equal(history[0].hours_ago, 1);
  assert.equal(history[0].register_l, 1400);

  const bad = [...frame];
  bad[frame.length - 2] ^= 0xff;
  assert.equal(decodeLocally(new Uint8Array(bad), 2).crc_ok, false);
});

test('STS token downlink matches the vendor encoder', () => {
  const codec = loadCodec(codecSource()) as unknown as {
    encodeDownlink(i: { fPort?: number; data: unknown }): { bytes?: number[]; fPort?: number; errors?: string[] };
  };
  const res = codec.encodeDownlink({
    fPort: 2,
    data: { address: '2410000009', tokens: ['12345678901234567890', '98765432109876543210'] },
  });
  assert.equal(Buffer.from(res.bytes!).toString('hex'), '681b2410000009c87e12345678901234567890987654321098765432108e16');
  assert.ok(codec.encodeDownlink({ data: { address: '2410000009', tokens: ['123'] } }).errors);
});

test('ingest stores SH history records as back-dated readings', async () => {
  const { app, store } = await setup();
  const codec = loadCodec(codecSource()) as unknown as { calculateCRC8(b: number[]): number };
  const body = [0x26, 0x06, 0x00, 0x15, 0x21, 0xc7, 0x83, 0, 0, 0, 0x96, 0x29, 0x02, 0x83, 0, 0, 0, 0x8c];
  const frame = Buffer.from([0x68, body.length, ...body, codec.calculateCRC8(body), 0x16]);
  const time = new Date('2026-11-13T10:00:00Z');
  await app.inject({
    method: 'POST',
    url: '/integrations/chirpstack?event=up',
    payload: upEvent({ time: time.toISOString(), fPort: 2, data: frame.toString('base64') }),
  });
  const rows = store.all(`SELECT read_at, register_l, reading_type FROM readings ORDER BY read_at`);
  assert.deepEqual(rows.map((r) => [r.read_at, r.register_l, r.reading_type]), [
    ['2026-11-13T08:00:00.000Z', 1400, 'history'],
    ['2026-11-13T10:00:00.000Z', 1500, 'live'],
  ]);
  await app.close();
  store.close();
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
