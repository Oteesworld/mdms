/**
 * Amplified IoT water meter payload codec (ChirpStack v4 JavaScript codec).
 *
 * The same file is pushed to the ChirpStack device profile by
 * `npm run cs -- codec:push` and loaded by the mdms server as a fallback, so
 * there is one source of truth for how meter bytes become readable values.
 *
 * 1. SH Meters STS ultrasonic water meter (SH-L-EU868), "C7" protocol, ported
 *    from the vendor's ChirpStack v3 decoder (function_C7_Decode.js) and
 *    encoder (function_C7_Encode.js):
 *
 *      68 | LEN (or FF LEN') | ADDR (5 bytes) | FUNC | TLV fields... | CRC-8 | 16
 *
 *    - CRC-8: polynomial 0xE5, init 0x00, over ADDR..last field.
 *    - FUNC 0xC7: data report. Fields are TLV: control byte = dot (bits 7-6,
 *      number of decimals) + command (bits 5-0); the command sets the length.
 *      Command 41 starts an older record (data byte = hours before the first),
 *      so one uplink can carry up to 24 hourly records.
 *    - FUNC 0xC8: token downlink (see encodeDownlink).
 *    - Other function codes (e.g. 0xC2 sent after joining) are passed through
 *      raw: their layout is not in the vendor decoder.
 *    The meter sends data on fPort 2; fPort 223 carries a short link message
 *    (ff ff .. .. 00 ff) with no meter data.
 *
 * 2. Legacy port map from the earlier LEEROY meters (ports 5, 37, 59, 60, 61,
 *    65, 66, 210, 225), used for payloads that are not 0x68 frames.
 *
 * Output field names the dashboard understands: register_l, flow_lph,
 * credit_l, battery_v, temperature_c, valve ("open"/"closed"), leak, burst,
 * magnetic, low_battery, history[] (older hourly records with hours_ago).
 */

// ====== helpers (ES5) ======

function padLeft(str, length, padChar) {
  str = String(str);
  while (str.length < length) str = padChar + str;
  return str;
}

function toHex2(n) { return padLeft((n & 0xFF).toString(16), 2, '0').toUpperCase(); }

function bytesToHex(bytes) {
  var s = [];
  for (var i = 0; i < bytes.length; i++) s.push(toHex2(bytes[i]));
  return s.join('');
}

function arraySlice(array, start, end) {
  var out = [];
  for (var i = start; i < end; i++) out.push(array[i]);
  return out;
}

