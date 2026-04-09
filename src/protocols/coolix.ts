/**
 * Coolix IR protocol encoder and decoder.
 *
 * Ported from IRremoteESP8266 `ir_Coolix.cpp` / `ir_Coolix.h`.
 *
 * Wire format: 24-bit data sent as 3 bytes MSB-first, each byte
 * followed by its bitwise inverse (48 bits total on the wire).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/484
 */

import { encodeData } from "../encode.js";
import { matchMark, matchSpace, matchAtLeast, matchData } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Coolix.h exactly
// ---------------------------------------------------------------------------

const COOLIX_TICK = 276;
const COOLIX_HDR_MARK = 17 * COOLIX_TICK;  // 4692
const COOLIX_HDR_SPACE = 16 * COOLIX_TICK; // 4416
const COOLIX_BIT_MARK = 2 * COOLIX_TICK;   // 552
const COOLIX_ONE_SPACE = 6 * COOLIX_TICK;  // 1656
const COOLIX_ZERO_SPACE = 2 * COOLIX_TICK; // 552
const COOLIX_MIN_GAP = 19 * COOLIX_TICK;   // 5244
/** Extra tolerance for Coolix decode — matches kCoolixExtraTolerance in C++. */
const COOLIX_TOLERANCE = 30; // 25% default + 5% extra

const COOLIX_FAN_TEMP_CODE = 0b1110;
const COOLIX_SENSOR_TEMP_IGNORE = 0x1F; // 31

// ---------------------------------------------------------------------------
// Temperature lookup table (index = degrees - 17, value = 4-bit code)
// ---------------------------------------------------------------------------

const COOLIX_TEMP_MAP: readonly number[] = [
  0b0000, // 17°C
  0b0001, // 18°C
  0b0011, // 19°C
  0b0010, // 20°C
  0b0110, // 21°C
  0b0111, // 22°C
  0b0101, // 23°C
  0b0100, // 24°C
  0b1100, // 25°C
  0b1101, // 26°C
  0b1001, // 27°C
  0b1000, // 28°C
  0b1010, // 29°C
  0b1011, // 30°C
];

/** Reverse lookup: 4-bit code → degrees C (undefined for invalid codes). */
const COOLIX_CODE_TO_TEMP: (number | undefined)[] = [];
for (let i = 0; i < COOLIX_TEMP_MAP.length; i++) {
  COOLIX_CODE_TO_TEMP[COOLIX_TEMP_MAP[i]!] = i + 17;
}

// ---------------------------------------------------------------------------
// Mode constants
// ---------------------------------------------------------------------------

export const CoolixMode = {
  Cool: 0b00,
  Dry: 0b01,
  Auto: 0b10,
  Heat: 0b11,
  /** Synthetic mode: encoded as Dry + special temp code on the wire. */
  Fan: 0b100,
} as const;

export type CoolixModeValue = (typeof CoolixMode)[keyof typeof CoolixMode];

// ---------------------------------------------------------------------------
// Fan constants
// ---------------------------------------------------------------------------

export const CoolixFan = {
  Auto0: 0b000,
  Max: 0b001,
  Med: 0b010,
  Min: 0b100,
  Auto: 0b101,
  ZoneFollow: 0b110,
  Fixed: 0b111,
} as const;

export type CoolixFanValue = (typeof CoolixFan)[keyof typeof CoolixFan];

// ---------------------------------------------------------------------------
// Fixed command codes
// ---------------------------------------------------------------------------

export const CoolixCommand = {
  Off: 0xB27BE0,
  Swing: 0xB26BE0,
  SwingH: 0xB5F5A2,
  SwingV: 0xB20FE0,
  Sleep: 0xB2E003,
  Turbo: 0xB5F5A2,
  Led: 0xB5F5A5,
  Clean: 0xB5F5AA,
  CmdFan: 0xB2BFE4,
} as const;

/** Toggle/special commands that don't encode AC state. CmdFan is excluded
 *  because it IS a valid fan-mode state frame (Dry + temp 0xE). */
