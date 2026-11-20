// Tests for the SH C7 codec against real frames from meter 0288260615217 (DevEUI 004a7701240c1fc9).
// Run: node --test server/codec/sh-c7.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {decodeUplink, encodeDownlink, decodeDownlink, crc8} = require('./sh-c7.js');

const hex = h => h.match(/../g).map(x => parseInt(x, 16));
const up = (h, fPort = 2) => decodeUplink({bytes: hex(h), fPort});
const toHex = b => b.map(x => x.toString(16).padStart(2, '0')).join('');

const C7 = '68252606001521c70126111910101743000000c58729248903700a4840600000004661000000436616';
const C2 = '68202606001521c2000000c500000070036503404800000000000000403208110122ad16';
const C2_TOP_BYTE = '68202606001521c2140000c5000000700365034048000000000000003738091911264a16';

test('C7 data report: values match the meter display', () => {
  const {data, warnings, errors} = up(C7);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(data.crc_ok, true);
  assert.equal(data.function_code, '0xC7');
  assert.equal(data.message, 'data_report');
  assert.equal(data.address, '2606001521');
  assert.equal(data.meterTime, '2026-11-19 10:10:17');
  assert.equal(data.totalFlow, 19.7);          // P-0
  assert.equal(data.totalConsumption, 7);      // P-3
  assert.equal(data.totalPurchase, 6.7);       // P-4
  assert.equal(data.waterTemperature, 29.24);  // P-A
  assert.equal(data.voltageRtu, 3.7);          // P-B
  assert.equal(data.credit_l, -300);           // P-2 = P-4 - P-3
  assert.equal(data.register_l, 19700);
  assert.equal(data.valveAlarm, 1);            // status-word bit, no longer called valveStatus
  assert.equal(data.valveStatus, undefined);
  assert.equal(data.leakageStatus, 0);
  assert.equal(data.leak, false);
  assert.equal(data.motorStatus, 1);
  assert.equal(data.record_count, 1);
  assert.equal(data.history, undefined);
});

test('C7 with a corrupted CRC returns no readings', () => {
  const bad = C7.slice(0, -4) + '6716';
  const {data, warnings} = up(bad);
  assert.equal(data.crc_ok, false);
  assert.equal(data.totalFlow, undefined);
  assert.match(warnings[0], /CRC mismatch/);
});

test('C2 status frame: P-0 and clock decoded, no false TLV values', () => {
  const {data, warnings} = up(C2);
  assert.deepEqual(warnings, []);
  assert.equal(data.crc_ok, true);
  assert.equal(data.message, 'status_c2');
  assert.equal(data.totalFlow, 19.7);
  assert.equal(data.meterTime, '2022-01-11 08:32:40');
  assert.equal(data.voltage, 3.65);
  assert.equal(data.creditWater, undefined);   // the vendor file reported 83.2 m3 here
  assert.equal(data.battery_v, undefined);     // 3.65 V is the meter supply, not P-B
});

test('C2 valve byte and flags: closed in overdraft, open after a top-up', () => {
  // real frames from meter 0288260615217 on 20 Nov 2026: 12:01 local (in overdraft) and 16:01 local (after an STS token)
  const closed = up('68202606001521c2000000c700000069036503400800000000000000130112201126a316');
  const open = up('68202606001521c2000000c7000000700365034008000000000000001301162011263316');
  assert.equal(closed.data.crc_ok, true);
  assert.equal(closed.data.valveState, 'closed');
  assert.equal(closed.data.valve_byte, '69');
  assert.equal(open.data.valveState, 'open');
  assert.equal(open.data.valve_byte, '70');
  assert.equal(open.data.realtimeInfoFlag, 0);   // flags 0x08: scheduled frame
  assert.equal(open.data.motorStatus, 1);
  assert.equal(up(C2).data.realtimeInfoFlag, 1); // flags 0x48: frame sent outside the schedule
});


test('C2 with a stray top byte in field A keeps the right reading', () => {
  const {data, warnings} = up(C2_TOP_BYTE);
  assert.equal(data.totalFlow, 19.7);          // the earlier codec read 33,554,451.7 m3
  assert.equal(data.c2_a_top_byte, '14');
  assert.match(warnings[0], /top byte/);
  assert.equal(data.meterTime, '2026-11-19 09:38:37');
});

test('fPort 223 link message is labelled, not an error', () => {
  const {data, errors} = up('ffffb00800ff', 223);
  assert.deepEqual(errors, []);
  assert.equal(data.message, 'link');
});

test('older hourly records go to history with back-dated times', () => {
  // data report built from real field bytes: time, total, consumption; then 2 older records (1 h and 2 h back)
  const payload = hex('01261119101017' + '43000000c5' + '4b0001' + '2901' + '43000000c4' + '4b0002' + '2902' + '43000000c2');
  const body = hex('2606001521').concat([0xC7], payload);
  const frame = [0x68, body.length].concat(body, [crc8(body), 0x16]);
  const {data, warnings} = decodeUplink({bytes: frame, fPort: 2});
  assert.deepEqual(warnings, []);
  assert.equal(data.totalFlow, 19.7);
  assert.equal(data.hourlyConsumption, 0.1);
  assert.equal(data.record_count, 3);
  assert.equal(data.history.length, 2);
  assert.deepEqual([data.history[0].hoursAgo, data.history[0].meterTime, data.history[0].totalFlow], [1, '2026-11-19 09:10:17', 19.6]);
  assert.deepEqual([data.history[1].hoursAgo, data.history[1].meterTime, data.history[1].totalFlow], [2, '2026-11-19 08:10:17', 19.4]);
});

test('token downlink: same frame as the vendor encoder for valid input', () => {
  const r = encodeDownlink({data: {address: '2410000009', tokens: ['12345678901234567890', '98765432109876543210']}});
  assert.equal(toHex(r.bytes), '681b2410000009c87e12345678901234567890987654321098765432108e16');
  const back = decodeDownlink({bytes: r.bytes}).data;
  assert.deepEqual(back.tokens, ['12345678901234567890', '98765432109876543210']);
  assert.equal(back.crc_ok, true);
});

test('token downlink accepts a comma separated string and spaced digits', () => {
  const r = encodeDownlink({data: {address: '2606001521', token: '1234 5678 9012 3456 7890'}});
  assert.ok(r.bytes);
  assert.equal(r.bytes[8], 0x3E); // one token
});

test('token downlink rejects invalid input instead of sending a bad frame', () => {
  const err = data => encodeDownlink({data}).errors || [];
  assert.match(err({address: '2606001521', tokens: ['1234567890123456789A']})[0], /20 digits/);
  assert.match(err({address: '2606001521', tokens: ['123']})[0], /20 digits/);
  assert.match(err({address: '2606001521', tokens: ['1', '2', '3', '4', '5'].map(x => x.repeat(20))})[0], /at most 4/);
  assert.match(err({address: '2606001521', tokens: []})[0], /no token/);
  assert.match(err({address: '26060015', tokens: ['1'.repeat(20)]})[0], /10-digit/);
});