// CRC-8, polynomial 0xE5, initial value 0x00 (vendor algorithm).
function calculateCRC8(data) {
  var crc = 0x00;
  for (var i = 0; i < data.length; i++) {
    crc ^= (data[i] & 0xFF);
    for (var j = 0; j < 8; j++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0xE5) & 0xFF : (crc << 1) & 0xFF;
    }
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

function scaleDigits(digits, radix, dot) {
  var n = parseInt(digits, radix);
  if (isNaN(n)) return null;
  return dot > 0 ? parseFloat((n / Math.pow(10, dot)).toFixed(dot)) : n;
}

// 6-byte BCD [yy, MM, dd, hh, mm, ss]: the meter's own clock (local time, no zone).
function parseMeterTime(bytes) {
  if (!isBcd(bytes)) return null;
  var y = 2000 + bcdToInt(bytes[0]), mo = bcdToInt(bytes[1]), d = bcdToInt(bytes[2]);
  var h = bcdToInt(bytes[3]), mi = bcdToInt(bytes[4]), s = bcdToInt(bytes[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return y + '-' + padLeft(mo, 2, '0') + '-' + padLeft(d, 2, '0') + ' ' +
    padLeft(h, 2, '0') + ':' + padLeft(mi, 2, '0') + ':' + padLeft(s, 2, '0');
}

// ====== SH C7 TLV table (from the vendor decoder) ======

var KIND_HEX = 1, KIND_BCD = 2, KIND_NUM = 3, KIND_NUM_BCD = 4, KIND_ASCII = 5, KIND_UINT = 6,
  KIND_SINT = 7, KIND_VALVE = 8, KIND_TIME = 9, KIND_STATUS = 10, KIND_SKIP = 11;
var CMD_GAP = 41;

// command -> [byteLength, kind, outputKey]
var FIELDS = {
  0: [8, KIND_HEX, 'paramEnableBit'],
  1: [6, KIND_TIME, 'meterTime'],
  2: [5, KIND_SKIP, 'address'],
  3: [4, KIND_NUM, 'totalFlow'],            // m3
  4: [3, KIND_NUM, 'currentFlow'],          // m3/h
  5: [4, KIND_NUM, 'totalFlowReverse'],     // m3
  6: [3, KIND_NUM, 'currentFlowReverse'],   // m3/h
  7: [2, KIND_NUM_BCD, 'waterTemperature'], // degC
  8: [2, KIND_NUM_BCD, 'voltage'],
  9: [2, KIND_NUM_BCD, 'voltageRtu'],       // battery, V
  10: [2, KIND_STATUS],
  11: [2, KIND_NUM, 'hourlyConsumption'],
  12: [3, KIND_BCD, 'reportInterval'],
  13: [1, KIND_NUM_BCD, 'moduleType'],
  14: [5, KIND_HEX, 'directReadParams'],
  15: [4, KIND_NUM, 'leakThreshold'],
  16: [4, KIND_NUM, 'burstThreshold'],
  17: [2, KIND_NUM_BCD, 'leakBurstInterval'],
  18: [2, KIND_NUM_BCD, 'funcGmdRmd'],
  19: [2, KIND_BCD, 'runFlagEmf'],
  20: [5, KIND_BCD, 'wellNumber'],
  21: [2, KIND_NUM, 'valveOvercurrent'],
  22: [2, KIND_NUM, 'valveTimeout'],
  23: [1, KIND_NUM, 'washCount'],
  24: [20, KIND_HEX, 'modbusParams'],
  25: [4, KIND_NUM, 'pulseEquivalent'],
  26: [10, KIND_HEX, 'simCcid'],
  27: [8, KIND_HEX, 'moduleImei'],
  28: [10, KIND_ASCII, 'apn'],
  29: [24, KIND_ASCII, 'ipAddr'],
  30: [2, KIND_UINT, 'port'],
  31: [1, KIND_HEX, 'networkMode'],
  32: [4, KIND_NUM, 'totalConsumption'],    // m3 consumed against credit
  33: [4, KIND_NUM, 'totalPurchase'],       // m3 purchased
  34: [4, KIND_NUM, 'latestRecharge'],      // m3
  35: [4, KIND_NUM, 'hoardingAmount'],      // m3
  36: [2, KIND_NUM, 'warningWater'],        // low-credit alarm volume, m3
  37: [2, KIND_NUM, 'creditWater'],         // overdraft limit, m3
  38: [1, KIND_HEX, 'tamperRecord'],
  39: [1, KIND_VALVE, 'valveState'],
  40: [1, KIND_SINT, 'signalStrength'],
  42: [3, KIND_ASCII, 'version'],
  62: [10, KIND_SKIP, 'token']
};

var STATUS_BITS_B1 = ['emptyPipe', 'flowStatus', 'openStatus', 'actuatorStatus',
  'counterStatus', 'voltageStatus', 'valveStatus', 'magneticAttackStatus'];
var STATUS_BITS_B0 = ['leakageStatus', 'burstAnalysis', 'netStatus', null, null, null,
  'realtimeInfoFlag', 'isStatusValid'];

function readStatus(rec, data) {
  var i;
  for (i = 0; i < 8; i++) if (STATUS_BITS_B1[i]) rec[STATUS_BITS_B1[i]] = (data[1] & (1 << i)) ? 1 : 0;
  for (i = 0; i < 8; i++) if (STATUS_BITS_B0[i]) rec[STATUS_BITS_B0[i]] = (data[0] & (1 << i)) ? 1 : 0;
  rec.motorStatus = (data[0] >> 3) & 0x07;
}

function applyField(rec, spec, data, dot, warnings) {
  var kind = spec[1], key = spec[2], value;
  switch (kind) {
    case KIND_TIME:
      value = parseMeterTime(data);
      if (value) rec.meterTime = value; else warnings.push('meterTime: invalid timestamp');
      return;
    case KIND_STATUS: readStatus(rec, data); return;
    case KIND_SKIP: return;
    case KIND_HEX: value = bytesToHex(data); break;
    case KIND_UINT: value = scaleDigits(bytesToHex(data), 16, 0); break;
    case KIND_NUM: value = scaleDigits(bytesToHex(data), 16, dot); break;
    case KIND_ASCII: value = bytesToAscii(data); break;
    case KIND_SINT: value = (data[0] & 0x7F) - (data[0] & 0x80); break;
    case KIND_VALVE: value = data[0] === 0x7E ? 1 : (data[0] === 0x69 ? 0 : 2); break;
    default:
      if (!isBcd(data)) value = null;
      else if (kind === KIND_BCD) value = bcdDigits(data);
      else value = scaleDigits(bcdDigits(data), 10, dot);
  }
  if (value === null || value === undefined || value === '') { warnings.push(key + ': undecodable value'); return; }
  rec[key] = value;
}

function round(n, d) { var p = Math.pow(10, d); return Math.round(n * p) / p; }

// Add the dashboard's normalised names to one decoded record.
function normaliseRecord(rec) {
  if (typeof rec.totalFlow === 'number') rec.register_l = round(rec.totalFlow * 1000, 3);
  if (typeof rec.currentFlow === 'number') rec.flow_lph = round(rec.currentFlow * 1000, 3);
  if (typeof rec.voltageRtu === 'number') rec.battery_v = rec.voltageRtu;
  if (typeof rec.waterTemperature === 'number') rec.temperature_c = rec.waterTemperature;
  if (typeof rec.totalPurchase === 'number' && typeof rec.totalConsumption === 'number') {
    rec.credit_l = round((rec.totalPurchase - rec.totalConsumption) * 1000, 3);
  }
  if (rec.valveState === 1) rec.valve = 'open';
  else if (rec.valveState === 0) rec.valve = 'closed';
  if (rec.leakageStatus === 1) rec.leak = true;
  if (rec.burstAnalysis === 1) rec.burst = true;
  if (rec.magneticAttackStatus === 1) rec.magnetic = true;
  if (rec.voltageStatus === 1) rec.low_battery = true;
}

var FUNCTIONS = { 0xC7: 'data_report', 0xC8: 'token', 0xC2: 'status_c2' };

function decodeShFrame(bytes, warnings) {
  if (bytes.length < 10) return { error: 'frame too short' };
  var headerSize = bytes[1] === 0xFF ? 3 : 2;
  var crc = bytes[bytes.length - 2];
  var body = arraySlice(bytes, headerSize, bytes.length - 2);
  var crcOk = calculateCRC8(body) === crc;
  if (!crcOk) warnings.push('CRC mismatch');
  if (bytes[bytes.length - 1] !== 0x16) warnings.push('missing 0x16 end byte');

  var out = {
    protocol: 'sh_c7',
    address: bytesToHex(arraySlice(body, 0, 5)),
    function_code: '0x' + toHex2(body[5]),
    message: FUNCTIONS[body[5]] || 'function_' + toHex2(body[5]),
    crc_ok: crcOk
  };
  if (body[5] !== 0xC7) {
    out.message_label = body[5] === 0xC2 ? 'Status (C2)' : 'Function ' + out.function_code;
    out.payload_hex = bytesToHex(arraySlice(body, 6, body.length)).toLowerCase();
    if (body[5] === 0xC2 && body.length >= 12) {
      // C2 ends with the meter clock as BCD ss mm hh DD MM YY (checked against network
      // time across two frames). The rest of C2 is not in the vendor decoder.
      var t = arraySlice(body, body.length - 6, body.length).reverse();
      var mt = parseMeterTime(t);
      if (mt) out.meterTime = mt;
    }
    out.decoded = false;
    return out;
  }
  out.message_label = 'Data report';

  var records = [];
  var current = { hours_ago: 0 };
  var pos = 6;
  while (pos < body.length) {
    var ctrl = body[pos++] & 0xFF;
    var bm = ctrl & 0x3F;
    var dot = (ctrl >> 6) & 0x03;
    if (bm === CMD_GAP) {
      records.push(current);
      if (pos >= body.length) break;
      current = { hours_ago: body[pos++] & 0xFF };
      continue;
    }
    var spec = FIELDS[bm];
    if (!spec) { warnings.push('unknown command 0x' + toHex2(bm)); break; }
    if (body.length - pos < spec[0]) { warnings.push('command 0x' + toHex2(bm) + ' truncated'); break; }
    applyField(current, spec, arraySlice(body, pos, pos + spec[0]), dot, warnings);
    pos += spec[0];
  }
  records.push(current);

  for (var i = 0; i < records.length; i++) normaliseRecord(records[i]);
  // The newest record's values are the uplink's values; older ones go to history.
  var latest = records[0];
  for (var k in latest) if (latest.hasOwnProperty(k) && k !== 'hours_ago') out[k] = latest[k];
  if (records.length > 1) out.history = records.slice(1);
  out.record_count = records.length;
  out.decoded = true;
  return out;
}

// ====== legacy port map (non-0x68 payloads) ======

var PORTS = {
  2: { name: 'sh_data', label: 'Data report' },
  5: { name: 'ack', label: 'ACK-ACK' },
  37: { name: 'installation', label: 'Installation' },
  60: { name: 'midnight_data', label: 'Midnight data', reading: 'midnight' },
  61: { name: 'live_data', label: 'Live data', reading: 'live' },
  65: { name: 'tamper_alarm', label: 'Tamper alarm', alarm: 'tamper' },
  66: { name: 'burst_alarm', label: 'Burst alarm', alarm: 'burst' },
  210: { name: 'credit', label: 'Credit' },
  223: { name: 'link', label: 'Link message' },
  225: { name: 'come_back', label: 'Come back' }
};

function decodeUplink(input) {
  var bytes = input.bytes || [];
  var port = input.fPort;
  var warnings = [];
  var data;
  if (bytes.length >= 10 && bytes[0] === 0x68) {
    data = decodeShFrame(bytes, warnings);
  } else {
    var meta = PORTS[port];
    data = {
      message: meta ? meta.name : 'unknown',
      message_label: meta ? meta.label : 'Port ' + port,
      decoded: false
    };
    if (meta && meta.alarm) data.alarm = meta.alarm;
    if (meta && meta.reading) data.reading_type = meta.reading;
  }
  data.port = port;
  data.raw_hex = bytesToHex(bytes).toLowerCase();
  data.length = bytes.length;
  return { data: data, warnings: warnings };
}

// ====== downlinks ======

function hexToBytes(hex) {
  var s = String(hex || '').replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  var b = [];
  for (var i = 0; i + 1 < s.length; i += 2) b.push(parseInt(s.substring(i, i + 2), 16));
  return b;
}

/**
 * STS token delivery (vendor function 0xC8):
 *   { "address": "2606001521", "tokens": ["12345678901234567890"] }
 * -> 68 LEN ADDR C8 [ctrl(count-1, 62) token bytes...] CRC 16
 * Raw frames are also accepted: { "hex": "68...16", "fPort": 2 }.
 */
function encodeDownlink(input) {
  var d = input.data || {};
  if (typeof d.hex === 'string') return { bytes: hexToBytes(d.hex), fPort: d.fPort || input.fPort || 2 };

  var tokens = d.tokens || d.token;
  if (typeof tokens === 'string') tokens = tokens.split(/[,\n]+/);
  if (!tokens || !tokens.length) return { errors: ['provide tokens (20-digit STS) and address, or hex'] };
  var addr = hexToBytes(d.address);
  if (addr.length !== 5) return { errors: ['address must be the 10-digit meter address'] };
  for (var t = 0; t < tokens.length; t++) {
    if (!/^\d{20}$/.test(String(tokens[t]).replace(/\s/g, ''))) return { errors: ['token ' + (t + 1) + ' must be 20 digits'] };
  }
  if (tokens.length > 4) return { errors: ['at most 4 tokens per frame'] };

  var payload = [(((tokens.length - 1) << 6) & 0xC0) | 62];
  for (var i = 0; i < tokens.length; i++) payload = payload.concat(hexToBytes(tokens[i]));
  var dataLen = addr.length + 1 + payload.length;
  var frame = [0x68];
  if (dataLen > 255) frame.push(0xFF, (dataLen - 255) & 0xFF); else frame.push(dataLen & 0xFF);
  var crcStart = frame.length;
  frame = frame.concat(addr, [0xC8], payload);
  frame.push(calculateCRC8(arraySlice(frame, crcStart, frame.length)));
  frame.push(0x16);
  return { bytes: frame, fPort: input.fPort || 2 };
}

// Allow the mdms server to load this file as well.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decodeUplink: decodeUplink, encodeDownlink: encodeDownlink, PORTS: PORTS, calculateCRC8: calculateCRC8 };
}
