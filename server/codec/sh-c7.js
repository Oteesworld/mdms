/**
 * SH Meters ultrasonic STS water meter (SH-L-EU868), "C7" protocol: ChirpStack v4 payload codec.
 *
 * Based on the vendor's ChirpStack v3 decoder (function_C7_Decode.js) and encoder
 * (function_C7_Encode.js), with these changes:
 *   - v4 entry points: decodeUplink(input) -> {data, warnings, errors}, encodeDownlink(input) -> {bytes} | {errors},
 *     decodeDownlink(input) for the token frames.
 *   - Frames are checked: start byte 0x68, length byte, CRC-8 and end byte 0x16. A frame that fails the CRC
 *     returns no readings (crc_ok: false and a warning), so a corrupted frame cannot become a meter value.
 *   - Only data reports (function 0xC7) are parsed as TLV fields. Status frames (0xC2) have their own layout and
 *     were decoded by the vendor file as false values (e.g. an 83.2 m3 overdraft limit); see decodeC2 below.
 *   - Link messages on fPort 223 (ff ff .. .. 00 ff) are labelled instead of reported as errors.
 *   - The status-word valve bit and the valve-state command (39) no longer share the name "valveStatus":
 *     they are valveAlarm (status bit) and valveState ("open" / "closed" / "fault").
 *   - Flags and counters are numbers, not strings.
 *   - The newest record is at the top level; older hourly records (command 41) are in history[], each with
 *     hoursAgo and the back-dated meterTime.
 *   - meterTime is the meter's own clock, which runs on local time: it is output as "YYYY-MM-DD HH:MM:SS"
 *     without a zone (meterTimeZone: "meter local").
 *   - The token encoder validates its input: 1 to 4 tokens of exactly 20 digits (the token count has only
 *     2 bits) and a 10-digit meter address; invalid input returns errors instead of a malformed frame.
 *
 * Output keys used by the Leeroy MDMS dashboard and API: function_code, message, message_label, crc_ok, address,
 * meterTime, totalFlow, currentFlow, totalConsumption, totalPurchase, latestRecharge, hoardingAmount,
 * warningWater, creditWater, waterTemperature, voltageRtu, voltage, payload_hex, raw_hex, history, plus the
 * derived register_l, flow_lph, credit_l, battery_v, temperature_c, leak, burst, magnetic, low_battery.
 *
 * Plain ES5 so it runs in ChirpStack's JavaScript engine; the module.exports at the end is for tests only.
 */

// ====== byte helpers ======

function padLeft(str, length, padChar) {
  str = String(str);
  while (str.length < length) str = padChar + str;
  return str;
}

function toHex2(n) { return padLeft((n & 0xFF).toString(16), 2, '0').toUpperCase(); }

function bytesToHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += toHex2(bytes[i]);
  return s;
}

function hexToBytes(hex) {
  var s = String(hex || '').replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  var b = [];
  for (var i = 0; i + 1 < s.length; i += 2) b.push(parseInt(s.substring(i, i + 2), 16));
  return b;
}

function slice(array, start, end) {
  var out = [];
  for (var i = start; i < end; i++) out.push(array[i]);
  return out;
}

// CRC-8, polynomial 0xE5, initial value 0x00, over ADDR..last payload byte (checked against real frames).
function crc8(data) {
  var crc = 0x00;
  for (var i = 0; i < data.length; i++) {
    crc ^= (data[i] & 0xFF);
    for (var j = 0; j < 8; j++) crc = (crc & 0x80) ? ((crc << 1) ^ 0xE5) & 0xFF : (crc << 1) & 0xFF;
  }
  return crc;
}

function bcdToInt(b) { var v = b & 0xFF; return ((v >> 4) * 10) + (v & 0x0F); }

function isBcd(bytes) {
  for (var i = 0; i < bytes.length; i++) {
    if ((bytes[i] & 0xF0) > 0x90 || (bytes[i] & 0x0F) > 0x09) return false;
  }
  return true;
}

function bcdDigits(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String((bytes[i] >> 4) & 0x0F) + String(bytes[i] & 0x0F);
  return s;
}

function bytesToAscii(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0xFF);
  return s.replace(/^[\x00-\x20]+/, '').replace(/[\x00-\x20]+$/, '');
}

