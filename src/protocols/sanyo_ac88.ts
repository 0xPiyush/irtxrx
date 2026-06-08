/**
 * Sanyo 88-bit A/C IR protocol encoder and decoder. (SANYO_AC88)
 *
 * Ported from IRremoteESP8266 `ir_Sanyo.cpp` (the `IRSanyoAc88` class).
 * An 11-byte LSB-first message with no checksum; integrity is gated by the
 * fixed `0xAA 0x55` lead bytes. On real remotes the message is sent three times
 * (repeat=2); a single frame is decoded here.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1503
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Sanyo.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 5400;
const HDR_SPACE = 2000;
const BIT_MARK = 500;
const ONE_SPACE = 1500;
const ZERO_SPACE = 750;
const GAP = 3675;
const TOLERANCE = 30; // _tolerance (25) + kSanyoAc88ExtraTolerance (5)

export const SANYO_AC88_MIN_REPEAT = 2;
const STATE_LENGTH = 11;
const TEMP_MIN = 10;
const TEMP_MAX = 30;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const SanyoAc88Mode = {
  Auto: 0,
  FeelCool: 1,
  Cool: 2,
  FeelHeat: 3,
  Heat: 4,
  Fan: 5,
} as const;
export type SanyoAc88ModeValue = (typeof SanyoAc88Mode)[keyof typeof SanyoAc88Mode];

export const SanyoAc88Fan = {
  Auto: 0,
  Low: 1,
  Medium: 2,
  High: 3,
} as const;
export type SanyoAc88FanValue = (typeof SanyoAc88Fan)[keyof typeof SanyoAc88Fan];

/** Reset state from `IRSanyoAc88::stateReset`. */
const TEMPLATE: readonly number[] = [
  0xaa, 0x55, 0xa0, 0x16, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x10,
];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface SanyoAc88State {
  power?: boolean;
  /** Temperature in °C (10–30). */
  temp?: number;
  mode?: SanyoAc88ModeValue;
  fan?: SanyoAc88FanValue;
  swingV?: boolean;
  filter?: boolean;
  turbo?: boolean;
  sleep?: boolean;
  /** Clock time in minutes since midnight. */
  clock?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function setBits(raw: Uint8Array, idx: number, off: number, size: number, val: number): void {
  const mask = ((1 << size) - 1) << off;
  raw[idx] = (raw[idx]! & ~mask) | ((val << off) & mask);
}

// ---------------------------------------------------------------------------
// Build raw 11-byte state
// ---------------------------------------------------------------------------

/** Build the raw 11-byte Sanyo AC88 state from a state object. */
export function buildSanyoAc88Raw(state: SanyoAc88State): Uint8Array {
  const raw = Uint8Array.from(TEMPLATE);
  setBits(raw, 2, 0, 2, state.fan ?? SanyoAc88Fan.Auto);
  setBits(raw, 2, 4, 3, state.mode ?? SanyoAc88Mode.Auto);
  setBits(raw, 2, 7, 1, state.power ? 1 : 0);
  setBits(raw, 3, 0, 5, clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX));
  setBits(raw, 3, 5, 1, state.filter ? 1 : 0);
  setBits(raw, 3, 6, 1, state.swingV ? 1 : 0);

  const clock = clamp(state.clock ?? 0, 0, 23 * 60 + 59);
  raw[4] = 0; // ClockSecs
  raw[5] = clock % 60; // ClockMins
  raw[6] = Math.trunc(clock / 60); // ClockHrs

  setBits(raw, 10, 3, 1, state.turbo ? 1 : 0);
  setBits(raw, 10, 6, 1, state.sleep ? 1 : 0);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

const MESSAGE_GAP = 100000; // kDefaultMessageGap appended after the last frame

/** Encode a raw Sanyo AC88 payload into IR timings (LSB-first). */
export function encodeSanyoAc88Raw(data: Uint8Array, repeat: number = SANYO_AC88_MIN_REPEAT): number[] {
  const result = sendGenericBytes({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP,
    data, msbFirst: false, repeat,
  });
  // The sender appends a guessed inter-message gap after the final frame.
  result[result.length - 1] = result[result.length - 1]! + MESSAGE_GAP;
  return result;
}

/** Encode a Sanyo AC88 state into raw IR timings. */
export function sendSanyoAc88(state: SanyoAc88State, repeat: number = SANYO_AC88_MIN_REPEAT): number[] {
  return encodeSanyoAc88Raw(buildSanyoAc88Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 11-byte Sanyo AC88 state into a state object. */
export function parseSanyoAc88State(raw: Uint8Array): SanyoAc88State {
  return {
    power: !!((raw[2]! >> 7) & 1),
    temp: raw[3]! & 0x1f,
    mode: ((raw[2]! >> 4) & 0x07) as SanyoAc88ModeValue,
    fan: (raw[2]! & 0x03) as SanyoAc88FanValue,
    swingV: !!((raw[3]! >> 6) & 1),
    filter: !!((raw[3]! >> 5) & 1),
    turbo: !!((raw[10]! >> 3) & 1),
    sleep: !!((raw[10]! >> 6) & 1),
    clock: raw[6]! * 60 + raw[5]!,
  };
}

/**
 * Decode raw IR timings as a Sanyo AC88 (11-byte) message.
 *
 * Gated by the fixed `0xAA 0x55` lead bytes (the protocol has no checksum).
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeSanyoAc88(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): SanyoAc88State | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, TOLERANCE, undefined, false, headerOptional,
  );
  if (!frame) return null;
  if (frame.data[0] !== 0xaa || frame.data[1] !== 0x55) return null;
  return parseSanyoAc88State(frame.data);
}
