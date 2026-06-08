/**
 * Sharp A/C IR protocol encoder and decoder. (SHARP_AC)
 *
 * Ported from IRremoteESP8266 `ir_Sharp.cpp` (the `IRSharpAc` class).
 * A 13-byte LSB-first message with a folded-XOR nibble checksum. Models A907,
 * A903 and A705 differ in supported modes/fan and a couple of marker bits.
 *
 * This models the **normal** operating message (power / mode / temp / fan /
 * vertical-swing / ion). The special one-shot "button" messages — Turbo, Econo,
 * Light, Clean and Timer — drive the dedicated `Special`/`PowerSpecial` fields
 * and are out of scope.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/638
 */

import { sendGenericBytes, xorBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Sharp.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3800;
const HDR_SPACE = 1900;
const BIT_MARK = 470;
const ONE_SPACE = 1400;
const ZERO_SPACE = 500;
const GAP = 100000; // kDefaultMessageGap

const STATE_LENGTH = 13;
const TEMP_MIN = 15;
const TEMP_MAX = 30;

const POWER_OFF = 2; // PowerSpecial value
const POWER_ON = 3;

/** Reset state from `IRSharpAc::stateReset`. */
const TEMPLATE: readonly number[] = [
  0xaa, 0x5a, 0xcf, 0x10, 0x00, 0x01, 0x00, 0x00, 0x08, 0x80, 0x00, 0xe0, 0x01,
];

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const SharpAcModel = {
  A907: 1,
  A705: 2,
  A903: 3,
} as const;
export type SharpAcModelValue = (typeof SharpAcModel)[keyof typeof SharpAcModel];

export const SharpAcMode = {
  Auto: 0b00, // Fan on A705/A903
  Heat: 0b01, // A907 only
  Cool: 0b10,
  Dry: 0b11,
} as const;
export type SharpAcModeValue = (typeof SharpAcMode)[keyof typeof SharpAcMode];

export const SharpAcFan = {
  Auto: 0b010,
  Min: 0b100,
  Med: 0b011,
  High: 0b101,
  Max: 0b111,
} as const;
export type SharpAcFanValue = (typeof SharpAcFan)[keyof typeof SharpAcFan];

export const SharpAcSwingV = {
  Ignore: 0b000,
  High: 0b001,
  Off: 0b010,
  Mid: 0b011,
  Low: 0b100,
  Last: 0b101,
  Lowest: 0b110,
  Toggle: 0b111,
} as const;
export type SharpAcSwingVValue = (typeof SharpAcSwingV)[keyof typeof SharpAcSwingV];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface SharpAcState {
  model?: SharpAcModelValue;
  power?: boolean;
  /** Temperature in °C (15–30; ignored in Auto/Dry). */
  temp?: number;
  mode?: SharpAcModeValue;
  fan?: SharpAcFanValue;
  swingV?: SharpAcSwingVValue;
  ion?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Matches `IRSharpAc::calcChecksum`: folded XOR of all nibbles. */
function calcChecksum(raw: Uint8Array): number {
  let x = xorBytes(raw, 0, STATE_LENGTH - 1);
  x ^= raw[STATE_LENGTH - 1]! & 0x0f;
  x ^= (x >> 4) & 0x0f;
  return x & 0x0f;
}

// ---------------------------------------------------------------------------
// Build raw 13-byte state
// ---------------------------------------------------------------------------

/** Build the raw 13-byte Sharp A/C (normal message) state from a state object. */
export function buildSharpAcRaw(state: SharpAcState): Uint8Array {
  const raw = Uint8Array.from(TEMPLATE);
  const model = state.model ?? SharpAcModel.A907;

  // Heat is unsupported on A705/A903 — those models use Fan (== Auto code).
  let mode: number = state.mode ?? SharpAcMode.Auto;
  if (mode === SharpAcMode.Heat && model !== SharpAcModel.A907) mode = SharpAcMode.Auto;

  // Temperature byte: cleared in Auto/Dry, else base (0xD0 A705 / 0xC0 others).
  if (mode === SharpAcMode.Auto || mode === SharpAcMode.Dry) {
    raw[4] = 0x00;
  } else {
    raw[4] = (model === SharpAcModel.A705 ? 0xd0 : 0xc0) | ((clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_MIN) & 0x0f);
  }

  // Power (byte 5 high nibble; low nibble is a constant 0x1).
  raw[5] = 0x01 | (((state.power ?? true) ? POWER_ON : POWER_OFF) << 4);

  // Fan is forced to Auto in Auto/Dry modes.
  const fan = (mode === SharpAcMode.Auto || mode === SharpAcMode.Dry) ? SharpAcFan.Auto : (state.fan ?? SharpAcFan.Auto);
  raw[6] = (mode & 0x03) | ((fan & 0x07) << 4); // Clean bit stays 0

  raw[8] = 0x08 | ((state.swingV ?? SharpAcSwingV.Ignore) & 0x07);
  raw[11] = 0xe0 | ((state.ion ? 1 : 0) << 2) | ((model !== SharpAcModel.A907 ? 1 : 0) << 4);
  raw[12] = (raw[12]! & 0x0f) | (calcChecksum(raw) << 4);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw Sharp A/C payload into IR timings (LSB-first). */
export function encodeSharpAcRaw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP,
    data, msbFirst: false, repeat,
  });
}

/** Encode a Sharp A/C state into raw IR timings. */
export function sendSharpAc(state: SharpAcState, repeat: number = 0): number[] {
  return encodeSharpAcRaw(buildSharpAcRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Verify the Sharp A/C checksum. */
export function sharpAcValidChecksum(raw: Uint8Array): boolean {
  return ((raw[STATE_LENGTH - 1]! >> 4) & 0x0f) === calcChecksum(raw);
}

/** Parse a validated 13-byte Sharp A/C state into a state object. */
export function parseSharpAcState(raw: Uint8Array): SharpAcState {
  const model2 = (raw[11]! >> 4) & 1;
  const modelBit = (raw[4]! >> 4) & 1;
  const model: SharpAcModelValue = model2 ? (modelBit ? SharpAcModel.A705 : SharpAcModel.A903) : SharpAcModel.A907;
  const ps = (raw[5]! >> 4) & 0x0f;
  return {
    model,
    power: ps !== 0 && ps !== POWER_OFF,
    temp: (raw[4]! & 0x0f) + TEMP_MIN,
    mode: (raw[6]! & 0x03) as SharpAcModeValue,
    fan: ((raw[6]! >> 4) & 0x07) as SharpAcFanValue,
    swingV: (raw[8]! & 0x07) as SharpAcSwingVValue,
    ion: !!((raw[11]! >> 2) & 1),
  };
}

/**
 * Decode raw IR timings as a Sharp A/C (13-byte) message.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeSharpAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): SharpAcState | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false, headerOptional,
  );
  if (!frame) return null;
  // Fixed prefix + checksum gate false matches.
  if (frame.data[0] !== 0xaa || frame.data[1] !== 0x5a) return null;
  if (!sharpAcValidChecksum(frame.data)) return null;
  return parseSharpAcState(frame.data);
}
