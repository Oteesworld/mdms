/**
 * ChirpStack codec: SH Meters STS ultrasonic water meter (device profile "SH Meters").
 * Uploaded together with codec/lib/sh-frame.js (library first).
 *
 * These meters (e.g. address 2606001521) send a C2 status frame every 4 h on fPort 2:
 *  - total meter reading, 0.1 m3 units (confirmed: 197 while display P-0 showed 19.7 m3)
 *  - meter voltage, BCD (3.65 V; the manual's "Voltage" column; display P-B is the
 *    separate RTU battery voltage)
 *  - meter clock, BCD ss mm hh DD MM YY
 *  - other fields kept as c2_* and marked unconfirmed
 * C7 data reports (after key code 11111) are decoded too. fPort 223 is a link message.
 */
function decodeUplink(input) {
  return shDecodeUplink(input, { c2Layout: true, model: 'sh' });
}

function encodeDownlink(input) {
  return shEncodeDownlink(input);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decodeUplink: decodeUplink, encodeDownlink: encodeDownlink, PORTS: PORTS, calculateCRC8: calculateCRC8 };
}
