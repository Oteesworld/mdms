/**
 * LoRaWAN Smart Water Meter Codec
 * @description Multi-platform encode/decode functions (single file)
 *   Supported platform interfaces:
 *   - ChirpStack v4: decodeUplink(input) / encodeDownlink(input)
 *   - ChirpStack v3: Decode(fPort, bytes) / Encode(fPort, obj)
 *   - The Things Network: Decoder(bytes, port) / Encoder(obj, port)
 *   - Core logic: milesightDeviceDecode(fPort, bytes, timezone) / milesightDeviceEncode(obj)
 * @version 2.1.1 (Updated for specification V0.1.12)
 */

// ========== Utility Functions (Inline) ==========

function readUint8(bytes, offset) {
  return bytes[offset];
}

function readInt8(bytes, offset) {
  const value = bytes[offset];
  return value > 127 ? value - 256 : value;
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readInt16(bytes, offset) {
  const value = readUint16(bytes, offset);
  return value > 32767 ? value - 65536 : value;
}

function readUint32(bytes, offset) {
  return (bytes[offset] |
          bytes[offset + 1] << 8 |
          bytes[offset + 2] << 16 |
          bytes[offset + 3] << 24) >>> 0;
}

// V0.1.3: 新增有符号32位整数读取
function readInt32(bytes, offset) {
  const value = readUint32(bytes, offset);
  return value > 2147483647 ? value - 4294967296 : value;
}

function readUint40(bytes, offset) {
  let result = 0;
  for (let i = 0; i < 5; i++) {
    result += bytes[offset + i] << (8 * i);
  }
  return result;
}

// V0.1.3: 新增有符号40位整数读取
function readInt40(bytes, offset) {
  const value = readUint40(bytes, offset);
  const maxValue = 1099511627775;  // 2^40 / 2 - 1
  return value > maxValue ? value - 2199023255552 : value;
}

function writeUint8(value) {
  return [value & 0xFF];
}

function writeInt8(value) {
  return value < 0 ? value + 256 : value;
}

function writeUint16(value) {
  return [value & 0xFF, (value >> 8) & 0xFF];
}

function writeUint32(value) {
  return [
    value & 0xFF,
    (value >> 8) & 0xFF,
    (value >> 16) & 0xFF,
    (value >> 24) & 0xFF
  ];
}

// V0.1.3: 新增有符号32位整数写入
function writeInt32(value) {
  // 将负数转换为补码形式
  if (value < 0) {
    value = value + 4294967296;
  }
  return writeUint32(value);
}

function parseStatusByte(byte, bitNames) {
  const result = {};
  for (let i = 0; i < 8; i++) {
    if (bitNames[i] && ((byte >> i) & 1) === 1) {
      result[bitNames[i]] = true;
    }
  }
  return result;
}

// 告警白名单：仅解析并显示以下告警，其余告警位屏蔽（不解析也不显示）
// 屏蔽的告警位在下方位名数组中置为 null
const ALARM_WHITELIST = {
  // Byte 24
  dailyAnomaly: true, sustainedHighFlow: true, sustainedLowFlow: true,
  reverseFlowDetected: true, flowSensorFault: false, highPressure: true,
  lowPressure: true, pressureSensorFault: true,
  // Byte 25
  lowVoltageLevel1: true, lowVoltageLevel2: true, meterRemoved: true,
  highTemperature: true, lowTemperature: true, temperatureSensorFault: true,
  internalOverheat: true, internalTempFault: true,
  // Byte 26
  firmwareException: false, dataCorruption: false, meterCommFault: true,
  meterLowVoltageL1: true, meterLowVoltageL2: true, meterDataTamper: true,
  meterFirmwareFault: false, meterDataFault: false,
  // Byte 27
  emptyPipe: true, lowBalance: true, bubble: true, gnssDisplacement: false,
  magneticInterference: true, transducerFault: false, severeReverseFlow: true
};

function timestampToLocalString(utcTimestamp, timezone) {
  const offsetSeconds = timezone * 15 * 60;
  const localTimestamp = utcTimestamp + offsetSeconds;
  const date = new Date(localTimestamp * 1000);

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}_${hours}:${minutes}:${seconds}`;
}

function decodeCycleType(cycleTypeByte) {
  const periodBits = (cycleTypeByte >> 6) & 0x03;
  const value = cycleTypeByte & 0x3F;

  let period, multiplier;
  switch (periodBits) {
    case 0b00:
      period = "day";
      multiplier = 86400;
      break;
    case 0b01:
      period = "hour";
      multiplier = 3600;
      break;
    case 0b10:
      period = "minute";
      multiplier = 60;
      break;
    default:
      throw new Error(`Invalid period type: ${periodBits}`);
  }

  return {
    period,
    value,
    totalSeconds: value * multiplier
  };
}

// V0.1.4: 更新阀门状态解码（新格式）
function decodeValveState(valveStateByte) {
  // 从 Bit[5:2] 读取开度值（0-11）
  const openLevel = (valveStateByte >> 2) & 0x0F;

  // 转换为百分比：0-10 对应 0%-100%，11 表示未知
  const result = {
    openPercentage: openLevel <= 10 ? openLevel * 10 : null
  };

  // Bit[1]: 阀门故障
  if ((valveStateByte >> 1) & 1) {
    result.fault = true;
  }

  // Bit[0]: 阀门关阀后泄漏故障
  if (valveStateByte & 1) {
    result.leakFault = true;
  }

  return result;
}

// V0.1.4: 更新阀门状态编码（新格式）
function encodeValveSet(valveSet) {
  if (valveSet.openPercentage === undefined) {
    throw new Error("Missing parameters for valveSet: openPercentage required");
  }

  // 验证开度值
  const openPercentage = valveSet.openPercentage;
  if (openPercentage % 10 !== 0 || openPercentage < 0 || openPercentage > 100) {
    throw new Error(`Invalid openPercentage: ${openPercentage} (must be 0, 10, 20, ..., 100)`);
  }

  // Bit[7:6]: 预留（0）
  // Bit[5:2]: 阀门开度（0-10 对应 0%-100%）
  const openLevel = openPercentage / 10;
  let byte = (openLevel & 0x0F) << 2;  // 将开度值移到 Bit[5:2]

  // Bit[1]: 优先级标志（是否优先于用水预付费）
  if (valveSet.priority) {
    byte |= 0x02;
  }

  // Bit[0]: 强制标志（是否强制阀门动作）
  if (valveSet.force) {
    byte |= 0x01;
  }

  return byte;
}

// V0.1.11: 阀门功能编码（ValveFunc: 0=锁定, 1=启用）
function encodeValveFunc(valveFunc) {
  if (valveFunc === 0 || valveFunc === "locked") return 0;
  if (valveFunc === 1 || valveFunc === "enabled") return 1;
  throw new Error('Invalid valveFunc: ' + valveFunc + ' (must be 0/locked or 1/enabled)');
}

function encodeCycleType(period, value) {
  let periodBits;
  switch (period) {
    case "day": periodBits = 0b00; break;
    case "hour": periodBits = 0b01; break;
    case "minute": periodBits = 0b10; break;
    default: throw new Error(`Invalid period: ${period}`);
  }

  return (periodBits << 6) | (value & 0x3F);
}

function isNullValue(value, type) {
  if (type === "uint16") return value === 0xFFFF;
  if (type === "int16") return value === 0x7FFF;
  return false;
}

function isSignedNullBytes(bytes, offset, len) {
  // 有符号整型无效值: 低字节全为0xFF, 最高字节为0x7F
  for (let i = 0; i < len - 1; i++) {
    if (bytes[offset + i] !== 0xFF) return false;
  }
  return bytes[offset + len - 1] === 0x7F;
}

// ========== Core Decode Functions ==========
// Internal decoders return raw data objects or throw on error.
// timezone: integer (units of 15 minutes), default 0

function _decodeFPort10Data(bytes, timezone) {
  if (bytes.length !== 49) {
    throw new Error('Invalid payload length: ' + bytes.length + ' (expected 49)');
  }

  const utcTimestamp = readUint32(bytes, 0);
  const timestamp = timestampToLocalString(utcTimestamp, timezone);
  const cycleType = decodeCycleType(bytes[4]);

  const currentReading = readInt40(bytes, 5);
  const reverseFlow = readInt40(bytes, 10);

  const waterTemperatureRaw = readInt16(bytes, 15);
  const waterTemperature = isNullValue(waterTemperatureRaw & 0xFFFF, "int16")
    ? null
    : waterTemperatureRaw / 100.0;

  const waterPressureRaw = readUint16(bytes, 17);
  const waterPressure = isNullValue(waterPressureRaw, "uint16") ? null : waterPressureRaw;

  const commVoltageRaw = readUint16(bytes, 19);
  const communicationBoardVoltage = isNullValue(commVoltageRaw, "uint16") ? null : commVoltageRaw / 100.0;

  const meterVoltageRaw = readUint16(bytes, 21);
  const meterBoardVoltage = isNullValue(meterVoltageRaw, "uint16") ? null : meterVoltageRaw / 100.0;

  const valve = decodeValveState(bytes[23]);

  // 告警解析：仅解析白名单内的告警位，其余位屏蔽（置 null）
  const alarm1 = parseStatusByte(bytes[24], [
    ALARM_WHITELIST.dailyAnomaly ? "dailyAnomaly" : null,
    ALARM_WHITELIST.sustainedHighFlow ? "sustainedHighFlow" : null,
    ALARM_WHITELIST.sustainedLowFlow ? "sustainedLowFlow" : null,
    ALARM_WHITELIST.reverseFlowDetected ? "reverseFlowDetected" : null,
    ALARM_WHITELIST.flowSensorFault ? "flowSensorFault" : null,
    ALARM_WHITELIST.highPressure ? "highPressure" : null,
    ALARM_WHITELIST.lowPressure ? "lowPressure" : null,
    ALARM_WHITELIST.pressureSensorFault ? "pressureSensorFault" : null
  ]);
  const alarm2 = parseStatusByte(bytes[25], [
    ALARM_WHITELIST.lowVoltageLevel1 ? "lowVoltageLevel1" : null,
    ALARM_WHITELIST.lowVoltageLevel2 ? "lowVoltageLevel2" : null,
    ALARM_WHITELIST.meterRemoved ? "meterRemoved" : null,
    ALARM_WHITELIST.highTemperature ? "highTemperature" : null,
    ALARM_WHITELIST.lowTemperature ? "lowTemperature" : null,
    ALARM_WHITELIST.temperatureSensorFault ? "temperatureSensorFault" : null,
    ALARM_WHITELIST.internalOverheat ? "internalOverheat" : null,
    ALARM_WHITELIST.internalTempFault ? "internalTempFault" : null
  ]);
  const alarm3 = parseStatusByte(bytes[26], [
    ALARM_WHITELIST.firmwareException ? "firmwareException" : null,
    ALARM_WHITELIST.dataCorruption ? "dataCorruption" : null,
    ALARM_WHITELIST.meterCommFault ? "meterCommFault" : null,
    ALARM_WHITELIST.meterLowVoltageL1 ? "meterLowVoltageL1" : null,
    ALARM_WHITELIST.meterLowVoltageL2 ? "meterLowVoltageL2" : null,
    ALARM_WHITELIST.meterDataTamper ? "meterDataTamper" : null,
    ALARM_WHITELIST.meterFirmwareFault ? "meterFirmwareFault" : null,
    ALARM_WHITELIST.meterDataFault ? "meterDataFault" : null
  ]);
  const alarm4 = parseStatusByte(bytes[27], [
    ALARM_WHITELIST.emptyPipe ? "emptyPipe" : null,
    ALARM_WHITELIST.lowBalance ? "lowBalance" : null,
    ALARM_WHITELIST.bubble ? "bubble" : null,
    ALARM_WHITELIST.gnssDisplacement ? "gnssDisplacement" : null,
    ALARM_WHITELIST.magneticInterference ? "magneticInterference" : null,
    ALARM_WHITELIST.transducerFault ? "transducerFault" : null,
    ALARM_WHITELIST.severeReverseFlow ? "severeReverseFlow" : null,
    null
  ]);

  const prev1ForwardNull = isSignedNullBytes(bytes, 28, 4);
  const prev1ReverseNull = isSignedNullBytes(bytes, 32, 4);
  const prev2ForwardNull = isSignedNullBytes(bytes, 36, 4);
  const prev2ReverseNull = isSignedNullBytes(bytes, 40, 4);

  const prev1Forward = prev1ForwardNull ? 0 : readInt32(bytes, 28);
  const prev1Reverse = prev1ReverseNull ? 0 : readInt32(bytes, 32);
  const prev2Forward = prev2ForwardNull ? 0 : readInt32(bytes, 36);
  const prev2Reverse = prev2ReverseNull ? 0 : readInt32(bytes, 40);

  const periodSeconds = cycleType.totalSeconds;
  const history = [
    {
      timestamp: timestampToLocalString(utcTimestamp - periodSeconds, timezone),
      forwardReading: (prev1ForwardNull || prev1ReverseNull) ? null : currentReading - prev1Forward,
      reverseReading: (prev1ForwardNull || prev1ReverseNull) ? null : reverseFlow - prev1Reverse
    },
    {
      timestamp: timestampToLocalString(utcTimestamp - 2 * periodSeconds, timezone),
      forwardReading: (prev1ForwardNull || prev2ForwardNull) ? null : (currentReading - prev1Forward) - prev2Forward,
      reverseReading: (prev1ReverseNull || prev2ReverseNull) ? null : (reverseFlow - prev1Reverse) - prev2Reverse
    }
  ];

  // V0.1.6: 剩余可用水量（offset 44-48, int40 with null detection）
  const remainingBalanceNull = isSignedNullBytes(bytes, 44, 5);
  const remainingBalance = remainingBalanceNull ? null : readInt40(bytes, 44);

  return {
    timestamp, cycleType, currentReading, reverseFlow,
    waterTemperature, waterPressure,
    communicationBoardVoltage, meterBoardVoltage,
    valve,
    ...alarm1, ...alarm2, ...alarm3, ...alarm4,
    history,
    remainingBalance
  };
}

function _decodeFPort11Or12Data(bytes, timezone, isReverse) {
  const minLen = 11;
  if (bytes.length < minLen) {
    throw new Error('Invalid payload length: ' + bytes.length + ' (minimum ' + minLen + ')');
  }

  const startTsRaw = readUint32(bytes, 0);
  const startTimestamp = timestampToLocalString(startTsRaw, timezone);
  const samplingInterval = readUint16(bytes, 4);

  // 检测 int40 无效填充 (FF FF FF FF 7F)
  const baseReadingNull = isSignedNullBytes(bytes, 6, 5);
  const baseReading = baseReadingNull ? null : readInt40(bytes, 6);

  const incrementCount = bytes.length - 11;
  if (incrementCount % 4 !== 0) {
    throw new Error('Invalid increment data length: ' + incrementCount + ' (must be multiple of 4)');
  }

  const sampleCount = incrementCount / 4;
  const increments = [];
  for (let i = 0; i < sampleCount; i++) {
    const off = 11 + i * 4;
    // 检测 int32 无效填充 (FF FF FF 7F)
    if (isSignedNullBytes(bytes, off, 4)) {
      increments.push(null);
    } else {
      increments.push(readInt32(bytes, off));
    }
  }

  const fieldName = isReverse ? "reverseFlow" : "reading";
  const samples = [];
  for (let i = 0; i < sampleCount; i++) {
    const sample = {
      timestamp: timestampToLocalString(startTsRaw + i * samplingInterval, timezone)
    };
    if (i === 0) {
      sample[fieldName] = baseReading;
    } else {
      // 任一相关增量或基准值为无效值时，采样点值也为 null
      let hasNull = baseReadingNull;
      let val = baseReadingNull ? 0 : baseReading;
      for (let j = 1; j <= i; j++) {
        if (increments[j] === null) {
          hasNull = true;
        } else if (!hasNull) {
          val += increments[j];
        }
      }
      sample[fieldName] = hasNull ? null : val;
    }
    samples.push(sample);
  }

  const result = { startTimestamp, samplingInterval, samples };
  if (isReverse) {
    result.baseReverseFlow = baseReading;
  } else {
    result.baseReading = baseReading;
  }
  return result;
}

function _decodeFPort121Data(bytes) {
  if (bytes.length !== 8) {
    throw new Error('Invalid payload length: ' + bytes.length + ' (expected 8)');
  }
  return {
    softwareVersion: 'V' + readUint16(bytes, 0) + '.' + bytes[2],
    hardwareVersion: 'V' + readUint16(bytes, 3),
    meterBoardVersion: 'V' + readUint16(bytes, 5) + '.' + bytes[7]
  };
}

function _decodeFPort122Data(bytes, timezone) {
  if (bytes.length !== 6) {
    throw new Error('Invalid payload length: ' + bytes.length + ' (expected 6)');
  }
  return {
    timestamp: timestampToLocalString(readUint32(bytes, 0), timezone),
    alarmId: readUint16(bytes, 4)
  };
}

// V0.1.6: FPort 123 - 写TOKEN事件
// V0.1.8: 新增充值水量字段（offset 16-20, int40），载荷长度 16 → 21
function _decodeFPort123Data(bytes, timezone) {
  if (bytes.length !== 16 && bytes.length !== 21) {
    throw new Error('Invalid payload length: ' + bytes.length + ' (expected 16 or 21)');
  }
  // TOKEN: 10 bytes BCD → 20 hex string
  let tokenStr = '';
  for (let i = 5; i < 15; i++) {
    tokenStr += bytes[i].toString(16).toUpperCase().padStart(2, '0');
  }
  const result = {
    timestamp: timestampToLocalString(readUint32(bytes, 0), timezone),
    channel: bytes[4],
    token: tokenStr,
    result: bytes[15]
  };
  // V0.1.8: 充值水量（0.1 L），充值成功时为本次充值水量，非充值成功事件填0
  if (bytes.length === 21) {
    result.topupAmount = readInt40(bytes, 16);
  }
  return result;
}

// V0.1.7: FPort 13 - TOKEN充值记录
function _decodeFPort13Data(bytes, timezone) {
  if (bytes.length < 25) {
    throw new Error('Invalid payload length: ' + bytes.length + ' (minimum 25)');
  }
  const records = [];
  const recordCount = Math.floor(bytes.length / 25);
  for (let i = 0; i < recordCount; i++) {
    const offset = i * 25;
    // TOKEN: 10 bytes BCD → 20 hex string
    let tokenStr = '';
    for (let j = offset + 5; j < offset + 15; j++) {
      tokenStr += bytes[j].toString(16).toUpperCase().padStart(2, '0');
    }
    // 检测 int40 无效填充
    const quotaNull = isSignedNullBytes(bytes, offset + 15, 5);
    const topupNull = isSignedNullBytes(bytes, offset + 20, 5);
    records.push({
      timestamp: timestampToLocalString(readUint32(bytes, offset), timezone),
      channel: bytes[offset + 4],
      token: tokenStr,
      quotaBalance: quotaNull ? null : readInt40(bytes, offset + 15),
      topupBalance: topupNull ? null : readInt40(bytes, offset + 20)
    });
  }
  return { records };
}

function _decodeFPort201Data(bytes) {
  if (bytes.length < 1) {
    throw new Error('Invalid payload length: ' + bytes.length + ' (minimum 1)');
  }

  const command = bytes[0];
  const response = {};

  switch (command) {
    case 0x01:
      if (bytes.length !== 6) throw new Error('Invalid payload length for CMD 0x01: ' + bytes.length + ' (expected 6)');
      response.timestamp = readUint32(bytes, 1);
      response.timezone = readInt8(bytes, 5);
      break;
    case 0x02: case 0x04: case 0x06: case 0x08: case 0x0D:
    case 0x11: case 0x13:  // V0.1.9/V0.1.10: 设阀门功能/设锁定开度响应
      if (bytes.length !== 2) throw new Error('Invalid payload length for CMD 0x' + command.toString(16).toUpperCase() + ': ' + bytes.length + ' (expected 2)');
      response.status = bytes[1] === 0 ? "success" : "failure";
      break;
    case 0x0E:
      // V0.1.5: TOKEN 响应改为 TokenResult (详细状态码)
      if (bytes.length !== 2) throw new Error('Invalid payload length for CMD 0x0E: ' + bytes.length + ' (expected 2)');
      response.result = bytes[1];
      break;
    case 0x03:
      if (bytes.length !== 2) throw new Error('Invalid payload length for CMD 0x03: ' + bytes.length + ' (expected 2)');
      response.valveState = decodeValveState(bytes[1]);
      break;
    case 0x05: case 0x07:
      if (bytes.length !== 2) throw new Error('Invalid payload length for CMD 0x' + command.toString(16).toUpperCase() + ': ' + bytes.length + ' (expected 2)');
      response.status = bytes[1] === 0 ? "disabled" : "enabled";
      break;
    case 0x09: case 0x0A: case 0x0B: case 0x0F:
      if (bytes.length !== 2) throw new Error('Invalid payload length for CMD 0x' + command.toString(16).toUpperCase() + ': ' + bytes.length + ' (expected 2)');
      response.status = bytes[1] === 0 ? "asyncUpload" : "unableToUpload";
      break;
    case 0x0C:
      if (bytes.length !== 10) throw new Error('Invalid payload length for CMD 0x0C: ' + bytes.length + ' (expected 10)');
      response.cycleType = decodeCycleType(bytes[1]);
      response.startTime = readUint32(bytes, 2);
      response.windows = readUint32(bytes, 6);
      response.guardTime = response.cycleType.totalSeconds - response.startTime - response.windows;
      break;
    case 0x10:
      // V0.1.9/V0.1.11: 读阀门功能响应 ValveFunc(1): 0=锁定, 1=启用
      if (bytes.length !== 2) throw new Error('Invalid payload length for CMD 0x10: ' + bytes.length + ' (expected 2)');
      if (bytes[1] !== 0 && bytes[1] !== 1) throw new Error('Invalid ValveFunc value: ' + bytes[1] + ' (expected 0 or 1)');
      response.valveFunc = bytes[1] === 0 ? "locked" : "enabled";
      break;
    case 0x12:
      // V0.1.10: 读锁定阀门时的开度响应 LockOpenValue(1): 0-100
      if (bytes.length !== 2) throw new Error('Invalid payload length for CMD 0x12: ' + bytes.length + ' (expected 2)');
      response.lockOpenValue = bytes[1];
      break;
    default:
      throw new Error('Unknown command: 0x' + command.toString(16).toUpperCase());
  }

  return { command, response };
}

// ========== Core Encode Functions ==========

function _encodeCommandBytes(cmd) {
  const bytes = [cmd.command];
  const params = cmd.parameters || {};

  switch (cmd.command) {
    case 0x01: case 0x03: case 0x05: case 0x07: case 0x0C:
    case 0x10: case 0x12:  // V0.1.9/V0.1.10: 读阀门功能、读锁定开度（无参数）
      break;
    case 0x02:
      if (params.timestamp === undefined || params.timezone === undefined) {
        throw new Error("Missing parameters for CMD 0x02: timestamp and timezone required");
      }
      bytes.push(...writeUint32(params.timestamp));
      bytes.push(writeInt8(params.timezone));
      break;
    case 0x04:
      if (!params.valveSet) throw new Error("Missing parameters for CMD 0x04: valveSet required");
      bytes.push(encodeValveSet(params.valveSet));
      break;
    case 0x06: case 0x08:
      if (params.enabled === undefined) throw new Error('Missing parameters for CMD 0x' + cmd.command.toString(16).toUpperCase() + ': enabled required');
      bytes.push(params.enabled ? 1 : 0);
      break;
    case 0x09: case 0x0A: case 0x0B:
      if (params.startTime === undefined || params.endTime === undefined) throw new Error('Missing parameters for CMD 0x' + cmd.command.toString(16).toUpperCase() + ': startTime and endTime required');
      bytes.push(...writeUint32(params.startTime));
      bytes.push(...writeUint32(params.endTime));
      break;
    case 0x0D:
      if (!params.cycleType || params.startTime === undefined || params.windows === undefined) throw new Error("Missing parameters for CMD 0x0D: cycleType, startTime, and windows required");
      bytes.push(encodeCycleType(params.cycleType.period, params.cycleType.value));
      bytes.push(...writeUint32(params.startTime));
      bytes.push(...writeUint32(params.windows));
      break;
    case 0x0E:
      if (!params.token) throw new Error("Missing parameters for CMD 0x0E: token required");
      if (typeof params.token !== 'string' || params.token.length !== 20) throw new Error('Invalid token format: ' + params.token + ' (must be 20-digit hexadecimal string)');
      if (!/^[0-9A-Fa-f]{20}$/.test(params.token)) throw new Error('Invalid token: ' + params.token + ' (must contain only hexadecimal digits)');
      for (let i = 0; i < 20; i += 2) bytes.push(parseInt(params.token.substr(i, 2), 16));
      break;
    case 0x0F:
      // V0.1.7: 查历史(TOKEN充值记录)
      if (params.startEntry === undefined || params.entryCount === undefined) throw new Error("Missing parameters for CMD 0x0F: startEntry and entryCount required");
      if (params.startEntry < 0 || params.startEntry > 65535) throw new Error('Invalid startEntry: ' + params.startEntry + ' (must be 0-65535)');
      if (params.entryCount < 1 || params.entryCount > 10) throw new Error('Invalid entryCount: ' + params.entryCount + ' (must be 1-10)');
      bytes.push(...writeUint16(params.startEntry));
      bytes.push(params.entryCount);
      break;
    case 0x11:
      // V0.1.9/V0.1.11: 设阀门功能 ValveFunc(1): 0=锁定, 1=启用
      if (params.valveFunc === undefined) throw new Error("Missing parameters for CMD 0x11: valveFunc required");
      bytes.push(encodeValveFunc(params.valveFunc));
      break;
    case 0x13:
      // V0.1.10: 设锁定阀门时的开度 LockOpenValue(1): 0-100
      if (params.lockOpenValue === undefined) throw new Error("Missing parameters for CMD 0x13: lockOpenValue required");
      if (params.lockOpenValue < 0 || params.lockOpenValue > 100) {
        throw new Error('Invalid lockOpenValue: ' + params.lockOpenValue + ' (must be 0-100)');
      }
      bytes.push(params.lockOpenValue);
      break;
    default:
      throw new Error('Unknown command: 0x' + cmd.command.toString(16).toUpperCase());
  }
  return bytes;
}

// ========== Platform Adapter: milesightDeviceDecode ==========
// Core decode logic, returns data object directly. Throws on error.

/**
 * Core decode function (platform-agnostic).
 * @param {number} fPort - LoRaWAN FPort
 * @param {number[]} bytes - Byte array
 * @param {number} [timezone=0] - Timezone offset in units of 15 minutes (e.g. 32 = UTC+8)
 * @returns {object} Decoded data
 */
function milesightDeviceDecode(fPort, bytes, timezone) {
  timezone = timezone || 0;
  switch (fPort) {
    case 10:  return _decodeFPort10Data(bytes, timezone);
    case 11:  return _decodeFPort11Or12Data(bytes, timezone, false);
    case 12:  return _decodeFPort11Or12Data(bytes, timezone, true);
    case 13:  return _decodeFPort13Data(bytes, timezone);
    case 121: return _decodeFPort121Data(bytes);
    case 122: return _decodeFPort122Data(bytes, timezone);
    case 123: return _decodeFPort123Data(bytes, timezone);
    case 201: return _decodeFPort201Data(bytes);
    default:  throw new Error('Unsupported FPort: ' + fPort);
  }
}

// ========== Platform Adapter: milesightDeviceEncode ==========
// Core encode logic, returns byte array directly. Throws on error.

/**
 * Core encode function (platform-agnostic).
 * @param {object} obj - { fPort, commands: [{command, parameters}] }
 * @returns {number[]} Encoded byte array
 */
function milesightDeviceEncode(obj) {
  const commands = obj.commands || [];
  const bytes = [];
  for (const cmd of commands) {
    const cmdBytes = _encodeCommandBytes(cmd);
    for (let i = 0; i < cmdBytes.length; i++) bytes.push(cmdBytes[i]);
  }
  if (bytes.length > 51) {
    throw new Error('Payload too large: ' + bytes.length + ' bytes (max 51)');
  }
  return bytes;
}

// ========== ChirpStack v4 ==========

/**
 * ChirpStack v4 decode uplink.
 * @param {object} input
 * @param {number[]} input.bytes - Byte array
 * @param {number} input.fPort - Uplink FPort
 * @param {Record<string, string>} [input.variables] - Device variables (timezone)
 * @returns {{data: object, errors: string[], warnings: string[]}}
 */
function decodeUplink(input) {
  const { bytes, fPort, variables = {} } = input;
  const timezone = parseInt(variables.timezone || '0');
  try {
    return { data: milesightDeviceDecode(fPort, bytes, timezone) };
  } catch (e) {
    return { data: {}, errors: ['Decode error: ' + e.message] };
  }
}

/**
 * ChirpStack v4 encode downlink.
 * @param {object} input
 * @param {object} input.data - { fPort, commands }
 * @param {Record<string, string>} [input.variables] - Device variables
 * @returns {{bytes: number[], fPort: number, errors: string[], warnings: string[]}}
 */
function encodeDownlink(input) {
  const { data } = input;
  const fPort = data.fPort || 201;
  const commands = data.commands || [];
  const bytes = [];
  const errors = [];

  for (const cmd of commands) {
    try {
      const cmdBytes = _encodeCommandBytes(cmd);
      for (let i = 0; i < cmdBytes.length; i++) bytes.push(cmdBytes[i]);
    } catch (e) {
      errors.push('Failed to encode command 0x' + cmd.command.toString(16).toUpperCase() + ': ' + e.message);
    }
  }

  if (bytes.length > 51) {
    errors.push('Payload too large: ' + bytes.length + ' bytes (max 51)');
  }

  return { bytes: bytes, fPort: fPort, errors: errors, warnings: [] };
}

// ========== ChirpStack v3 ==========

/**
 * ChirpStack v3 decode.
 * @param {number} fPort - LoRaWAN FPort
 * @param {number[]} bytes - Byte array
 * @returns {object} Decoded data (timezone defaults to 0, configure via device profile)
 */
function Decode(fPort, bytes) {
  return milesightDeviceDecode(fPort, bytes, 0);
}

/**
 * ChirpStack v3 encode.
 * @param {number} fPort - LoRaWAN FPort (always 201 for downlink)
 * @param {object} obj - { commands: [{command, parameters}] }
 * @returns {number[]} Encoded byte array
 */
function Encode(fPort, obj) {
  return milesightDeviceEncode(obj);
}

// ========== The Things Network ==========

/**
 * TTN decode.
 * @param {number[]} bytes - Byte array
 * @param {number} port - LoRaWAN FPort
 * @returns {object} Decoded data (timezone defaults to 0, configure via device profile)
 */
function Decoder(bytes, port) {
  return milesightDeviceDecode(port, bytes, 0);
}

/**
 * TTN encode.
 * @param {object} obj - { commands: [{command, parameters}] }
 * @param {number} port - LoRaWAN FPort (always 201 for downlink)
 * @returns {number[]} Encoded byte array
 */
function Encoder(obj, port) {
  return milesightDeviceEncode(obj);
}

// ========== Exports for Node.js ==========

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Core
    milesightDeviceDecode: milesightDeviceDecode,
    milesightDeviceEncode: milesightDeviceEncode,
    // ChirpStack v4
    decodeUplink: decodeUplink,
    encodeDownlink: encodeDownlink,
    // ChirpStack v3
    Decode: Decode,
    Encode: Encode,
    // The Things Network
    Decoder: Decoder,
    Encoder: Encoder
  };
}
