/**
 * Godrej A/C IR protocol encoder and decoder.
 *
 * Reverse-engineered from captures of a Godrej remote (not present in
 * IRremoteESP8266). A 96-bit (12-byte) frame sent MSB-first with an equal
 * ~3200µs header mark/space, a fixed `0x14 0x27` preamble, and a nibble-sum
 * checksum over bytes 2–10 in the last byte.
 *
 * @remarks Timing constants are averages from real captures (RX), so they may
 * benefit from a bench test against the unit. Field map:
 *   byte 0–1  preamble 0x14 0x27
 *   byte 2    temp (7–4 = °C−16), power (bit 3), mode (2–0)
 *   byte 3    V-swing (bit 7), i-Sense temp (6–0 = °C+21, when i-Sense on)
 *   byte 4    reserved
 *   byte 5    timer minutes (0–5), sleep (bit 6), timer +12h (bit 7)
 *   byte 6    timer enable (bit 6)
 *   byte 7    convert/5-in-1 (0–2), display (bit 6)
 *   byte 8    timer hours mod 12 (7–4)
 *   byte 9    turbo (bit 7, active-low), i-Sense enable (bit 2)
 *   byte 10   fan (7–4, one-hot)
 *   byte 11   checksum = Σ nibbles(bytes 2–10) mod 256
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — capture-derived averages
// ---------------------------------------------------------------------------

const HDR_MARK = 3200;
const HDR_SPACE = 3200;
const BIT_MARK = 488;
const ONE_SPACE = 1160;
const ZERO_SPACE = 408;
/** Trailing inter-frame gap (not captured; a reasonable placeholder). */
const GAP = 8000;
const TOLERANCE = 30;

const STATE_LENGTH = 12;
export const GODREJ_BITS = STATE_LENGTH * 8;

const TEMP_MIN = 16;
const TEMP_MAX = 31;
/** i-Sense sensed temperature is stored as °C + this offset (byte 3 bits 6–0). */
const ISENSE_TEMP_OFFSET = 21;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const GodrejMode = {
  Auto: 1,
  Cool: 2,
  Dry: 3,
  Fan: 5,
  Heat: 6,
} as const;
export type GodrejModeValue = (typeof GodrejMode)[keyof typeof GodrejMode];

export const GodrejFan = {
  Auto: 0,
  Low: 1,
  Med: 2,
  High: 3,
} as const;
export type GodrejFanValue = (typeof GodrejFan)[keyof typeof GodrejFan];

/** Logical fan → byte-10 one-hot value. */
const FAN_TO_WIRE: Record<number, number> = {
  [GodrejFan.Auto]: 0x80,
  [GodrejFan.Low]: 0x10,
  [GodrejFan.Med]: 0x20,
  [GodrejFan.High]: 0x40,
};

