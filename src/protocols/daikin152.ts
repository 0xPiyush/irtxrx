/**
 * Daikin 152-bit (19-byte) IR protocol encoder.
 *
 * Ported from IRremoteESP8266 `ir_Daikin.cpp` / `ir_Daikin.h`.
 */

import { sumBytes, sendGeneric, sendGenericBytes } from "../encode.js";
import { matchGeneric, matchGenericBytes } from "../decode.js";
import {
  DaikinMode,
  DaikinFan,
  DAIKIN_SWING_ON,
  DAIKIN_SWING_OFF,
  DAIKIN_MIN_TEMP,
  DAIKIN_MAX_TEMP,
  DAIKIN2_MIN_COOL_TEMP,
} from "./daikin_common.js";
import type { DaikinModeValue, DaikinFanValue } from "./daikin_common.js";

export { DaikinMode, DaikinFan } from "./daikin_common.js";
export type { DaikinModeValue, DaikinFanValue } from "./daikin_common.js";

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

const HDR_MARK = 3492;
const HDR_SPACE = 1718;
const BIT_MARK = 433;
const ONE_SPACE = 1529;
const ZERO_SPACE = 433; // kDaikin152ZeroSpace = kDaikin152BitMark
const GAP = 25182;
const LEADER_BITS = 5;
const STATE_LENGTH = 19;
const FAN_TEMP = 0x60; // 96 — special temp for fan-only mode
const DRY_TEMP = DAIKIN2_MIN_COOL_TEMP; // 18

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Daikin152State {
  power?: boolean;
  /** Temperature in °C (10–32). Ignored in Fan/Dry modes. */
  temp?: number;
  mode?: DaikinModeValue;
  /** Fan speed: 1–5, or DaikinFan.Auto / DaikinFan.Quiet. */
  fan?: DaikinFanValue;
  swingVertical?: boolean;
  quiet?: boolean;
  powerful?: boolean;
  econo?: boolean;
  sensor?: boolean;
  comfort?: boolean;
}

// ---------------------------------------------------------------------------
// Build raw byte array
// ---------------------------------------------------------------------------

function defaultState(): Uint8Array {
  const raw = new Uint8Array(STATE_LENGTH);
  raw[0] = 0x11;
  raw[1] = 0xda;
  raw[2] = 0x27;
  // bytes 3–14 are 0x00
  raw[15] = 0xc5;
  // bytes 16–17 are 0x00
  // byte 18 = checksum (set later)
  return raw;
}

// Bit manipulation helpers for byte arrays
function setBit(raw: Uint8Array, byteIdx: number, bitIdx: number, on: boolean) {
  if (on) raw[byteIdx] = raw[byteIdx]! | (1 << bitIdx);
  else raw[byteIdx] = raw[byteIdx]! & ~(1 << bitIdx);
}

function setBitsRange(
  raw: Uint8Array,
  byteIdx: number,
  bitOffset: number,
  size: number,
  value: number,
) {
  const mask = ((1 << size) - 1) << bitOffset;
  raw[byteIdx] = (raw[byteIdx]! & ~mask) | ((value << bitOffset) & mask);
}

/**
 * Build the raw 19-byte Daikin152 state from a state object.
 */
