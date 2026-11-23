/**
 * ChirpStack codec: Honeywell LoRaWAN water meter (device profile "Honeywell").
 * Self-contained (does not use codec/lib/sh-frame.js).
 *
 * The meter (e.g. DevEUI 8695311001828500, JoinEUI 0000000000000000) sends one
 * 49-byte report a day on fPort 10, plus empty fPort 0 frames (MAC commands).
 * The vendor payload specification has not been supplied, so only what is clear
 * from the frames is decoded:
 *  - bytes 0-3: Unix timestamp, little-endian, always 22:00 UTC = local midnight
 *    (GMT+2) at the end of the reporting day                          -> reportTime
 *  - everything else is kept raw, with a few candidate fields marked unconfirmed
 *    (hw_*) so they can be checked against the meter or the vendor spec. None of
 *    them is used as a reading.
 */

function hwHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return s;
}

function hwU16le(b, i) { return b[i] | (b[i + 1] << 8); }
function hwU32le(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 16777216; }

function hwIso(sec) {
  var d = new Date(sec * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString().replace('.000Z', 'Z');
}

var PORTS = {
  0: { name: 'mac', label: 'MAC commands' },
  10: { name: 'daily_report', label: 'Daily report' }
};

function decodeUplink(input) {
  var b = input.bytes || [];
  var port = input.fPort;
  var meta = PORTS[port];
  var data = {
    model: 'honeywell',
    message: meta ? meta.name : 'unknown',
    message_label: meta ? meta.label : 'Port ' + port,
    decoded: false
  };
  var warnings = [];

  if (port === 10 && b.length === 49) {
    var ts = hwU32le(b, 0);
    data.reportTime = hwIso(ts);
    // Candidate fields, NOT confirmed (no vendor spec yet):
    data.hw_unconfirmed = true;
    data.hw_b4 = b[4];                       // 01 in every frame so far
    data.hw_b5_14_hex = hwHex(b.slice(5, 15)); // zeros so far
    data.hw_u32_15 = hwU32le(b, 15);         // 2666..3021 day to day: temperature in 0.01 C?
    data.hw_u16_19 = hwU16le(b, 19);         // 360/361: battery in 0.01 V?
    data.hw_u16_21 = hwU16le(b, 21);         // 364: second voltage in 0.01 V?
    data.hw_u32_41 = hwU32le(b, 41);         // 1000000 in every frame: a constant/unit?
  } else if (port === 10) {
    warnings.push('unexpected length ' + b.length + ' for the daily report');
  }

  data.port = port;
  data.raw_hex = hwHex(b);
  data.length = b.length;
  return { data: data, warnings: warnings };
}

function encodeDownlink(input) {
  var d = input.data || {};
  if (typeof d.hex === 'string' && /^([0-9a-fA-F]{2})*$/.test(d.hex)) {
    var out = [];
    for (var i = 0; i < d.hex.length; i += 2) out.push(parseInt(d.hex.substr(i, 2), 16));
    return { bytes: out, fPort: d.fPort || input.fPort };
  }
  return { errors: ['Honeywell downlinks are not defined yet; send {"hex": "...", "fPort": n}'] };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decodeUplink: decodeUplink, encodeDownlink: encodeDownlink, PORTS: PORTS };
}