function wireToFan(byte10: number): number {
  switch (byte10 & 0xf0) {
    case 0x10: return GodrejFan.Low;
    case 0x20: return GodrejFan.Med;
    case 0x40: return GodrejFan.High;
    default: return GodrejFan.Auto; // 0x80
  }
}

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface GodrejState {
  power?: boolean;
  mode?: number;
  /** Temperature in °C (16–31). */
  temp?: number;
  fan?: number;
  swingV?: boolean;
  turbo?: boolean;
  sleep?: boolean;
  /** Panel LED display. */
  display?: boolean;
  /** "5-in-1 Convert" capacity level (0 = off, 1–5 = C1–C5). */
  convert?: number;
  /** i-Sense (i-Feel) — the remote reports its own room temperature. */
  iSense?: boolean;
  /** Room temperature in °C reported when i-Sense is on. */
  iSenseTemp?: number;
  timerEnabled?: boolean;
  /** Timer in minutes (0–1440, 30-minute steps). */
  timerMinutes?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ---------------------------------------------------------------------------
// Checksum (Σ nibbles of bytes 2–10)
// ---------------------------------------------------------------------------

function calcChecksum(d: Uint8Array): number {
  let sum = 0;
  for (let i = 2; i <= 10; i++) sum += (d[i]! >> 4) + (d[i]! & 0x0f);
  return sum & 0xff;
}

/** Validate the preamble and nibble-sum checksum. */
export function validGodrejChecksum(d: Uint8Array): boolean {
  if (d.length < STATE_LENGTH) return false;
  if (d[0] !== 0x14 || d[1] !== 0x27) return false;
  return d[11] === calcChecksum(d);
}

// ---------------------------------------------------------------------------
// Build / encode
// ---------------------------------------------------------------------------

/** Build a raw 12-byte Godrej code (with checksum) from a state. */
export function buildGodrejRaw(state: GodrejState): Uint8Array {
  const d = new Uint8Array(STATE_LENGTH);
  d[0] = 0x14;
  d[1] = 0x27;

  const temp = clamp(state.temp ?? 24, TEMP_MIN, TEMP_MAX);
  const mode = state.mode ?? GodrejMode.Cool;
  // Byte 2: temp (7–4), power (bit 3), mode (2–0)
  d[2] = (((temp - TEMP_MIN) & 0x0f) << 4) | ((state.power ?? true ? 1 : 0) << 3) | (mode & 0x07);

  // Byte 3: V-swing (bit 7), i-Sense temp (6–0)
  d[3] = (state.swingV ? 0x80 : 0);
  if (state.iSense) {
    d[3] |= (clamp(state.iSenseTemp ?? 25, 0, 106) + ISENSE_TEMP_OFFSET) & 0x7f;
  }

  // Byte 4: reserved
  d[4] = 0;

  // Timer: byte 5 minutes + sleep + 12h flag, byte 6 enable, byte 8 hours%12
  const mins = clamp(state.timerMinutes ?? 0, 0, 24 * 60);
  const hours = Math.floor(mins / 60);
  const minute = mins % 60;
  d[5] = (minute & 0x3f) | ((state.sleep ? 1 : 0) << 6) | ((hours >= 12 ? 1 : 0) << 7);
  const timerEnabled = state.timerEnabled ?? mins > 0;
  d[6] = (timerEnabled ? 1 : 0) << 6;
  d[8] = ((hours % 12) & 0x0f) << 4;

  // Byte 7: convert (2–0), display (bit 6)
  d[7] = ((state.convert ?? 0) & 0x07) | ((state.display ? 1 : 0) << 6);

  // Byte 9: turbo (bit 7, active-low), i-Sense enable (bit 2)
  d[9] = (state.turbo ? 0 : 0x80) | (state.iSense ? 0x04 : 0);

  // Byte 10: fan (one-hot, high nibble)
  d[10] = FAN_TO_WIRE[clamp(state.fan ?? GodrejFan.High, 0, 3)] ?? 0x40;

  d[11] = calcChecksum(d);
  return d;
}

/** Encode a raw 12-byte Godrej code into IR timings (MSB-first). */
export function encodeGodrejRaw(data: Uint8Array, repeat: number = 0): number[] {
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
    msbFirst: true,
    repeat,
  });
}

/** Encode a Godrej A/C state into raw IR timings. */
export function sendGodrej(state: GodrejState, repeat: number = 0): number[] {
  return encodeGodrejRaw(buildGodrejRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

export interface GodrejRawResult {
  data: Uint8Array;
  used: number;
}

/** Decode raw IR timings into a raw 12-byte Godrej code (preamble + checksum validated). */
export function decodeGodrejRaw(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): GodrejRawResult | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, TOLERANCE, undefined, true, // MSB-first
    headerOptional,
  );
  if (!frame) return null;
  if (!validGodrejChecksum(frame.data)) return null;
  return { data: frame.data, used: frame.used };
}

/** Parse a raw 12-byte Godrej code into a state object. */
export function parseGodrejState(d: Uint8Array): GodrejState {
  const iSense = !!((d[9]! >> 2) & 1);
  const minute = d[5]! & 0x3f;
  const hours = ((d[8]! >> 4) & 0x0f) + ((d[5]! & 0x80) ? 12 : 0);

  const state: GodrejState = {
    power: !!((d[2]! >> 3) & 1),
    mode: d[2]! & 0x07,
    temp: ((d[2]! >> 4) & 0x0f) + TEMP_MIN,
    fan: wireToFan(d[10]!),
    swingV: !!((d[3]! >> 7) & 1),
    turbo: !((d[9]! >> 7) & 1),
    sleep: !!((d[5]! >> 6) & 1),
    display: !!((d[7]! >> 6) & 1),
    convert: d[7]! & 0x07,
    iSense,
    timerEnabled: !!((d[6]! >> 6) & 1),
    timerMinutes: hours * 60 + minute,
  };
  if (iSense) state.iSenseTemp = (d[3]! & 0x7f) - ISENSE_TEMP_OFFSET;
  return state;
}

/**
 * Decode raw IR timings as a Godrej A/C state.
 *
 * @param timings        Raw mark/space timing array in microseconds.
 * @param offset         Starting index in the timings array (default 0).
 * @param headerOptional Allow a missing header (default false).
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeGodrej(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): GodrejState | null {
  const raw = decodeGodrejRaw(timings, offset, headerOptional);
  if (!raw) return null;
  return parseGodrejState(raw.data);
}
