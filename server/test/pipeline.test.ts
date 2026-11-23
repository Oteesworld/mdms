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
  assert.equal(out.register_l, 19400);
  assert.equal(out.meterTime, '2022-01-05 12:01:30');
  const link = decodeLocally(hex('ffffbb0800ff'), 223);
  assert.equal(link.message_label, 'Link message');
});

test('SH C2 status frames: meter clock and total reading decoded; other fields stay unconfirmed', () => {
  const out = decodeLocally(hex('68202606001521c2000000c500000070036503400800000000000000130116100122c216'), 2);
  assert.equal(out.crc_ok, true);
  assert.equal(out.meterTime, '2022-01-10 16:01:13');
  assert.equal(out.c2_unconfirmed, true);
  assert.equal(out.c2_a, 197);
  assert.equal(out.totalFlow, 19.7, 'confirmed against display P-0 = 19.7 m3');
  assert.equal(out.register_l, 19700);
  assert.equal(out.c2_c_bcd, 3.65);
  assert.equal(out.c2_d_bcd, 3.4);
  assert.equal(out.message_label, 'Status');
  const n = normalise(out);
  assert.equal(n.registerL, 19700);
  assert.equal(out.voltage, 3.65, 'meter Voltage, as in the manual\'s sample table');
  assert.equal(n.batteryV, 3.65, 'shown as battery until a data report brings P-B (voltageRtu)');
});

