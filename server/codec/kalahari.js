/**
 * ChirpStack codec: Kalahari prepaid ultrasonic water meter (device profile "Kalahari").
 * Uploaded together with codec/lib/sh-frame.js (library first).
 *
 * Kalahari meters (address series 00262300xx) send the vendor's C7 TLV data report on
 * fPort 2, decoded exactly as SH Meters' function_C7_Decode.js (checked on 102 real
 * frames): total volume, flow, reverse volume, water temperature, battery voltage
 * (RTU), status and alarm bits, consumption/purchase totals, valve state, and up to
 * 24 hourly records. Other function codes are passed through raw (the SH-meter C2
 * layout is not assumed for Kalahari). fPort 223 is a link message.
 * Downlink: STS token frame (function 0xC8) for the meter address.
 */
function decodeUplink(input) {
  return shDecodeUplink(input, { c2Layout: false, model: 'kalahari' });
}

function encodeDownlink(input) {
  return shEncodeDownlink(input);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decodeUplink: decodeUplink, encodeDownlink: encodeDownlink, PORTS: PORTS, calculateCRC8: calculateCRC8 };
}
