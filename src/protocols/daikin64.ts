/**
 * Daikin 64-bit IR protocol encoder.
 *
 * Ported from IRremoteESP8266 `ir_Daikin.cpp` / `ir_Daikin.h`.
 *
 * This is a stateless encoder: pass a {@link Daikin64State} object and get
 * back a raw IR timing array.
 */

import {
  uint8ToBcd,
  bcdToUint8,
  sumNibbles64,
  sendGeneric,
} from "../encode.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Daikin.h exactly
// ---------------------------------------------------------------------------

const DAIKIN64_LDR_MARK = 9800;
const DAIKIN64_LDR_SPACE = 9800;
const DAIKIN64_HDR_MARK = 4600;
const DAIKIN64_HDR_SPACE = 2500;
const DAIKIN64_BIT_MARK = 350;
const DAIKIN64_ONE_SPACE = 954;
const DAIKIN64_ZERO_SPACE = 382;
const DAIKIN64_GAP = 20300;
const DAIKIN64_DEFAULT_MESSAGE_GAP = 100000;
const DAIKIN64_BITS = 64;
const DAIKIN64_CHECKSUM_OFFSET = 60;

// ---------------------------------------------------------------------------
// Protocol values
// ---------------------------------------------------------------------------

export const Daikin64Mode = {
  Dry: 0b0001,
  Cool: 0b0010,
  Fan: 0b0100,
  Heat: 0b1000,
} as const;

export type Daikin64ModeValue = (typeof Daikin64Mode)[keyof typeof Daikin64Mode];

export const Daikin64Fan = {
  Auto: 0b0001,
  High: 0b0010,
  Med: 0b0100,
  Low: 0b1000,
  Quiet: 0b1001,
  Turbo: 0b0011,
} as const;

export type Daikin64FanValue = (typeof Daikin64Fan)[keyof typeof Daikin64Fan];

const DAIKIN64_MIN_TEMP = 16;
const DAIKIN64_MAX_TEMP = 30;

// Known good default state: 0x7C16161607204216
const DAIKIN64_DEFAULT_STATE = 0x7C16161607204216n;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Daikin64State {
  /** Power toggle. */
  power?: boolean;
  /** Temperature in degrees Celsius (16–30). */
  temp?: number;
  /** Operating mode. */
  mode?: Daikin64ModeValue;
  /** Fan speed. */
  fan?: Daikin64FanValue;
  /** Vertical swing. */
  swingVertical?: boolean;
  /** Sleep mode. */
  sleep?: boolean;
  /** Clock: minutes since midnight (0–1439). */
  clock?: number;
  /** On timer enabled. */
  onTimerEnabled?: boolean;
  /** On timer: minutes since midnight (resolution 30 min). */
  onTime?: number;
  /** Off timer enabled. */
  offTimerEnabled?: boolean;
  /** Off timer: minutes since midnight (resolution 30 min). */
  offTime?: number;
}

// ---------------------------------------------------------------------------
// Bit packing helpers (little-endian bitfield layout)
// ---------------------------------------------------------------------------