test('replayed status/join events are stored once', async () => {
  const { app, store } = await setup();
  const info = upEvent().deviceInfo;
  const status = { deduplicationId: 'd-1', time: new Date().toISOString(), deviceInfo: info, margin: 8, batteryLevelUnavailable: true, batteryLevel: 0 };
  const first = await app.inject({ method: 'POST', url: '/integrations/chirpstack?event=status', payload: status });
  const again = await app.inject({ method: 'POST', url: '/integrations/chirpstack?event=status', payload: status });
  assert.equal(first.json().duplicate, undefined);
  assert.equal(again.json().duplicate, true);
  assert.equal(store.get(`SELECT COUNT(*) AS n FROM device_events`)?.n, 1);
  const m = (await app.inject({ url: `/api/meters/${DEV}` })).json().meter;
  assert.equal(m.batteryPct, null, 'batteryLevelUnavailable must not show as 0%');
  await app.close();
  store.close();
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

test('usage buckets: register differences per local day and hour, resets skipped', async () => {
  const { usageBuckets } = await import('../src/usage.ts');
  const r = (t: string, v: number) => ({ readAt: t, registerL: v });
  // Botswana is UTC+2: 22:30Z on the 17th is 00:30 local on the 18th.
  const readings = [
    r('2026-11-17T06:00:00Z', 19400),
    r('2026-11-17T10:00:00Z', 19500), // +100 on local 17 Nov, 12:00
    r('2026-11-17T22:30:00Z', 19600), // +100 on local 18 Nov, 00:00
    r('2026-11-18T10:00:00Z', 19650), // +50  on local 18 Nov, 12:00
    r('2026-11-18T11:00:00Z', 100), //   meter replaced: drop skipped
    r('2026-11-18T12:00:00Z', 130), //   +30  on local 18 Nov, 14:00
  ];
  const from = new Date('2026-11-16T22:00:00Z');
  const to = new Date('2026-11-18T21:59:00Z');
  const day = usageBuckets(readings, 'day', 'Africa/Gaborone', from, to);
  assert.deepEqual(day.buckets.map((b) => [b.key, b.usageL]), [['2026-11-17', 100], ['2026-11-18', 180]]);
  assert.equal(day.totalL, 280);

  const hour = usageBuckets(readings, 'hour', 'Africa/Gaborone', from, to);
  assert.equal(hour.buckets.length, 48);
  const used = hour.buckets.filter((b) => b.usageL > 0).map((b) => [b.key, b.usageL]);
  assert.deepEqual(used, [['2026-11-17 12', 100], ['2026-11-18 00', 100], ['2026-11-18 12', 50], ['2026-11-18 14', 30]]);
  assert.ok(hour.readingSpacingH! >= 1);
});

test('usage API returns daily buckets for a meter', async () => {
  const { app, store } = await setup();
  const now = Date.now();
  for (const [h, v] of [[30, 1000], [5, 1250], [1, 1300]] as const) {
    await app.inject({
      method: 'POST',
      url: '/integrations/chirpstack?event=up',
      payload: upEvent({ time: new Date(now - h * 3600_000).toISOString(), fCnt: 100 - h, object: { register_l: v, decoded: true } }),
    });
  }
  const res = await app.inject({ url: `/api/meters/${DEV}/usage?interval=day&days=7` });
  assert.equal(res.statusCode, 200);
  const u = res.json();
  assert.equal(u.timeZone, 'Africa/Gaborone');
  assert.equal(u.totalL, 300);
  assert.equal((await app.inject({ url: '/api/meters/0000000000000000/usage' })).statusCode, 404);
  await app.close();
  store.close();
});

test('meter clock drift is measured in the configured time zone (GMT+2)', async () => {
  const { meterClockDriftS, zoneOffsetMin } = await import('../src/server.ts');
  assert.equal(zoneOffsetMin('Africa/Gaborone', new Date('2026-11-19T08:00:00Z')), 120);
  // Received 14:00 UTC = 16:00 in Gaborone; a meter showing 16:00:30 is 30 s ahead.
  assert.equal(meterClockDriftS('2026-11-19 16:00:30', '2026-11-19T14:00:00.000Z', 'Africa/Gaborone'), 30);
  // The SH meter's clock (2022-01-10) is years behind.
  const d = meterClockDriftS('2022-01-10 17:36:49', '2026-11-18T15:50:38.354Z', 'Africa/Gaborone')!;
  assert.ok(d < -4 * 365 * 86400);
  assert.equal(meterClockDriftS(undefined, '2026-11-19T14:00:00Z', 'Africa/Gaborone'), null);
});

test('each meter model decodes with its own codec', async () => {
  const { MODELS, modelForProfile, parseModel } = await import('../src/models.ts');
  const c2 = hex('68202606001521c2000000c500000070036503400800000000000000130116100122c216');

  // SH Meters: the C2 status layout (total reading, voltage, clock) applies.
  const sh = decodeLocally(c2, 2, 'sh');
  assert.equal(sh.model, 'sh');
  assert.equal(sh.register_l, 19700);
  // Kalahari: same frame family, but the SH C2 layout is not assumed; C7 reports decode fully.
  const kal = decodeLocally(c2, 2, 'kalahari');
  assert.equal(kal.model, 'kalahari');
  assert.equal(kal.crc_ok, true);
  assert.equal(kal.register_l, undefined);
  assert.equal(kal.meterTime, undefined);
  const kalC7 = decodeLocally(hex(C7_REPORT), 2, 'kalahari');
  assert.equal(kalC7.register_l, 210);
  assert.equal(kalC7.battery_v, 3.7);

  // Honeywell: daily fPort 10 report; only the report time is decoded, the rest is unconfirmed.
  const hw = decodeLocally(hex('e065036b0100000000000000000000cd0b000069016c0128400000010000000000000000000000000000000040420f0000'), 10, 'honeywell');
  assert.equal(hw.model, 'honeywell');
  assert.equal(hw.message_label, 'Daily report');
  assert.equal(hw.reportTime, '2026-11-22T22:00:00Z');
  assert.equal(hw.hw_unconfirmed, true);
  assert.equal(normalise(hw).registerL, null);
  assert.equal(normalise(hw).batteryV, null);

  // Without a known profile the frame itself picks the codec.
  assert.equal(decodeLocally(c2, 2).model, 'sh');
  assert.equal(decodeLocally(hex('e065036b0100000000000000000000cd0b000069016c0128400000010000000000000000000000000000000040420f0000'), 10).model, 'honeywell');

  // Profiles and names.
  assert.equal(modelForProfile(MODELS.kalahari.profileName), 'kalahari');
  assert.equal(modelForProfile('Amplified IoT Water Meter (EU868 OTAA)'), null, 'legacy profile: decode by frame shape');
  assert.equal(modelForProfile('something else'), null);
  assert.equal(parseModel('HoneyWell'), 'honeywell');
  assert.equal(parseModel('SH-Meters'), 'sh');
  assert.equal(parseModel('nope'), null);

  // Every model's ChirpStack script is self-contained and exposes decodeUplink/encodeDownlink.
  for (const m of Object.keys(MODELS) as (keyof typeof MODELS)[]) {
    const c = loadCodec(codecSource(m)) as unknown as { decodeUplink: unknown; encodeDownlink: unknown };
    assert.equal(typeof c.decodeUplink, 'function', m);
    assert.equal(typeof c.encodeDownlink, 'function', m);
  }
});

test('ingest picks the codec from the device profile name', async () => {
  const { app, store } = await setup();
  const { MODELS } = await import('../src/models.ts');
  const c2 = Buffer.from('68202606001521c2000000c500000070036503400800000000000000130116100122c216', 'hex').toString('base64');
  const ev = upEvent({ fPort: 2, data: c2 });
  ev.deviceInfo = { ...ev.deviceInfo, deviceProfileName: MODELS.kalahari.profileName };
  await app.inject({ method: 'POST', url: '/integrations/chirpstack?event=up', payload: ev });
  const m = (await app.inject({ url: `/api/meters/${DEV}` })).json().meter;
  assert.equal(m.lastObject.model, 'kalahari');
  assert.equal(m.registerL, null, 'Kalahari does not use the SH status layout');
  await app.close();
  store.close();
});

test('meter key CSV accepts a model column', () => {
  const { rows, errors } = parseMeterCsv(
    'serial,deveui,appeui,appkey,model\nA,004a7701240c2033,2c26c50124842008,b4c7ba782a2c753b8e74e02a3a54e807,Kalahari\nB,004a7701240c2034,2c26c50124842008,b4c7ba782a2c753b8e74e02a3a54e807,Itron',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model, 'Kalahari');
  assert.match(errors[0], /unknown model "Itron"/);
});

test('replayed events do not overwrite the meter profile or name from ChirpStack', async () => {
  const { app, store } = await setup();
  const { MODELS } = await import('../src/models.ts');
  // Sync from ChirpStack: current name and profile.
  store.ensureMeter({ devEui: DEV, name: 'Kalahari 0026230012', deviceProfile: MODELS.kalahari.profileName });
  // A replayed old event, from before the rename and the profile change.
  const ev = upEvent({ fPort: 2, data: Buffer.from(C7_REPORT, 'hex').toString('base64') });
  ev.deviceInfo = { ...ev.deviceInfo, deviceName: 'old name', deviceProfileName: 'Amplified IoT Water Meter (EU868 OTAA)' };
  await app.inject({ method: 'POST', url: '/integrations/chirpstack?event=up', payload: ev });
  const m = (await app.inject({ url: `/api/meters/${DEV}` })).json().meter;
  assert.equal(m.name, 'Kalahari 0026230012');
  assert.equal(m.model, 'Kalahari');
  assert.equal(m.lastObject.model, 'kalahari', 'decoded with the current profile codec');
  await app.close();
  store.close();
});
