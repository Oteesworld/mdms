// What each decoded meter field means, from the SH Meters STS Ultrasonic Water
// Meter user manual (V1.03A) and the vendor's C7 protocol decoder.
// page = the meter display page (P-0 ... P-D) that shows the same value.
// flag = a 0/1 status bit, shown as Yes/No; alarm = a flag that raises an alarm.

export const FIELDS = {
  // --- readings (meter display pages) ---
  totalFlow: { label: 'Total meter reading', unit: 'm³', page: 'P-0', help: 'Cumulative forward volume through the meter.' },
  currentFlow: { label: 'Instantaneous flow', unit: 'm³/h', page: 'P-1', help: 'Flow rate at the time of the reading.' },
  credit_l: { label: 'Remaining water credit', unit: 'L', page: 'P-2', help: 'Purchased minus consumed water. The meter shows it in m³; negative means overdraft.' },
  totalConsumption: { label: 'Total water consumed (prepaid)', unit: 'm³', page: 'P-3', help: 'Water used against purchased credit.' },
  totalPurchase: { label: 'Total water purchased', unit: 'm³', page: 'P-4', help: 'Sum of all STS tokens loaded into the meter.' },
  latestRecharge: { label: 'Latest recharge', unit: 'm³', page: 'P-5', help: 'Volume added by the most recent token.' },
  hoardingAmount: { label: 'Accumulated water limit', unit: 'm³', page: 'P-7', help: 'Most credit the meter will hold; a token that would exceed it is refused with "Overflow".' },
  warningWater: { label: 'Low-credit alarm volume', unit: 'm³', page: 'P-8', help: 'The meter warns when remaining credit drops to this volume.' },
  creditWater: { label: 'Overdraft limit', unit: 'm³', page: 'P-9', help: 'How far below zero credit the meter keeps supplying before closing the valve.' },
  waterTemperature: { label: 'Water temperature', unit: '°C', page: 'P-A' },
  voltageRtu: { label: 'Battery voltage', unit: 'V', page: 'P-B', help: 'Built-in lithium battery.' },
  voltage: { label: 'Supply voltage', unit: 'V' },
  meterTime: { label: 'Meter clock', page: 'P-C / P-D', help: "The meter's own date and time (no time zone). Set it in SQCOMM > ParaSet > Time." },
  totalFlowReverse: { label: 'Total reverse volume', unit: 'm³', help: 'Water that flowed backwards through the meter.' },
  currentFlowReverse: { label: 'Reverse flow rate', unit: 'm³/h' },
  hourlyConsumption: { label: 'Consumption this hour', unit: 'm³' },

  // --- valve ---
  valve: { label: 'Valve', help: 'Built-in motorised ball valve: closes on zero credit (after overdraft), alarms or a platform command.' },
  valveState: { label: 'Valve code', help: '1 = open, 0 = closed, 2 = unknown/moving.' },
  motorStatus: { label: 'Valve motor state', help: 'Vendor motor state code.' },

  // --- alarm and status bits (LCD icons) ---
  leakageStatus: { label: 'Leak detected', flag: true, alarm: true, help: 'Continuous small flow over the leak detection period (set in SQCOMM).' },
  burstAnalysis: { label: 'Pipe burst detected', flag: true, alarm: true, help: 'Flow above the burst threshold for the burst period.' },
  magneticAttackStatus: { label: 'Magnetic attack', flag: true, alarm: true, help: 'A magnet was held against the meter (tamper).' },
  voltageStatus: { label: 'Low battery voltage', flag: true, alarm: true },
  emptyPipe: { label: 'Empty pipe', flag: true, help: 'No water in the pipe at the sensor.' },
  valveStatus: { label: 'Valve alarm bit', flag: true, help: 'Vendor valve status bit.' },
  flowStatus: { label: 'Flow status bit', flag: true },
  openStatus: { label: 'Open status bit', flag: true },
  actuatorStatus: { label: 'Actuator status bit', flag: true },
  counterStatus: { label: 'Counter status bit', flag: true },
  netStatus: { label: 'Network status bit', flag: true },
  realtimeInfoFlag: { label: 'Real-time report', flag: true, help: 'Set when the report was triggered on demand rather than on schedule.' },
  isStatusValid: { label: 'Status valid bit', flag: true },

  // --- configuration echoed by the meter ---
  reportInterval: { label: 'Report interval code' },
  leakThreshold: { label: 'Leak threshold', unit: 'm³/h' },
  burstThreshold: { label: 'Burst threshold', unit: 'm³/h' },
  leakBurstInterval: { label: 'Leak/burst detection period' },
  signalStrength: { label: 'Signal (meter-reported)' },
  version: { label: 'Firmware version' },
  tamperRecord: { label: 'Tamper record' },

  // --- frame ---
  address: { label: 'Meter address', help: 'Printed on the meter label as ADDR; also used to bind the CIU keypad and to address STS tokens.' },
  function_code: { label: 'Message type', help: '0xC7 = data report, 0xC2 = status, 0xC8 = token (downlink).' },
  crc_ok: { label: 'Checksum OK', flag: true },
  record_count: { label: 'Hourly records in this report' },
  history: { label: 'Older hourly records' },

  // --- C2 status frame: provisional split, not confirmed by the vendor ---
  c2_unconfirmed: { label: 'Status fields unconfirmed', flag: true },
  c2_a: { label: 'Status field A (unconfirmed)', help: 'Rises slowly over days; may be the total reading in litres. Compare with display P-0.' },
  c2_b: { label: 'Status field B (unconfirmed)' },
  c2_c_bcd: { label: 'Status field C (unconfirmed)', help: 'Looks like a voltage. Compare with display P-B.' },
  c2_d_bcd: { label: 'Status field D (unconfirmed)' },
  c2_flags: { label: 'Status flags (unconfirmed)' },
  c2_rest_hex: { label: 'Status bytes (unconfirmed)' },
};

// Normalised copies of vendor fields: hidden in the field list to avoid showing a value twice.
export const DUPLICATES = new Set(['register_l', 'flow_lph', 'battery_v', 'temperature_c', 'leak', 'burst', 'magnetic', 'low_battery']);

/** Format one field for display: { label, value, page, help, raw }. */
export function describe(key, value) {
  const f = FIELDS[key] ?? { label: key };
  let text;
  if (key === 'history' && Array.isArray(value)) text = `${value.length} record${value.length === 1 ? '' : 's'}`;
  else if (f.flag) text = value === 1 || value === true ? 'Yes' : value === 0 || value === false ? 'No' : String(value);
  else if (key === 'valve') text = value === 'open' ? 'Open' : value === 'closed' ? 'Closed' : String(value);
  else if (typeof value === 'number' && f.unit) text = `${value.toLocaleString('en-BW', { maximumFractionDigits: 3 })} ${f.unit}`;
  else text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return { label: f.label, value: text, page: f.page ?? '', help: f.help ?? '', alarm: Boolean(f.alarm && (value === 1 || value === true)), known: key in FIELDS };
}