const COMMAND_SET = new Set<number>([
  CoolixCommand.Off,
  CoolixCommand.Swing,
  CoolixCommand.SwingH,
  CoolixCommand.SwingV,
  CoolixCommand.Sleep,
  CoolixCommand.Turbo,
  CoolixCommand.Led,
  CoolixCommand.Clean,
]);

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface CoolixState {
  /** When false, encodes as CoolixCommand.Off instead of a state frame. */
  power?: boolean;
  /** Temperature in °C (17–30). Omit for Fan mode. */
  temp?: number;
  mode?: CoolixModeValue;
  fan?: CoolixFanValue;
  /** Sensor temperature 0–30°C. Omit to ignore. */
  sensorTemp?: number;
  zoneFollow?: boolean;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

const COOLIX_DEFAULT_STATE = 0xB21FC8;
const COOLIX_TEMP_MIN = 17;
const COOLIX_TEMP_MAX = 30;

/**
 * Build a raw 24-bit Coolix code from a state object.
 * When `power` is explicitly `false`, returns the Off command code.
 */
export function buildCoolixRaw(state: CoolixState): number {
  if (state.power === false) return CoolixCommand.Off;

  let raw = COOLIX_DEFAULT_STATE;

  // Fixed upper nibble 0xB (bits 20-23)
  raw = (raw & ~(0xF << 20)) | (0xB << 20);

  // Mode (bits 2-3)
  let mode: number = state.mode ?? CoolixMode.Auto;
  let tempCode: number;

  if (mode === CoolixMode.Fan) {
    // Fan is synthetic: Dry mode + special temp code
    raw = (raw & ~(0x3 << 2)) | (CoolixMode.Dry << 2);
    tempCode = COOLIX_FAN_TEMP_CODE;
  } else {
    if (mode !== CoolixMode.Cool && mode !== CoolixMode.Dry &&
        mode !== CoolixMode.Auto && mode !== CoolixMode.Heat) {
      mode = CoolixMode.Auto;
    }
    raw = (raw & ~(0x3 << 2)) | (mode << 2);

    // Temp (bits 4-7)
    const temp = Math.min(Math.max(state.temp ?? 25, COOLIX_TEMP_MIN), COOLIX_TEMP_MAX);
    tempCode = COOLIX_TEMP_MAP[temp - COOLIX_TEMP_MIN]!;
  }
  raw = (raw & ~(0xF << 4)) | (tempCode << 4);

  // Fan (bits 13-15) — with mode-dependent Auto/Auto0 adjustment.
  // Only Auto and Dry modes use Auto0; all others (Cool, Heat, Fan) use Auto.
  let fan: number = state.fan ?? CoolixFan.Auto0;
  switch (fan) {
    case CoolixFan.Auto:
      // Auto (5) not valid in Dry/Auto mode → convert to Auto0 (0)
      if (mode === CoolixMode.Auto || mode === CoolixMode.Dry) {
        fan = CoolixFan.Auto0;
      }
      break;
    case CoolixFan.Auto0:
      // Auto0 (0) only valid in Dry/Auto mode → convert to Auto (5) for others
      if (mode !== CoolixMode.Auto && mode !== CoolixMode.Dry) {
        fan = CoolixFan.Auto;
      }
      break;
    case CoolixFan.Min:
    case CoolixFan.Med:
    case CoolixFan.Max:
    case CoolixFan.ZoneFollow:
    case CoolixFan.Fixed:
      break;
    default:
      fan = CoolixFan.Auto;
  }
  raw = (raw & ~(0x7 << 13)) | ((fan & 0x7) << 13);

  // SensorTemp (bits 8-12)
  const sensorTemp = state.sensorTemp !== undefined
    ? Math.min(Math.max(state.sensorTemp, 0), 30)
    : COOLIX_SENSOR_TEMP_IGNORE;
  raw = (raw & ~(0x1F << 8)) | (sensorTemp << 8);

  // ZoneFollow (bits 1 and 19)
  const zf = state.zoneFollow ?? false;
  if (zf) {
    raw |= (1 << 1);  // ZoneFollow1
    raw |= (1 << 19); // ZoneFollow2
  } else {
    raw &= ~(1 << 1);
    raw &= ~(1 << 19);
  }

  return raw >>> 0; // Ensure unsigned
}

/**
 * Encode a raw 24-bit Coolix code into IR timings.
 *
 * Each of the 3 data bytes is sent normal then inverted (MSB-first).
 * Matches IRremoteESP8266 `IRsend::sendCOOLIX`.
 */
export function encodeCoolixRaw(data: number, repeat: number = 1): number[] {
  const result: number[] = [];

  for (let r = 0; r <= repeat; r++) {
    // Header
    result.push(COOLIX_HDR_MARK, COOLIX_HDR_SPACE);

    // Data: 3 bytes MSB-first, each followed by inverse
    for (let i = 16; i >= 0; i -= 8) {
      const byte = (data >> i) & 0xFF;
      // Normal byte
      const normal = encodeData(
        COOLIX_BIT_MARK, COOLIX_ONE_SPACE,
        COOLIX_BIT_MARK, COOLIX_ZERO_SPACE,
        BigInt(byte), 8, true,
      );
      for (let j = 0; j < normal.length; j++) result.push(normal[j]!);
      // Inverted byte
      const inverted = encodeData(
        COOLIX_BIT_MARK, COOLIX_ONE_SPACE,
        COOLIX_BIT_MARK, COOLIX_ZERO_SPACE,
        BigInt(byte ^ 0xFF), 8, true,
      );
      for (let j = 0; j < inverted.length; j++) result.push(inverted[j]!);
    }

    // Footer
    result.push(COOLIX_BIT_MARK, COOLIX_MIN_GAP);
  }

  return result;
}

/**
 * Encode a Coolix AC state into raw IR timings.
 */
export function sendCoolix(state: CoolixState, repeat: number = 1): number[] {
  return encodeCoolixRaw(buildCoolixRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

export interface CoolixRawResult {
  /** Raw 24-bit Coolix code. */
  data: number;
  /** Number of timing entries consumed. */
  used: number;
}

/**
 * Decode raw IR timings into a 24-bit Coolix code.
 *
 * Validates byte inversion parity for all 3 bytes.
 *
 * @returns Raw 24-bit code and entries consumed, or null on mismatch.
 */
export function decodeCoolixRaw(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): CoolixRawResult | null {
  let pos = offset;
  const len = timings.length;

  // Minimum: 48 data bits(96) + footer mark(1) = 97 entries (header may be optional)
  if (len - offset < 97) return null;

  // Header — consume if present, fail if required but missing.
  if (pos + 1 < len &&
      matchMark(timings[pos]!, COOLIX_HDR_MARK, COOLIX_TOLERANCE) &&
      matchSpace(timings[pos + 1]!, COOLIX_HDR_SPACE, COOLIX_TOLERANCE)) {
    pos += 2;
  } else if (!headerOptional) {
    return null;
  }

  // Decode 3 byte pairs (normal + inverted)
  let data = 0;
  for (let i = 0; i < 3; i++) {
    // Normal byte (8 bits, MSB-first)
    const normal = matchData(
      timings, pos, 8,
      COOLIX_BIT_MARK, COOLIX_ONE_SPACE,
      COOLIX_BIT_MARK, COOLIX_ZERO_SPACE,
      COOLIX_TOLERANCE,
    );
    if (!normal.success) return null;
    pos += normal.used;

    // Inverted byte (8 bits, MSB-first)
    const inverted = matchData(
      timings, pos, 8,
      COOLIX_BIT_MARK, COOLIX_ONE_SPACE,
      COOLIX_BIT_MARK, COOLIX_ZERO_SPACE,
      COOLIX_TOLERANCE,
    );
    if (!inverted.success) return null;
    pos += inverted.used;

    // Validate inversion parity
    const normalByte = Number(normal.data & 0xFFn);
    const invertedByte = Number(inverted.data & 0xFFn);
    if ((normalByte ^ 0xFF) !== invertedByte) return null;

    data = (data << 8) | normalByte;
  }

  // Footer mark
  if (pos >= len) return null;
  if (!matchMark(timings[pos]!, COOLIX_BIT_MARK, COOLIX_TOLERANCE)) return null;
  pos++;

  // Footer gap (optional — may be last frame)
  if (pos < len) {
    if (!matchAtLeast(timings[pos]!, COOLIX_MIN_GAP, COOLIX_TOLERANCE)) return null;
    pos++;
  }

  return { data: data >>> 0, used: pos - offset };
}

/**
 * Parse a raw 24-bit Coolix code into a state object.
 *
 * Returns null for command codes (Off, Swing, Turbo, etc.) since
 * they don't encode AC state.
 */
export function parseCoolixState(data: number): CoolixState | null {
  // Reject known command codes
  if (COMMAND_SET.has(data)) return null;

  const modeRaw = (data >> 2) & 0x3;
  const tempCode = (data >> 4) & 0xF;
  const fanRaw = (data >> 13) & 0x7;
  const sensorTempRaw = (data >> 8) & 0x1F;
  const zf1 = (data >> 1) & 1;
  const zf2 = (data >> 19) & 1;

  // Detect synthetic Fan mode (Dry + special temp code)
  let mode: CoolixModeValue;
  let temp: number | undefined;

  if (modeRaw === CoolixMode.Dry && tempCode === COOLIX_FAN_TEMP_CODE) {
    mode = CoolixMode.Fan;
    temp = undefined;
  } else {
    mode = modeRaw as CoolixModeValue;
    temp = COOLIX_CODE_TO_TEMP[tempCode];
    if (temp === undefined) return null; // Unknown temp code — not a state frame
  }

  const state: CoolixState = {
    power: true,
    mode,
    fan: fanRaw as CoolixFanValue,
    zoneFollow: !!(zf1 && zf2),
  };

  if (temp !== undefined) state.temp = temp;
  if (sensorTempRaw !== COOLIX_SENSOR_TEMP_IGNORE) state.sensorTemp = sensorTempRaw;

  return state;
}

/**
 * Decode raw IR timings as a Coolix AC state.
 *
 * Returns null if the timings don't match Coolix protocol, or if
 * the decoded code is a command (Off, Swing, etc.) rather than a state frame.
 * Use {@link decodeCoolixRaw} to decode command codes.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @returns Decoded state (same shape as encode input), or null.
 */
export function decodeCoolix(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): CoolixState | null {
  const raw = decodeCoolixRaw(timings, offset, headerOptional);
  if (!raw) return null;
  return parseCoolixState(raw.data);
}
