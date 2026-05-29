/**
 * Mitsubishi 112-bit A/C IR protocol encoder and decoder.
 *
 * Ported from IRremoteESP8266 `ir_Mitsubishi.cpp` (`IRMitsubishi112`). A 14-byte
 * LSB-first frame, byte-sum checksum, sharing wire timings with TCL112AC but
 * told apart by the (longer) header mark. Temperature is stored inverted.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Mitsubishi.cpp
 */

import { sumBytes, sendGenericBytes } from "../encode.js";
import { matchGenericBytes, matchMark, matchSpace } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Mitsubishi.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3450;
const HDR_SPACE = 1696;
const BIT_MARK = 450;
const ONE_SPACE = 1250;
const ZERO_SPACE = 385;
const GAP = 100000; // kDefaultMessageGap
/** Tight header-mark tolerance, to disambiguate from TCL112AC (3000µs). */
const HDR_MARK_TOLERANCE = 5;
const DATA_TOLERANCE = 25;

const STATE_LENGTH = 14;
export const MITSUBISHI112_BITS = STATE_LENGTH * 8;

const TEMP_MIN = 16;
const TEMP_MAX = 31; // kMitsubishiAcMaxTemp — temperature is stored as MAX - temp

/** Known-good reset template (bytes 0–12; byte 13 is the checksum). */
const RESET = Uint8Array.from([
  0x23, 0xcb, 0x26, 0x01, 0x00, 0x24, 0x03, 0x0b, 0x10, 0x00, 0x00, 0x00, 0x30, 0x00,
]);

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const Mitsubishi112Mode = {
  Heat: 0b001,
  Dry: 0b010,
  Cool: 0b011,
  Auto: 0b111,
} as const;
export type Mitsubishi112ModeValue = (typeof Mitsubishi112Mode)[keyof typeof Mitsubishi112Mode];

export const Mitsubishi112Fan = {
  Max: 0b000,
  Min: 0b010,
  Low: 0b011,
  Med: 0b101,
} as const;
export type Mitsubishi112FanValue = (typeof Mitsubishi112Fan)[keyof typeof Mitsubishi112Fan];

export const Mitsubishi112SwingV = {
  Highest: 0b001,
  High: 0b010,
  Middle: 0b011,
  Low: 0b100,
  Lowest: 0b101,
  Auto: 0b111,
} as const;
export type Mitsubishi112SwingVValue = (typeof Mitsubishi112SwingV)[keyof typeof Mitsubishi112SwingV];

export const Mitsubishi112SwingH = {
  LeftMax: 0b0001,
  Left: 0b0010,
  Middle: 0b0011,
  Right: 0b0100,
  RightMax: 0b0101,
  Wide: 0b1000,
  Auto: 0b1100,
} as const;
export type Mitsubishi112SwingHValue = (typeof Mitsubishi112SwingH)[keyof typeof Mitsubishi112SwingH];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Mitsubishi112State {
  power?: boolean;
  mode?: number;
  /** Temperature in °C (16–31). */
  temp?: number;
  fan?: number;
  swingV?: number;
  swingH?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ---------------------------------------------------------------------------
// Build / encode
// ---------------------------------------------------------------------------

/** Build a raw 14-byte Mitsubishi112 code (with checksum) from a state. */
export function buildMitsubishi112Raw(state: Mitsubishi112State): Uint8Array {
  const d = Uint8Array.from(RESET);

  const tempC = clamp(state.temp ?? 24, TEMP_MIN, TEMP_MAX);

  // Byte 5 bit 2: Power
  d[5] = (d[5]! & ~0x04) | ((state.power ?? true ? 1 : 0) << 2);
  // Byte 6 bits 0-2: Mode
  d[6] = (d[6]! & ~0x07) | ((state.mode ?? Mitsubishi112Mode.Auto) & 0x07);
  // Byte 7 bits 0-3: Temp (inverted: MAX - temp)
  d[7] = (d[7]! & ~0x0f) | ((TEMP_MAX - tempC) & 0x0f);
  // Byte 8 bits 0-2 Fan, bits 3-5 SwingV
  d[8] =
    (d[8]! & ~0x3f) |
    ((state.fan ?? Mitsubishi112Fan.Max) & 0x07) |
    (((state.swingV ?? Mitsubishi112SwingV.Auto) & 0x07) << 3);
  // Byte 12 bits 2-5: SwingH
  d[12] = (d[12]! & ~0x3c) | (((state.swingH ?? Mitsubishi112SwingH.Auto) & 0x0f) << 2);

  d[13] = sumBytes(d, 0, STATE_LENGTH - 1);
  return d;
}

/** Encode a raw 14-byte Mitsubishi112 state into IR timings. */
export function encodeMitsubishi112Raw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK,
    headerSpace: HDR_SPACE,
    oneMark: BIT_MARK,
    oneSpace: ONE_SPACE,
    zeroMark: BIT_MARK,
    zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK,
    gap: GAP,
    data,
    msbFirst: false,
    repeat,
  });
}

/** Encode a Mitsubishi112 A/C state into raw IR timings. */
export function sendMitsubishi112(state: Mitsubishi112State, repeat: number = 0): number[] {
  return encodeMitsubishi112Raw(buildMitsubishi112Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a raw 14-byte Mitsubishi112 code into a state object. */
export function parseMitsubishi112State(raw: Uint8Array): Mitsubishi112State {
  return {
    power: !!(raw[5]! & 0x04),
    mode: raw[6]! & 0x07,
    temp: TEMP_MAX - (raw[7]! & 0x0f),
    fan: raw[8]! & 0x07,
    swingV: (raw[8]! >> 3) & 0x07,
    swingH: (raw[12]! >> 2) & 0x0f,
  };
}

/**
 * Decode raw IR timings as a Mitsubishi112 A/C message.
 *
 * The header mark is matched with a tight tolerance so a (timing-compatible)
 * TCL112AC frame is rejected rather than mislabelled. Validates the fixed
 * 0x23CB26 prefix and the byte-sum checksum.
 *
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeMitsubishi112(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Mitsubishi112State | null {
  let pos = offset;

  let hasHeader = false;
  if (
    pos + 1 < timings.length &&
    matchMark(timings[pos]!, HDR_MARK, HDR_MARK_TOLERANCE) &&
    matchSpace(timings[pos + 1]!, HDR_SPACE, DATA_TOLERANCE)
  ) {
    pos += 2;
    hasHeader = true;
  }
  if (!hasHeader && !headerOptional) return null;

  const frame = matchGenericBytes(
    timings, pos, timings.length - pos, STATE_LENGTH,
    0, 0,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, DATA_TOLERANCE, undefined, false,
    false,
  );
  if (!frame) return null;

  const raw = frame.data;
  if (raw[0] !== 0x23 || raw[1] !== 0xcb || raw[2] !== 0x26) return null;
  if (raw[13] !== sumBytes(raw, 0, STATE_LENGTH - 1)) return null;

  return parseMitsubishi112State(raw);
}