export function buildDaikin152Raw(state: Daikin152State): Uint8Array {
  const raw = defaultState();

  // --- Mode (byte 5, bits 4–6) ---
  let mode: number = state.mode ?? DaikinMode.Auto;
  switch (mode) {
    case DaikinMode.Auto:
    case DaikinMode.Cool:
    case DaikinMode.Heat:
    case DaikinMode.Dry:
    case DaikinMode.Fan:
      break;
    default:
      mode = DaikinMode.Auto;
  }
  setBitsRange(raw, 5, 4, 3, mode);

  // --- Temp (byte 6, bits 1–7) ---
  // C++ behaviour: setMode() sets a mode-specific default temp for Fan/Dry,
  // then setTemp() overrides if the caller provides one.
  let temp: number;
  if (state.temp !== undefined) {
    // Caller provided temp — apply same logic as C++ setTemp()
    if (state.temp === FAN_TEMP) {
      temp = FAN_TEMP; // Special fan-only temp passthrough
    } else {
      const minTemp = mode === DaikinMode.Heat ? DAIKIN_MIN_TEMP : DAIKIN2_MIN_COOL_TEMP;
      temp = Math.min(Math.max(state.temp, minTemp), DAIKIN_MAX_TEMP);
    }
  } else {
    // No temp provided — use mode-specific default
    if (mode === DaikinMode.Fan) temp = FAN_TEMP;
    else if (mode === DaikinMode.Dry) temp = DRY_TEMP;
    else temp = 25;
  }
  setBitsRange(raw, 6, 1, 7, temp);

  // --- Fan (byte 8, bits 4–7) ---
  let fan: number;
  const fanInput = state.fan ?? DaikinFan.Auto;
  if (fanInput === DaikinFan.Quiet || fanInput === DaikinFan.Auto) {
    fan = fanInput;
  } else if (fanInput < 1 || fanInput > 5) {
    fan = DaikinFan.Auto;
  } else {
    fan = fanInput + 2; // Internal encoding: speed + 2
  }
  setBitsRange(raw, 8, 4, 4, fan);

  // --- SwingV (byte 8, bits 0–3) ---
  const swingV = state.swingVertical ?? false;
  setBitsRange(raw, 8, 0, 4, swingV ? DAIKIN_SWING_ON : DAIKIN_SWING_OFF);

  // --- Power (byte 5, bit 0) ---
  setBit(raw, 5, 0, state.power ?? false);

  // --- Quiet, Powerful, Econo, Comfort with mutual exclusions ---
  // Apply in same order as C++ class: quiet → powerful → econo → comfort
  let quiet = state.quiet ?? false;
  let powerful = state.powerful ?? false;
  let econo = state.econo ?? false;
  let comfort = state.comfort ?? false;

  // Resolve mutual exclusions (same logic as C++ setters called in order)
  if (quiet) powerful = false;
  if (powerful) {
    quiet = false;
    comfort = false;
    econo = false;
  }
  if (econo) powerful = false;
  if (comfort) {
    powerful = false;
    // Comfort also forces fan=auto and swing=off
    setBitsRange(raw, 8, 4, 4, DaikinFan.Auto);
    setBitsRange(raw, 8, 0, 4, DAIKIN_SWING_OFF);
  }

  setBit(raw, 13, 5, quiet);    // Byte 13, bit 5
  setBit(raw, 13, 0, powerful);  // Byte 13, bit 0
  setBit(raw, 16, 2, econo);    // Byte 16, bit 2
  setBit(raw, 16, 1, comfort);  // Byte 16, bit 1
  setBit(raw, 16, 3, state.sensor ?? false); // Byte 16, bit 3

  // --- Checksum (byte 18) ---
  raw[18] = sumBytes(raw, 0, STATE_LENGTH - 1);

  return raw;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a Daikin152 AC state into raw IR timings.
 */
export function sendDaikin152(state: Daikin152State, repeat = 0): number[] {
  const raw = buildDaikin152Raw(state);
  return encodeDaikin152Raw(raw, repeat);
}

/**
 * Encode a raw 19-byte Daikin152 state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendDaikin152`.
 */
export function encodeDaikin152Raw(data: Uint8Array, repeat = 0): number[] {
  const result: number[] = [];

  for (let r = 0; r <= repeat; r++) {
    // Leader: 5 bits of zero (no header)
    const leader = sendGeneric({
      headerMark: 0,
      headerSpace: 0,
      oneMark: BIT_MARK,
      oneSpace: ONE_SPACE,
      zeroMark: BIT_MARK,
      zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK,
      gap: GAP,
      data: 0n,
      nbits: LEADER_BITS,
      msbFirst: false,
    });
    for (let i = 0; i < leader.length; i++) result.push(leader[i]!);

    // Header + Data + Footer
    const frame = sendGenericBytes({
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
    });
    for (let i = 0; i < frame.length; i++) result.push(frame[i]!);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Decode API
// ---------------------------------------------------------------------------

/**
 * Try to skip a leader section (e.g. 5 zero bits + footer + gap).
 * Returns the new offset past the leader, or the original offset if no leader.
 */
function skipLeader(
  timings: number[],
  offset: number,
): number {
  const result = matchGeneric(
    timings, offset, timings.length - offset, LEADER_BITS,
    0, 0,                             // no header
    BIT_MARK, ONE_SPACE,              // oneMark, oneSpace
    BIT_MARK, ZERO_SPACE,             // zeroMark, zeroSpace
    BIT_MARK, GAP,                    // footerMark, gap
    true,                             // atLeast for gap
  );
  return result ? offset + result.used : offset;
}

/**
 * Decode raw IR timings as a Daikin152 message.
 *
 * The 5-bit leader preamble is optional — hardware captures often miss it.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeDaikin152(
  timings: number[],
  offset: number = 0,
): Daikin152State | null {
  // Skip leader if present.
  let pos = skipLeader(timings, offset);

  // Match main frame: header + 19 bytes (LSB-first) + footer.
  const frame = matchGenericBytes(
    timings, pos, timings.length - pos, STATE_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false, // atLeast, tol, excess, msbFirst=false
  );
  if (!frame) return null;

  const raw = frame.data;

  // Validate checksum.
  if (raw[18] !== sumBytes(raw, 0, STATE_LENGTH - 1)) return null;

  // Extract state from byte/bit positions.
  const mode = ((raw[5]! >> 4) & 0b111) as DaikinModeValue;
  const temp = (raw[6]! >> 1) & 0x7F;

  const fanInternal = (raw[8]! >> 4) & 0x0F;
  const fan: DaikinFanValue =
    fanInternal === DaikinFan.Auto || fanInternal === DaikinFan.Quiet
      ? fanInternal
      : (fanInternal - 2) as DaikinFanValue;

  return {
    power: !!(raw[5]! & 0x01),
    temp,
    mode,
    fan,
    swingVertical: (raw[8]! & 0x0F) === DAIKIN_SWING_ON,
    quiet: !!(raw[13]! & (1 << 5)),
    powerful: !!(raw[13]! & (1 << 0)),
    econo: !!(raw[16]! & (1 << 2)),
    comfort: !!(raw[16]! & (1 << 1)),
    sensor: !!(raw[16]! & (1 << 3)),
  };
}