function setBits(
  value: bigint,
  offset: number,
  size: number,
  bits: number,
): bigint {
  const mask = ((1n << BigInt(size)) - 1n) << BigInt(offset);
  return (value & ~mask) | ((BigInt(bits) & ((1n << BigInt(size)) - 1n)) << BigInt(offset));
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

function calcChecksum(state: bigint): number {
  return sumNibbles64(state, DAIKIN64_CHECKSUM_OFFSET);
}

// ---------------------------------------------------------------------------
// State → raw uint64
// ---------------------------------------------------------------------------

/**
 * Build the raw 64-bit Daikin64 value from a state object.
 * Fields not present in the state use the known-good defaults.
 */
export function buildDaikin64Raw(state: Daikin64State): bigint {
  let raw = DAIKIN64_DEFAULT_STATE;

  if (state.mode !== undefined) {
    raw = setBits(raw, 8, 4, state.mode);
  }

  if (state.fan !== undefined) {
    raw = setBits(raw, 12, 4, state.fan);
  }

  if (state.clock !== undefined) {
    let mins = state.clock;
    if (mins >= 24 * 60) mins = 0;
    raw = setBits(raw, 16, 8, uint8ToBcd(mins % 60));
    raw = setBits(raw, 24, 8, uint8ToBcd(Math.trunc(mins / 60)));
  }

  if (state.onTime !== undefined) {
    let mins = state.onTime;
    if (mins >= 24 * 60) mins = 0;
    raw = setBits(raw, 38, 1, (mins % 60) >= 30 ? 1 : 0); // OnHalfHour
    raw = setBits(raw, 32, 6, uint8ToBcd(Math.trunc(mins / 60))); // OnHours
  }

  if (state.onTimerEnabled !== undefined) {
    raw = setBits(raw, 39, 1, state.onTimerEnabled ? 1 : 0);
  }

  if (state.offTime !== undefined) {
    let mins = state.offTime;
    if (mins >= 24 * 60) mins = 0;
    raw = setBits(raw, 46, 1, (mins % 60) >= 30 ? 1 : 0); // OffHalfHour
    raw = setBits(raw, 40, 6, uint8ToBcd(Math.trunc(mins / 60))); // OffHours
  }

  if (state.offTimerEnabled !== undefined) {
    raw = setBits(raw, 47, 1, state.offTimerEnabled ? 1 : 0);
  }

  if (state.temp !== undefined) {
    const degrees = Math.min(Math.max(state.temp, DAIKIN64_MIN_TEMP), DAIKIN64_MAX_TEMP);
    raw = setBits(raw, 48, 8, uint8ToBcd(degrees));
  }

  if (state.swingVertical !== undefined) {
    raw = setBits(raw, 56, 1, state.swingVertical ? 1 : 0);
  }

  if (state.sleep !== undefined) {
    raw = setBits(raw, 57, 1, state.sleep ? 1 : 0);
  }

  if (state.power !== undefined) {
    raw = setBits(raw, 59, 1, state.power ? 1 : 0);
  }

  // Compute and set checksum (bits 60–63)
  raw = setBits(raw, DAIKIN64_CHECKSUM_OFFSET, 4, calcChecksum(raw));

  return raw;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a Daikin64 AC state into raw IR timings.
 *
 * @param state  The desired AC state.
 * @param repeat Number of times to repeat the message (default 0).
 * @returns Flat array of alternating mark/space durations in microseconds.
 */
export function sendDaikin64(
  state: Daikin64State,
  repeat = 0,
): number[] {
  const data = buildDaikin64Raw(state);
  return encodeDaikin64Raw(data, repeat);
}

/**
 * Encode a raw 64-bit Daikin64 value into IR timings.
 * Useful when you already have the packed uint64 (e.g. from `buildDaikin64Raw`).
 *
 * Matches IRremoteESP8266 `IRsend::sendDaikin64`.
 */
export function encodeDaikin64Raw(
  data: bigint,
  repeat = 0,
): number[] {
  const result: number[] = [];

  for (let r = 0; r <= repeat; r++) {
    // Leader: 2x (mark + space)
    for (let i = 0; i < 2; i++) {
      result.push(DAIKIN64_LDR_MARK);
      result.push(DAIKIN64_LDR_SPACE);
    }

    // Header + Data + Footer #1
    const frame = sendGeneric({
      headerMark: DAIKIN64_HDR_MARK,
      headerSpace: DAIKIN64_HDR_SPACE,
      oneMark: DAIKIN64_BIT_MARK,
      oneSpace: DAIKIN64_ONE_SPACE,
      zeroMark: DAIKIN64_BIT_MARK,
      zeroSpace: DAIKIN64_ZERO_SPACE,
      footerMark: DAIKIN64_BIT_MARK,
      gap: DAIKIN64_GAP,
      data,
      nbits: DAIKIN64_BITS,
      msbFirst: false,
    });
    for (let i = 0; i < frame.length; i++) result.push(frame[i]!);

    // Footer #2
    result.push(DAIKIN64_HDR_MARK);
    result.push(DAIKIN64_DEFAULT_MESSAGE_GAP);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Decode API
// ---------------------------------------------------------------------------

/**
 * Try to skip the leader section (2x mark+space pairs + footer mark + gap).
 * Returns the new offset past the leader, or the original offset if no leader.
 */
function skipLeader(
  timings: number[],
  offset: number,
): number {
  // The leader consists of 2 pairs of (LDR_MARK, LDR_SPACE).
  // We match these as 2 x matchGeneric with 0 data bits.
  let pos = offset;
  for (let i = 0; i < 2; i++) {
    const result = matchGeneric(
      timings, pos, timings.length - pos, 0,
      DAIKIN64_LDR_MARK, DAIKIN64_LDR_SPACE, // header mark, header space
      0, 0,                                    // oneMark, oneSpace (unused, 0 bits)
      0, 0,                                    // zeroMark, zeroSpace (unused)
      0, 0,                                    // no footer
      true,
    );
    if (!result) return offset; // Leader not found, return original offset
    pos += result.used;
  }
  return pos;
}

/**
 * Decode raw IR timings as a Daikin64 message.
 *
 * The leader (2x mark+space pairs) is optional -- hardware captures may miss it.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeDaikin64(
  timings: number[],
  offset: number = 0,
): Daikin64State | null {
  // Skip leader if present.
  let pos = skipLeader(timings, offset);

  // Match main frame: header + 64 bits (LSB-first) + footer + gap.
  const frame = matchGeneric(
    timings, pos, timings.length - pos, DAIKIN64_BITS,
    DAIKIN64_HDR_MARK, DAIKIN64_HDR_SPACE,
    DAIKIN64_BIT_MARK, DAIKIN64_ONE_SPACE,
    DAIKIN64_BIT_MARK, DAIKIN64_ZERO_SPACE,
    DAIKIN64_BIT_MARK, DAIKIN64_GAP,
    true, undefined, undefined, false, // atLeast, tol, excess, msbFirst=false
  );
  if (!frame) return null;

  const raw = frame.data;

  // Validate nibble checksum (bits 60-63).
  const expectedChecksum = sumNibbles64(raw, DAIKIN64_CHECKSUM_OFFSET);
  const actualChecksum = Number((raw >> 60n) & 0xFn);
  if (actualChecksum !== expectedChecksum) return null;

  // Extract fields from the 64-bit value (inverse of buildDaikin64Raw).
  const getBits = (off: number, size: number): number =>
    Number((raw >> BigInt(off)) & ((1n << BigInt(size)) - 1n));

  const mode = getBits(8, 4) as Daikin64ModeValue;
  const fan = getBits(12, 4) as Daikin64FanValue;

  // Clock: BCD minutes (bits 16-23) + BCD hours (bits 24-31)
  const clockMinBcd = getBits(16, 8);
  const clockHourBcd = getBits(24, 8);
  const clock = bcdToUint8(clockHourBcd) * 60 + bcdToUint8(clockMinBcd);

  // On timer: BCD hours (bits 32-37, 6 bits) + half-hour flag (bit 38) + enabled (bit 39)
  const onHoursBcd = getBits(32, 6);
  const onHalfHour = getBits(38, 1);
  const onTimerEnabled = !!getBits(39, 1);
  const onTime = bcdToUint8(onHoursBcd) * 60 + (onHalfHour ? 30 : 0);

  // Off timer: BCD hours (bits 40-45, 6 bits) + half-hour flag (bit 46) + enabled (bit 47)
  const offHoursBcd = getBits(40, 6);
  const offHalfHour = getBits(46, 1);
  const offTimerEnabled = !!getBits(47, 1);
  const offTime = bcdToUint8(offHoursBcd) * 60 + (offHalfHour ? 30 : 0);

  // Temp: BCD (bits 48-55)
  const tempBcd = getBits(48, 8);
  const temp = bcdToUint8(tempBcd);

  const swingVertical = !!getBits(56, 1);
  const sleep = !!getBits(57, 1);
  const power = !!getBits(59, 1);

  return {
    power,
    temp,
    mode,
    fan,
    swingVertical,
    sleep,
    clock,
    onTimerEnabled,
    onTime,
    offTimerEnabled,
    offTime,
  };
}
