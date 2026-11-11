/**
 * Amplified IoT prepaid water meter: LoRaWAN payload codec.
 *
 * ChirpStack v4 JavaScript codec (decodeUplink / encodeDownlink). The same file
 * is pushed to the ChirpStack device profile by `npm run cs -- codec:push` and
 * loaded by the mdms server as a fallback decoder, so there is one source of
 * truth for how meter bytes become readable values.
 *
 * Port map (from the existing LEEROY system):
 *    5  ACK-ACK         acknowledgement of a downlink
 *   37  Installation    meter installed / commissioned
 *   60  Midnight data   daily register snapshot
 *   61  Live data       on-demand / periodic register snapshot
 *   65  Tamper alarm
 *   66  Burst alarm
 *  210  Credit          credit token accepted / balance report
 *  225  Come back       meter back online after an outage / power cycle
 *
 * BYTE LAYOUTS: the vendor payload specification has not been supplied yet, so
 * LAYOUTS below is empty and every uplink decodes to its port meaning plus the
 * raw bytes. To decode values, fill in a port's field list from the vendor spec,
 * e.g.
 *
 *   60: [
 *     ['register_l',  'u32le', 1],     // cumulative volume, litres
 *     ['battery_v',   'u8',    0.02],  // battery voltage
 *     ['status',      'flags8', ['valve_closed', 'tamper', 'leak', 'low_battery']],
 *   ],
 *
 * Supported types: u8, u16le, u16be, u24le, u24be, u32le, u32be, i8, i16le,
 * i16be, i32le, i32be, flags8, flags16le, skipN (skip N bytes).
 * The third element is a scale for numbers or the bit names (bit 0 first) for flags.
 *
 * Field names the dashboard understands: register_l, flow_lph, credit_l,
 * balance, battery_v, battery_pct, valve ("open"/"closed"), valve_closed,
 * tamper, leak, burst, reverse_flow, magnetic, low_battery, temperature_c.
 */

var PORTS = {
  5: { name: 'ack', label: 'ACK-ACK' },
  37: { name: 'installation', label: 'Installation' },
  60: { name: 'midnight_data', label: 'Midnight data', reading: 'midnight' },
  61: { name: 'live_data', label: 'Live data', reading: 'live' },
  65: { name: 'tamper_alarm', label: 'Tamper alarm', alarm: 'tamper' },
  66: { name: 'burst_alarm', label: 'Burst alarm', alarm: 'burst' },
  210: { name: 'credit', label: 'Credit' },
  225: { name: 'come_back', label: 'Come back' },
};

// Per-port field layouts. Fill in from the meter vendor's payload specification.
var LAYOUTS = {};

function toHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return s;
}

function readField(bytes, pos, type) {
  var m = /^skip(\d+)$/.exec(type);
  if (m) return { size: Number(m[1]), skip: true };
  var size = { u8: 1, i8: 1, flags8: 1, u16le: 2, u16be: 2, i16le: 2, i16be: 2, flags16le: 2,
    u24le: 3, u24be: 3, u32le: 4, u32be: 4, i32le: 4, i32be: 4 }[type];
  if (!size) throw new Error('unknown field type ' + type);
  if (pos + size > bytes.length) return { size: size, missing: true };
  var le = /le$/.test(type) || size === 1;
  var v = 0;
  for (var i = 0; i < size; i++) {
    var b = bytes[pos + (le ? size - 1 - i : i)];
    v = v * 256 + b;
  }
  if (type.charAt(0) === 'i') {
    var max = Math.pow(2, size * 8);
    if (v >= max / 2) v -= max;
  }
  return { size: size, value: v };
}

function applyLayout(bytes, layout, data, warnings) {
  var pos = 0;
  for (var i = 0; i < layout.length; i++) {
    var name = layout[i][0], type = layout[i][1], arg = layout[i][2];
    var f = readField(bytes, pos, type);
    pos += f.size;
    if (f.skip) continue;
    if (f.missing) {
      warnings.push('payload too short for field ' + name);
      break;
    }
    if (/^flags/.test(type)) {
      var bits = arg || [];
      for (var b = 0; b < bits.length; b++) if (bits[b]) data[bits[b]] = ((f.value >> b) & 1) === 1;
      data[name] = f.value;
    } else {
      var scale = typeof arg === 'number' ? arg : 1;
      data[name] = scale === 1 ? f.value : Math.round(f.value * scale * 1e6) / 1e6;
    }
  }
  if (pos < bytes.length) data.trailing_hex = toHex(bytes.slice(pos));
}

function decodeUplink(input) {
  var bytes = input.bytes || [];
  var port = input.fPort;
  var meta = PORTS[port];
  var data = {
    port: port,
    message: meta ? meta.name : 'unknown',
    message_label: meta ? meta.label : 'Port ' + port,
    raw_hex: toHex(bytes),
    length: bytes.length,
  };
  var warnings = [];
  if (meta && meta.alarm) data.alarm = meta.alarm;
  if (meta && meta.reading) data.reading_type = meta.reading;

  var layout = LAYOUTS[port];
  if (layout) {
    applyLayout(bytes, layout, data, warnings);
    data.decoded = true;
  } else {
    data.decoded = false;
    if (bytes.length) warnings.push('no byte layout defined for port ' + port + '; raw bytes only');
  }
  if (data.valve_closed !== undefined && data.valve === undefined) data.valve = data.valve_closed ? 'closed' : 'open';
  return { data: data, warnings: warnings };
}

function encodeDownlink(input) {
  // Downlink commands (credit token, valve open/close, time sync) need the
  // vendor spec too. Until then, accept pre-encoded hex: { "hex": "0a0b0c", "fPort": 210 }.
  var d = input.data || {};
  if (typeof d.hex === 'string' && /^([0-9a-fA-F]{2})*$/.test(d.hex)) {
    var out = [];
    for (var i = 0; i < d.hex.length; i += 2) out.push(parseInt(d.hex.substr(i, 2), 16));
    return { bytes: out, fPort: d.fPort || input.fPort };
  }
  return { errors: ['downlink encoding not defined yet; send {"hex": "..."}'] };
}

// Allow the mdms server to load this file with require()/import as well.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decodeUplink: decodeUplink, encodeDownlink: encodeDownlink, PORTS: PORTS, LAYOUTS: LAYOUTS };
}
