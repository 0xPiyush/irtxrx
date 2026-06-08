/**
 * Mitsubishi 136-bit A/C IR protocol encoder and decoder.
 *
 * Ported from IRremoteESP8266 `ir_Mitsubishi.cpp` (`IRMitsubishi136`). A 17-byte
 * LSB-first frame whose "checksum" is the bitwise complement of bytes 5–10
 * stored in bytes 11–16.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Mitsubishi.cpp
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Mitsubishi.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3324;
const HDR_SPACE = 1474;
const BIT_MARK = 467;
const ONE_SPACE = 1137;
const ZERO_SPACE = 351;
const GAP = 100000; // kDefaultMessageGap
const TOLERANCE = 25;

const STATE_LENGTH = 17;
export const MITSUBISHI136_BITS = STATE_LENGTH * 8;
const POWER_BYTE = 5;

const TEMP_MIN = 17;
const TEMP_MAX = 30;
const TEMP_OFFSET = 16; // kMitsubishiAcMinTemp

/** Known-good reset template (bytes 0–10; bytes 11–16 are the complement). */
const RESET = Uint8Array.from([
  0x23, 0xcb, 0x26, 0x21, 0x00, 0x40, 0xc2, 0xc7, 0x04,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const Mitsubishi136Mode = {
  Fan: 0b000,
  Cool: 0b001,
  Heat: 0b010,
  Auto: 0b011,
  Dry: 0b101,
} as const;
export type Mitsubishi136ModeValue = (typeof Mitsubishi136Mode)[keyof typeof Mitsubishi136Mode];

export const Mitsubishi136Fan = {
  Min: 0b00,
  Low: 0b01,
  Med: 0b10,
  Max: 0b11,
} as const;
export type Mitsubishi136FanValue = (typeof Mitsubishi136Fan)[keyof typeof Mitsubishi136Fan];

export const Mitsubishi136SwingV = {
  Lowest: 0b0000,
  Low: 0b0001,
  High: 0b0010,
  Highest: 0b0011,
  Auto: 0b1100,
} as const;
export type Mitsubishi136SwingVValue = (typeof Mitsubishi136SwingV)[keyof typeof Mitsubishi136SwingV];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Mitsubishi136State {
  power?: boolean;
  mode?: number;
  /** Temperature in °C (17–30). */
  temp?: number;
  fan?: number;
  swingV?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ---------------------------------------------------------------------------
// Checksum (bytes 11-16 = ~bytes 5-10)
// ---------------------------------------------------------------------------

function applyChecksum(d: Uint8Array): void {
  for (let i = 0; i < 6; i++) d[POWER_BYTE + 6 + i] = ~d[POWER_BYTE + i]! & 0xff;
}

/** Validate the complement-pair checksum. */
export function validMitsubishi136Checksum(d: Uint8Array): boolean {
  if (d.length < STATE_LENGTH) return false;
  for (let i = 0; i < 6; i++) {
    if (d[POWER_BYTE + i] !== ((~d[POWER_BYTE + 6 + i]!) & 0xff)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Build / encode
// ---------------------------------------------------------------------------

/** Build a raw 17-byte Mitsubishi136 code (with checksum) from a state. */
export function buildMitsubishi136Raw(state: Mitsubishi136State): Uint8Array {
  const d = Uint8Array.from(RESET);

  const tempC = clamp(state.temp ?? 24, TEMP_MIN, TEMP_MAX);

  // Byte 5 bit 6: Power
  d[5] = (d[5]! & ~0x40) | ((state.power ?? true ? 1 : 0) << 6);
  // Byte 6 bits 0-2 Mode, bits 4-7 Temp
  d[6] =
    (d[6]! & ~0xf7) |
    ((state.mode ?? Mitsubishi136Mode.Auto) & 0x07) |
    (((tempC - TEMP_OFFSET) & 0x0f) << 4);
  // Byte 7 bits 1-2 Fan, bits 4-7 SwingV
  d[7] =
    (d[7]! & ~0xf6) |
    (((state.fan ?? Mitsubishi136Fan.Low) & 0x03) << 1) |
    (((state.swingV ?? Mitsubishi136SwingV.Auto) & 0x0f) << 4);

  applyChecksum(d);
  return d;
}

/** Encode a raw 17-byte Mitsubishi136 state into IR timings. */
export function encodeMitsubishi136Raw(data: Uint8Array, repeat: number = 0): number[] {
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

/** Encode a Mitsubishi136 A/C state into raw IR timings. */
export function sendMitsubishi136(state: Mitsubishi136State, repeat: number = 0): number[] {
  return encodeMitsubishi136Raw(buildMitsubishi136Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a raw 17-byte Mitsubishi136 code into a state object. */
export function parseMitsubishi136State(raw: Uint8Array): Mitsubishi136State {
  return {
    power: !!(raw[5]! & 0x40),
    mode: raw[6]! & 0x07,
    temp: ((raw[6]! >> 4) & 0x0f) + TEMP_OFFSET,
    fan: (raw[7]! >> 1) & 0x03,
    swingV: (raw[7]! >> 4) & 0x0f,
  };
}

/**
 * Decode raw IR timings as a Mitsubishi136 A/C message.
 *
 * Validates the fixed 0x23CB26 prefix and the complement-pair checksum.
 *
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeMitsubishi136(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Mitsubishi136State | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    // C++ decodeMitsubishi136 pins mark-excess to 0 (not the global 50µs).
    true, TOLERANCE, 0, false,
    headerOptional,
  );
  if (!frame) return null;

  const raw = frame.data;
  if (raw[0] !== 0x23 || raw[1] !== 0xcb || raw[2] !== 0x26) return null;
  if (!validMitsubishi136Checksum(raw)) return null;

  return parseMitsubishi136State(raw);
}
