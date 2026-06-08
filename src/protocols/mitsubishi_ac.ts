/**
 * Mitsubishi 144-bit A/C IR protocol encoder and decoder.
 *
 * Ported from IRremoteESP8266 `ir_Mitsubishi.cpp` (`IRMitsubishiAC`). An 18-byte
 * LSB-first frame with a 5-byte signature (0x23 0xCB 0x26 0x01 0x00) and a
 * byte-sum checksum in the last byte.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Mitsubishi.cpp
 */

import { sumBytes, sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Mitsubishi.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3400;
const HDR_SPACE = 1750;
const BIT_MARK = 450;
const ONE_SPACE = 1300;
const ZERO_SPACE = 420;
const RPT_MARK = 440;
const RPT_SPACE = 15500;
const TOLERANCE = 30; // _tolerance(25) + kMitsubishiAcExtraTolerance(5)

const STATE_LENGTH = 18;
export const MITSUBISHI_AC_BITS = STATE_LENGTH * 8;

const TEMP_MIN = 16;
const TEMP_MAX = 31;

/** Known-good reset template (bytes 0–16; byte 17 is the checksum). */
const RESET = Uint8Array.from([
  0x23, 0xcb, 0x26, 0x01, 0x00, 0x20, 0x08, 0x06, 0x30, 0x45, 0x67,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const MitsubishiAcMode = {
  Heat: 0b001,
  Dry: 0b010,
  Cool: 0b011,
  Auto: 0b100,
  Fan: 0b111,
} as const;
export type MitsubishiAcModeValue = (typeof MitsubishiAcMode)[keyof typeof MitsubishiAcMode];

/** Public fan speeds (0:Auto … 5:Max, 6:Silent), converted to the wire form. */
export const MitsubishiAcFan = {
  Auto: 0,
  Speed1: 1,
  Speed2: 2,
  Speed3: 3,
  Speed4: 4,
  Max: 5,
  Silent: 6,
} as const;
export type MitsubishiAcFanValue = (typeof MitsubishiAcFan)[keyof typeof MitsubishiAcFan];

export const MitsubishiAcVane = {
  Auto: 0b000,
  Highest: 0b001,
  High: 0b010,
  Middle: 0b011,
  Low: 0b100,
  Lowest: 0b101,
  Swing: 0b111,
} as const;
export type MitsubishiAcVaneValue = (typeof MitsubishiAcVane)[keyof typeof MitsubishiAcVane];

export const MitsubishiAcWideVane = {
  LeftMax: 0b0001,
  Left: 0b0010,
  Middle: 0b0011,
  Right: 0b0100,
  RightMax: 0b0101,
  Wide: 0b0110,
  Auto: 0b1000,
} as const;
export type MitsubishiAcWideVaneValue = (typeof MitsubishiAcWideVane)[keyof typeof MitsubishiAcWideVane];

/** Low nibble of byte 8, written by the remote's setMode for each mode. */
const MODE_NIBBLE: Record<number, number> = {
  [MitsubishiAcMode.Auto]: 0,
  [MitsubishiAcMode.Cool]: 6,
  [MitsubishiAcMode.Dry]: 2,
  [MitsubishiAcMode.Heat]: 0,
  [MitsubishiAcMode.Fan]: 7,
};

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface MitsubishiAcState {
  power?: boolean;
  mode?: number;
  /** Temperature in °C (16–31, 0.5° steps). */
  temp?: number;
  /** Fan speed (see {@link MitsubishiAcFan}). */
  fan?: number;
  /** Vertical vane / swing-V (see {@link MitsubishiAcVane}). */
  swingV?: number;
  /** Horizontal wide-vane / swing-H (see {@link MitsubishiAcWideVane}). */
  swingH?: number;
  iSee?: boolean;
  /** Left vertical vane (0–7). */
  vaneLeft?: number;
  naturalFlow?: boolean;
  ecocool?: boolean;
  /** Current-time clock (raw remote units). */
  clock?: number;
  startClock?: number;
  stopClock?: number;
  /** Timer mode bits (0=none, 5=start, 3=stop, 7=both). */
  timer?: number;
  weeklyTimer?: boolean;
  directIndirect?: number;
  absenseDetect?: boolean;
  iSave10C?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ---------------------------------------------------------------------------
// Fan mapping (API ⇄ Fan field + FanAuto bit), mirroring setFan/getFan
// ---------------------------------------------------------------------------

function fanToFields(api: number): { fan: number; fanAuto: number } {
  let fan = api;
  if (fan > MitsubishiAcFan.Silent) fan = MitsubishiAcFan.Max;
  const fanAuto = fan === 0 ? 1 : 0;
  if (fan >= 5) fan--;
  return { fan, fanAuto };
}

function fieldsToFan(fan: number, fanAuto: number): number {
  if (fanAuto) return MitsubishiAcFan.Auto;
  if (fan === 5) return MitsubishiAcFan.Silent;
  return fan;
}

// ---------------------------------------------------------------------------
// Build / encode
// ---------------------------------------------------------------------------

/** Build a raw 18-byte Mitsubishi AC code (with checksum) from a state. */
export function buildMitsubishiAcRaw(state: MitsubishiAcState): Uint8Array {
  const d = Uint8Array.from(RESET);

  const mode = state.mode ?? MitsubishiAcMode.Heat;
  const tempC = clamp(state.temp ?? 22, TEMP_MIN, TEMP_MAX);
  const nrHalf = Math.round(tempC * 2);
  const halfDegree = nrHalf & 1;
  const tempField = (nrHalf >> 1) - TEMP_MIN;
  const { fan, fanAuto } = fanToFields(state.fan ?? MitsubishiAcFan.Silent);
  const wideVane = state.swingH ?? MitsubishiAcWideVane.Middle;

  // Byte 5 bit 5: Power
  d[5] = (d[5]! & ~0x20) | ((state.power ?? true ? 1 : 0) << 5);
  // Byte 6 bits 3-5 Mode, bit 6 ISee
  d[6] = ((mode & 0x07) << 3) | ((state.iSee ? 1 : 0) << 6);
  // Byte 7 bits 0-3 Temp, bit 4 HalfDegree
  d[7] = (tempField & 0x0f) | (halfDegree << 4);
  // Byte 8 low nibble = mode marker, high nibble = WideVane
  d[8] = (MODE_NIBBLE[mode] ?? 0) | ((wideVane & 0x0f) << 4);
  // Byte 9: Fan(0-2), Vane(3-5), VaneBit(6)=1, FanAuto(7)
  d[9] =
    (fan & 0x07) |
    (((state.swingV ?? MitsubishiAcVane.Auto) & 0x07) << 3) |
    (1 << 6) |
    (fanAuto << 7);
  // Bytes 10-16 are "advanced" fields. They are only overwritten when
  // explicitly provided, so a minimal state keeps the known-good template
  // (notably byte 10's reset value of 0x67) — matching the remote's reset.
  if (state.clock !== undefined) d[10] = state.clock & 0xff;
  if (state.stopClock !== undefined) d[11] = state.stopClock & 0xff;
  if (state.startClock !== undefined) d[12] = state.startClock & 0xff;
  if (state.timer !== undefined) d[13] = (d[13]! & ~0x07) | (state.timer & 0x07);
  if (state.weeklyTimer !== undefined) d[13] = (d[13]! & ~0x08) | ((state.weeklyTimer ? 1 : 0) << 3);
  if (state.ecocool !== undefined) d[14] = (d[14]! & ~0x20) | ((state.ecocool ? 1 : 0) << 5);
  if (state.directIndirect !== undefined) d[15] = (d[15]! & ~0x03) | (state.directIndirect & 0x03);
  if (state.absenseDetect !== undefined) d[15] = (d[15]! & ~0x04) | ((state.absenseDetect ? 1 : 0) << 2);
  if (state.iSave10C !== undefined) d[15] = (d[15]! & ~0x20) | ((state.iSave10C ? 1 : 0) << 5);
  if (state.naturalFlow !== undefined) d[16] = (d[16]! & ~0x02) | ((state.naturalFlow ? 1 : 0) << 1);
  if (state.vaneLeft !== undefined) d[16] = (d[16]! & ~0x38) | ((state.vaneLeft & 0x07) << 3);

  d[17] = sumBytes(d, 0, STATE_LENGTH - 1);
  return d;
}

/** Encode a raw 18-byte Mitsubishi AC state into IR timings. */
export function encodeMitsubishiAcRaw(data: Uint8Array, repeat: number = 1): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK,
    headerSpace: HDR_SPACE,
    oneMark: BIT_MARK,
    oneSpace: ONE_SPACE,
    zeroMark: BIT_MARK,
    zeroSpace: ZERO_SPACE,
    footerMark: RPT_MARK,
    gap: RPT_SPACE,
    data,
    msbFirst: false,
    repeat,
  });
}

/** Encode a Mitsubishi AC state into raw IR timings. */
export function sendMitsubishiAc(state: MitsubishiAcState, repeat: number = 1): number[] {
  return encodeMitsubishiAcRaw(buildMitsubishiAcRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Validate the 5-byte signature and byte-sum checksum. */
export function validMitsubishiAcChecksum(raw: Uint8Array): boolean {
  if (raw.length < STATE_LENGTH) return false;
  return raw[17] === sumBytes(raw, 0, STATE_LENGTH - 1);
}

/** Parse a raw 18-byte Mitsubishi AC code into a state object. */
export function parseMitsubishiAcState(raw: Uint8Array): MitsubishiAcState {
  const tempField = raw[7]! & 0x0f;
  const halfDegree = (raw[7]! >> 4) & 1;
  return {
    power: !!((raw[5]! >> 5) & 1),
    mode: (raw[6]! >> 3) & 0x07,
    iSee: !!((raw[6]! >> 6) & 1),
    temp: tempField + TEMP_MIN + (halfDegree ? 0.5 : 0),
    swingH: (raw[8]! >> 4) & 0x0f,
    fan: fieldsToFan(raw[9]! & 0x07, (raw[9]! >> 7) & 1),
    swingV: (raw[9]! >> 3) & 0x07,
    clock: raw[10]!,
    stopClock: raw[11]!,
    startClock: raw[12]!,
    timer: raw[13]! & 0x07,
    weeklyTimer: !!((raw[13]! >> 3) & 1),
    ecocool: !!((raw[14]! >> 5) & 1),
    directIndirect: raw[15]! & 0x03,
    absenseDetect: !!((raw[15]! >> 2) & 1),
    iSave10C: !!((raw[15]! >> 5) & 1),
    naturalFlow: !!((raw[16]! >> 1) & 1),
    vaneLeft: (raw[16]! >> 3) & 0x07,
  };
}

/**
 * Decode raw IR timings as a Mitsubishi 144-bit A/C message.
 *
 * Validates the 5-byte signature (0x23 0xCB 0x26 0x01 0x00) and checksum.
 *
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeMitsubishiAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): MitsubishiAcState | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    RPT_MARK, RPT_SPACE,
    // C++ decodeMitsubishiAC pins mark-excess to 0 (not the global 50µs).
    true, TOLERANCE, 0, false,
    headerOptional,
  );
  if (!frame) return null;

  const raw = frame.data;
  // Signature: 0x23 0xCB 0x26 0x01 0x00
  if (raw[0] !== 0x23 || raw[1] !== 0xcb || raw[2] !== 0x26 ||
      raw[3] !== 0x01 || raw[4] !== 0x00) return null;
  if (!validMitsubishiAcChecksum(raw)) return null;

  return parseMitsubishiAcState(raw);
}