function scaled(n, dot) { return dot > 0 ? parseFloat((n / Math.pow(10, dot)).toFixed(dot)) : n; }

function round(v, digits) { var f = Math.pow(10, digits); return Math.round(v * f) / f; }

// Unsigned big-endian integer (fields are at most 4 bytes, so this stays exact).
function uintBE(bytes) {
  var n = 0;
  for (var i = 0; i < bytes.length; i++) n = n * 256 + (bytes[i] & 0xFF);
  return n;
}

// 6 BCD bytes [yy, MM, dd, hh, mm, ss] -> {text, ms} where ms treats the meter's local time as if it were UTC
// (only used for hour arithmetic on history records).
function parseMeterTime(bytes) {
  if (!isBcd(bytes)) return null;
  var y = 2000 + bcdToInt(bytes[0]), mo = bcdToInt(bytes[1]), d = bcdToInt(bytes[2]);
  var h = bcdToInt(bytes[3]), mi = bcdToInt(bytes[4]), s = bcdToInt(bytes[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  var ms = Date.UTC(y, mo - 1, d, h, mi, s);
  return {text: formatTime(ms), ms: ms};
}

function formatTime(ms) {
  var t = new Date(ms);
  return t.getUTCFullYear() + '-' + padLeft(t.getUTCMonth() + 1, 2, '0') + '-' + padLeft(t.getUTCDate(), 2, '0') + ' ' +
    padLeft(t.getUTCHours(), 2, '0') + ':' + padLeft(t.getUTCMinutes(), 2, '0') + ':' + padLeft(t.getUTCSeconds(), 2, '0');
}

// ====== C7 TLV fields (vendor table) ======
// Control byte: bits 7-6 = number of decimals (dot), bits 5-0 = command.

var HEX = 1, BCD = 2, NUM = 3, NUM_BCD = 4, ASCII = 5, UINT = 6, SINT = 7, VALVE = 8, TIME = 9, STATUS = 10, SKIP = 11;
var CMD_GAP = 41; // starts an older record; its data byte = hours before the first record

// command -> [byteLength, kind, outputKey]                         unit
var FIELDS = {
  0: [8, HEX, 'paramEnableBit'],
  1: [6, TIME, 'meterTime'],
  2: [5, SKIP, 'address'],                 // in-frame address; the header address is used
  3: [4, NUM, 'totalFlow'],                // m3, display P-0
  4: [3, NUM, 'currentFlow'],              // m3/h, P-1
  5: [4, NUM, 'totalFlowReverse'],         // m3
  6: [3, NUM, 'currentFlowReverse'],       // m3/h
  7: [2, NUM_BCD, 'waterTemperature'],     // degC, P-A
  8: [2, NUM_BCD, 'voltage'],              // V, meter supply
  9: [2, NUM_BCD, 'voltageRtu'],           // V, battery, P-B
  10: [2, STATUS, null],
  11: [2, NUM, 'hourlyConsumption'],       // m3
  12: [3, BCD, 'reportInterval'],
  13: [1, NUM_BCD, 'moduleType'],
  14: [5, HEX, 'directReadParams'],
  15: [4, NUM, 'leakThreshold'],
  16: [4, NUM, 'burstThreshold'],
  17: [2, NUM_BCD, 'leakBurstInterval'],
  18: [2, NUM_BCD, 'funcGmdRmd'],
  19: [2, BCD, 'runFlagEmf'],
  20: [5, BCD, 'wellNumber'],
  21: [2, NUM, 'valveOvercurrent'],
  22: [2, NUM, 'valveTimeout'],
  23: [1, NUM, 'washCount'],
  24: [20, HEX, 'modbusParams'],
  25: [4, NUM, 'pulseEquivalent'],
  26: [10, HEX, 'simCcid'],
  27: [8, HEX, 'moduleImei'],
  28: [10, ASCII, 'apn'],
  29: [24, ASCII, 'ipAddr'],
  30: [2, UINT, 'port'],
  31: [1, HEX, 'networkMode'],
  32: [4, NUM, 'totalConsumption'],        // m3, P-3
  33: [4, NUM, 'totalPurchase'],           // m3, P-4
  34: [4, NUM, 'latestRecharge'],          // m3, P-5
  35: [4, NUM, 'hoardingAmount'],          // m3, P-6 maximum recharge limit
  36: [2, NUM, 'warningWater'],            // m3, P-8 alarm volume
  37: [2, NUM, 'creditWater'],             // m3, P-9 overdraft limit
  38: [1, HEX, 'tamperRecord'],
  39: [1, VALVE, 'valveState'],
  40: [1, SINT, 'signalStrength'],
  42: [3, ASCII, 'version'],
  62: [10, SKIP, 'token']
};

// Status word: byte 1 holds the meter alarms, byte 0 the analytics and radio state.
var STATUS_B1 = ['emptyPipe', 'flowStatus', 'openStatus', 'actuatorStatus', 'counterStatus', 'voltageStatus', 'valveAlarm', 'magneticAttackStatus'];
var STATUS_B0 = ['leakageStatus', 'burstAnalysis', 'netStatus', null, null, null, 'realtimeInfoFlag', 'isStatusValid'];

function applyField(rec, spec, data, dot, warnings) {
  var kind = spec[1], key = spec[2], value, i;
  switch (kind) {
    case TIME:
      var t = parseMeterTime(data);
      if (t) { rec.meterTime = t.text; rec._ms = t.ms; } else warnings.push('meterTime: invalid timestamp ' + bytesToHex(data));
      return;
    case STATUS:
      for (i = 0; i < 8; i++) if (STATUS_B1[i]) rec[STATUS_B1[i]] = (data[1] >> i) & 1;
      for (i = 0; i < 8; i++) if (STATUS_B0[i]) rec[STATUS_B0[i]] = (data[0] >> i) & 1;
      rec.motorStatus = (data[0] >> 3) & 0x07;
      return;
    case SKIP: return;
    case HEX: value = bytesToHex(data); break;
    case UINT: value = uintBE(data); break;
    case NUM: value = scaled(uintBE(data), dot); break;
    case ASCII: value = bytesToAscii(data); break;
    case SINT: value = (data[0] & 0x7F) - (data[0] & 0x80); break;
    case VALVE: value = data[0] === 0x7E ? 'open' : (data[0] === 0x69 ? 'closed' : 'fault'); break;
    default: // BCD kinds
      if (!isBcd(data)) value = null;
      else if (kind === BCD) value = bcdDigits(data);
      else value = scaled(parseInt(bcdDigits(data), 10), dot);
  }
  if (value === null || value === undefined || value === '' || (typeof value === 'number' && isNaN(value))) {
    warnings.push(key + ': undecodable value ' + bytesToHex(data));
    return;
  }
  rec[key] = value;
}

// Values in the dashboard's units, added to every record that has the source field.
function derive(rec) {
  if (typeof rec.totalFlow === 'number') rec.register_l = round(rec.totalFlow * 1000, 3);
  if (typeof rec.currentFlow === 'number') rec.flow_lph = round(rec.currentFlow * 1000, 3);
  if (typeof rec.totalPurchase === 'number' && typeof rec.totalConsumption === 'number') rec.credit_l = round((rec.totalPurchase - rec.totalConsumption) * 1000, 3);
  if (typeof rec.voltageRtu === 'number') rec.battery_v = rec.voltageRtu;
  if (typeof rec.waterTemperature === 'number') rec.temperature_c = rec.waterTemperature;
  if (rec.leakageStatus !== undefined) rec.leak = rec.leakageStatus === 1;
  if (rec.burstAnalysis !== undefined) rec.burst = rec.burstAnalysis === 1;
  if (rec.magneticAttackStatus !== undefined) rec.magnetic = rec.magneticAttackStatus === 1;
  if (rec.voltageStatus !== undefined) rec.low_battery = rec.voltageStatus === 1;
  return rec;
}

function decodeC7(payload, out, warnings) {
  var records = [], cur = {}, pos = 0, hoursAgo = 0;
  while (pos < payload.length) {
    var ctrl = payload[pos++] & 0xFF, cmd = ctrl & 0x3F, dot = (ctrl >> 6) & 0x03;
    if (cmd === CMD_GAP) {
      records.push(cur);
      if (pos >= payload.length) { warnings.push('record gap without hour count'); cur = null; break; }
      hoursAgo = payload[pos++] & 0xFF;
      cur = {hoursAgo: hoursAgo};
      if (records[0]._ms !== undefined) { cur._ms = records[0]._ms - hoursAgo * 3600000; cur.meterTime = formatTime(cur._ms); }
      continue;
    }
    var spec = FIELDS[cmd];
    if (!spec) { warnings.push('unknown command 0x' + toHex2(cmd) + ' at byte ' + (pos - 1) + '; rest of frame skipped'); break; }
    if (payload.length - pos < spec[0]) { warnings.push('command 0x' + toHex2(cmd) + ' truncated'); break; }
    applyField(cur, spec, slice(payload, pos, pos + spec[0]), dot, warnings);
    pos += spec[0];
  }
  if (cur) records.push(cur);
  for (var i = 0; i < records.length; i++) { delete records[i]._ms; derive(records[i]); }
  var first = records[0] || {};
  for (var k in first) if (first.hasOwnProperty(k)) out[k] = first[k];
  if (records.length > 1) out.history = records.slice(1);
  out.record_count = records.length;
  out.decoded = true;
}

// Status frame (0xC2): not in the vendor decoder. Layout inferred from meter 0288260615217 and checked against
// its display: bytes 0-3 field A, where the low 24 bits are the total reading in 0.1 m3 (A = 197 while P-0 showed
// 19.7 m3; the top byte once carried a stray 0x14 and is ignored); bytes 8-9 BCD meter supply voltage (3.65 V,
// not the P-B battery voltage); the frame ends with the meter clock as BCD ss mm hh DD MM YY.
// Fields B, D and the flags are passed through unconfirmed.
function decodeC2(payload, out, warnings) {
  out.payload_hex = bytesToHex(payload).toLowerCase();
  if (payload.length >= 6) {
    var t = parseMeterTime(slice(payload, payload.length - 6, payload.length).reverse());
    if (t) out.meterTime = t.text; else warnings.push('C2 meter clock not decodable');
  }
  if (payload.length === 26) {
    out.c2_a = uintBE(slice(payload, 0, 4));
    if (payload[0] !== 0) { out.c2_a_top_byte = toHex2(payload[0]); warnings.push('C2 field A top byte 0x' + toHex2(payload[0]) + ' ignored'); }
    out.totalFlow = round(uintBE(slice(payload, 1, 4)) / 10, 1);
    out.c2_b = uintBE(slice(payload, 4, 8));
    var c = slice(payload, 8, 10), d = slice(payload, 10, 12);
    if (isBcd(c)) out.voltage = scaled(parseInt(bcdDigits(c), 10), 2);
    if (isBcd(d)) out.c2_d_bcd = scaled(parseInt(bcdDigits(d), 10), 2);
    out.c2_flags = toHex2(payload[12]);
    out.c2_rest_hex = bytesToHex(slice(payload, 13, 20)).toLowerCase();
    out.c2_unconfirmed = ['c2_b', 'c2_d_bcd', 'c2_flags', 'c2_rest_hex'];
    derive(out);
  } else {
    warnings.push('C2 frame of unexpected length ' + payload.length + ': only the clock was decoded');
  }
  out.decoded = false;
}

var FUNCTIONS = {0xC7: ['data_report', 'Data report'], 0xC2: ['status_c2', 'Status'], 0xC8: ['token', 'Token']};

// ====== uplink ======

function decodeUplink(input) {
  var bytes = input.bytes || [], fPort = input.fPort, warnings = [], errors = [];
  var out = {port: fPort, length: bytes.length, raw_hex: bytesToHex(bytes).toLowerCase(), protocol: 'sh_c7'};

  // fPort 223: short link message, no meter data
  if (bytes.length === 6 && bytes[0] === 0xFF && bytes[1] === 0xFF && bytes[5] === 0xFF) {
    out.message = 'link'; out.message_label = 'Link message'; out.decoded = false;
    return {data: out, warnings: warnings, errors: errors};
  }
  if (bytes.length < 10 || bytes[0] !== 0x68) {
    out.message = 'unknown'; out.message_label = 'Unknown frame'; out.decoded = false;
    warnings.push(bytes.length < 10 ? 'frame too short' : 'no 0x68 start byte');
    return {data: out, warnings: warnings, errors: errors};
  }

  var header = bytes[1] === 0xFF ? 3 : 2;
  var len = bytes[1] === 0xFF ? 255 + bytes[2] : bytes[1];
  var body = slice(bytes, header, bytes.length - 2); // address .. last payload byte
  if (len !== body.length) warnings.push('length byte says ' + len + ' bytes, frame has ' + body.length);
  if (bytes[bytes.length - 1] !== 0x16) warnings.push('missing 0x16 end byte');
  var crc = crc8(body);
  out.crc_ok = crc === bytes[bytes.length - 2];

  out.address = bcdDigits(slice(body, 0, 5));
  var fc = body[5];
  out.function_code = '0x' + toHex2(fc);
  var f = FUNCTIONS[fc] || ['function_' + toHex2(fc).toLowerCase(), 'Function 0x' + toHex2(fc)];
  out.message = f[0]; out.message_label = f[1];

  if (!out.crc_ok) {
    warnings.push('CRC mismatch (calculated 0x' + toHex2(crc) + ', frame 0x' + toHex2(bytes[bytes.length - 2]) + '): readings not decoded');
    out.decoded = false;
    return {data: out, warnings: warnings, errors: errors};
  }

  var payload = slice(body, 6, body.length);
  if (fc === 0xC7) decodeC7(payload, out, warnings);
  else if (fc === 0xC2) decodeC2(payload, out, warnings);
  else { out.payload_hex = bytesToHex(payload).toLowerCase(); out.decoded = false; }
  out.meterTimeZone = 'meter local';
  return {data: out, warnings: warnings, errors: errors};
}

// ====== downlink: STS token frame (function 0xC8, command 62) ======
// input.data = {address: "2606001521", tokens: ["12345678901234567890", ...]}  (or token: "a, b")
// Frame: 68 LEN ADDR(5) C8 CTRL TOKEN... CRC 16, CTRL = ((count - 1) << 6) | 62

var CMD_TOKEN = 62, MAX_TOKENS = 4;

function encodeDownlink(input) {
  var d = input.data || {}, errors = [];
  var address = String(d.address || '').replace(/\s+/g, '');
  var tokens = d.tokens || d.token || [];
  if (typeof tokens === 'string') tokens = tokens.split(/[,;\n]+/);
  var list = [];
  for (var i = 0; i < tokens.length; i++) {
    var tk = String(tokens[i]).replace(/[\s-]+/g, '');
    if (tk === '') continue;
    if (!/^\d{20}$/.test(tk)) errors.push('token ' + (i + 1) + ' must be exactly 20 digits (got "' + tokens[i] + '")');
    else list.push(tk);
  }
  if (!/^\d{10}$/.test(address)) errors.push('address must be the 10-digit meter address (got "' + d.address + '")');
  if (list.length === 0 && errors.length === 0) errors.push('no token to send');
  if (list.length > MAX_TOKENS) errors.push('at most ' + MAX_TOKENS + ' tokens per frame (got ' + list.length + ')');
  if (errors.length) return {errors: errors};

  var body = hexToBytes(address).concat([0xC8, (((list.length - 1) << 6) & 0xC0) | CMD_TOKEN]);
  for (var j = 0; j < list.length; j++) body = body.concat(hexToBytes(list[j]));
  var frame = [0x68].concat(body.length > 255 ? [0xFF, body.length - 255] : [body.length], body);
  frame.push(crc8(body), 0x16);
  return {bytes: frame};
}

// Shows queued token downlinks in readable form in the ChirpStack console.
function decodeDownlink(input) {
  var b = input.bytes || [];
  if (b.length < 10 || b[0] !== 0x68) return {data: {raw_hex: bytesToHex(b).toLowerCase()}};
  var header = b[1] === 0xFF ? 3 : 2, body = slice(b, header, b.length - 2);
  var out = {address: bcdDigits(slice(body, 0, 5)), function_code: '0x' + toHex2(body[5]), crc_ok: crc8(body) === b[b.length - 2]};
  if (body[5] === 0xC8 && (body[6] & 0x3F) === CMD_TOKEN) {
    var n = ((body[6] >> 6) & 0x03) + 1;
    out.tokens = [];
    for (var i = 0; i < n; i++) out.tokens.push(bcdDigits(slice(body, 7 + i * 10, 17 + i * 10)));
  }
  return {data: out};
}

if (typeof module !== 'undefined') module.exports = {decodeUplink: decodeUplink, encodeDownlink: encodeDownlink, decodeDownlink: decodeDownlink, crc8: crc8};
