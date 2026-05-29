/**
 * Teco A/C IR protocol encoder and decoder.
 *
 * Ported from IRremoteESP8266 `ir_Teco.cpp` / `ir_Teco.h`.
 *
 * Wire format: a 35-bit value sent LSB-first with a header and a trailing gap
 * (no checksum). Bits 24–31 are a fixed `0x50` constant and bits 32–34 carry
 * the low bits of a `0x02` constant; we validate both on decode as integrity
 * markers.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Teco.cpp
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Teco.cpp exactly
// ---------------------------------------------------------------------------

const TECO_HDR_MARK = 9000;
const TECO_HDR_SPACE = 4440;
const TECO_BIT_MARK = 620;
const TECO_ONE_SPACE = 1650;
const TECO_ZERO_SPACE = 580;
const TECO_GAP = 100000; // kDefaultMessageGap
const TECO_TOLERANCE = 25;

export const TECO_BITS = 35;

const TECO_TEMP_MIN = 16;
const TECO_TEMP_MAX = 30;
const TECO_TIMER_MAX = 24 * 60;

/** Fixed constant bits: 0x50 at bits 24-31 and 0x02 at bits 32-39 (low 3 sent). */
const TECO_CONST = (0x50n << 24n) | (0x02n << 32n);
const TECO_MASK = (1n << 35n) - 1n;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const TecoMode = {
  Auto: 0,
  Cool: 1,
  Dry: 2,
  Fan: 3,
  Heat: 4,
} as const;
export type TecoModeValue = (typeof TecoMode)[keyof typeof TecoMode];

export const TecoFan = {
  Auto: 0,
  Low: 1,
  Med: 2,
  High: 3,
} as const;
export type TecoFanValue = (typeof TecoFan)[keyof typeof TecoFan];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface TecoState {
  power?: boolean;
  mode?: number;
  /** Temperature in °C (16–30). */
  temp?: number;
  fan?: number;
  swing?: boolean;
  sleep?: boolean;
  light?: boolean;
  humid?: boolean;
  /** Energy-saving mode. */
  save?: boolean;
  /** Timer in minutes (0–1440). Zero disables the timer. */
  timerMinutes?: number;
}

// ---------------------------------------------------------------------------
// Build raw 35-bit value from state
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Build the raw 35-bit Teco value (as a bigint) from a state. */
export function buildTecoRaw(state: TecoState): bigint {
  let v = TECO_CONST;

  const mode = state.mode ?? TecoMode.Auto;
  const fan = state.fan ?? TecoFan.Auto;
  const tempC = clamp(state.temp ?? TECO_TEMP_MIN, TECO_TEMP_MIN, TECO_TEMP_MAX);

  // Timer (mirrors setTimer).
  const mins = clamp(state.timerMinutes ?? 0, 0, TECO_TIMER_MAX);
  const hours = Math.floor(mins / 60);
  const timerOn = mins > 0 ? 1 : 0;
  const halfHour = mins % 60 >= 30 ? 1 : 0;
  const unitHours = hours % 10;
  const tensHours = Math.floor(hours / 10);

  v |= BigInt(mode & 0x7); // bits 0-2
  v |= BigInt(state.power ? 1 : 0) << 3n;
  v |= BigInt(fan & 0x3) << 4n;
  v |= BigInt(state.swing ? 1 : 0) << 6n;
  v |= BigInt(state.sleep ? 1 : 0) << 7n;
  v |= BigInt((tempC - TECO_TEMP_MIN) & 0xf) << 8n;
  v |= BigInt(halfHour) << 12n;
  v |= BigInt(tensHours & 0x3) << 13n;
  v |= BigInt(timerOn) << 15n;
  v |= BigInt(unitHours & 0xf) << 16n;
  v |= BigInt(state.humid ? 1 : 0) << 20n;
  v |= BigInt(state.light ? 1 : 0) << 21n;
  v |= BigInt(state.save ? 1 : 0) << 23n;

  return v & TECO_MASK;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw 35-bit Teco value into IR timings. */
export function encodeTecoRaw(value: bigint, repeat: number = 0): number[] {
  return sendGeneric({
    headerMark: TECO_HDR_MARK,
    headerSpace: TECO_HDR_SPACE,
    oneMark: TECO_BIT_MARK,
    oneSpace: TECO_ONE_SPACE,
    zeroMark: TECO_BIT_MARK,
    zeroSpace: TECO_ZERO_SPACE,
    footerMark: TECO_BIT_MARK,
    gap: TECO_GAP,
    data: value & TECO_MASK,
    nbits: TECO_BITS,
    msbFirst: false,
    repeat,
  });
}

/** Encode a Teco A/C state into raw IR timings. */
export function sendTeco(state: TecoState, repeat: number = 0): number[] {
  return encodeTecoRaw(buildTecoRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a raw 35-bit Teco value into a state object, or null if constants fail. */
export function parseTecoState(value: bigint): TecoState | null {
  const v = value & TECO_MASK;
  // Validate the fixed constant bits (0x50 at 24-31, 0x02 low bits at 32-34).
  if (((v >> 24n) & 0xffn) !== 0x50n) return null;
  if (((v >> 32n) & 0x7n) !== 0x2n) return null;

  const timerOn = Number((v >> 15n) & 1n);
  const halfHour = Number((v >> 12n) & 1n);
  const tensHours = Number((v >> 13n) & 0x3n);
  const unitHours = Number((v >> 16n) & 0xfn);
  const timerMinutes = timerOn
    ? (tensHours * 10 + unitHours) * 60 + (halfHour ? 30 : 0)
    : 0;

  return {
    mode: Number(v & 0x7n),
    power: !!Number((v >> 3n) & 1n),
    fan: Number((v >> 4n) & 0x3n),
    swing: !!Number((v >> 6n) & 1n),
    sleep: !!Number((v >> 7n) & 1n),
    temp: Number((v >> 8n) & 0xfn) + TECO_TEMP_MIN,
    timerMinutes,
    humid: !!Number((v >> 20n) & 1n),
    light: !!Number((v >> 21n) & 1n),
    save: !!Number((v >> 23n) & 1n),
  };
}

/**
 * Decode raw IR timings as a Teco A/C state.
 *
 * @param timings        Raw mark/space timing array in microseconds.
 * @param offset         Starting index in the timings array (default 0).
 * @param headerOptional Allow a missing header (default false).
 * @returns Decoded state, or null on mismatch / bad constant bits.
 */
export function decodeTeco(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): TecoState | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, TECO_BITS,
    TECO_HDR_MARK, TECO_HDR_SPACE,
    TECO_BIT_MARK, TECO_ONE_SPACE,
    TECO_BIT_MARK, TECO_ZERO_SPACE,
    TECO_BIT_MARK, TECO_GAP,
    true, TECO_TOLERANCE, 0, false, headerOptional,
  );
  if (!result) return null;
  return parseTecoState(result.data);
}
