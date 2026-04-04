/**
 * Daikin 160-bit (20-byte) IR protocol encoder.
 *
 * 2 sections: bytes 0–6 (7 bytes) + bytes 7–19 (13 bytes).
 * Ported from IRremoteESP8266 `ir_Daikin.cpp`.
 */

import { sumBytes, sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";
import {
  DaikinMode,
  DaikinFan,
  DAIKIN_MIN_TEMP,
  DAIKIN_MAX_TEMP,
} from "./daikin_common.js";
import type { DaikinModeValue, DaikinFanValue } from "./daikin_common.js";

export { DaikinMode, DaikinFan } from "./daikin_common.js";
export type { DaikinModeValue, DaikinFanValue } from "./daikin_common.js";

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

const HDR_MARK = 5000;
const HDR_SPACE = 2145;
const BIT_MARK = 342;
const ONE_SPACE = 1786;
const ZERO_SPACE = 700;
const GAP = 29650;
const STATE_LENGTH = 20;
const SECTION1_LEN = 7;

// Swing positions
export const Daikin160SwingV = {
  Lowest: 0x1,
  Low: 0x2,
  Middle: 0x3,
  High: 0x4,
  Highest: 0x5,
  Auto: 0xf,
} as const;

export type Daikin160SwingVValue = (typeof Daikin160SwingV)[keyof typeof Daikin160SwingV];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Daikin160State {
  power?: boolean;
  temp?: number;
  mode?: DaikinModeValue;
  fan?: DaikinFanValue;
  swingVertical?: Daikin160SwingVValue;
}

// ---------------------------------------------------------------------------
// Bit helpers
// ---------------------------------------------------------------------------

function setBit(raw: Uint8Array, byteIdx: number, bitIdx: number, on: boolean) {
  if (on) raw[byteIdx] = raw[byteIdx]! | (1 << bitIdx);
  else raw[byteIdx] = raw[byteIdx]! & ~(1 << bitIdx);
}

function setBitsRange(
  raw: Uint8Array, byteIdx: number, bitOffset: number, size: number, value: number,
) {
  const mask = ((1 << size) - 1) << bitOffset;
  raw[byteIdx] = (raw[byteIdx]! & ~mask) | ((value << bitOffset) & mask);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function defaultState(): Uint8Array {
  const raw = new Uint8Array(STATE_LENGTH);
  raw[0] = 0x11; raw[1] = 0xda; raw[2] = 0x27; raw[3] = 0xf0; raw[4] = 0x0d;
  raw[7] = 0x11; raw[8] = 0xda; raw[9] = 0x27;
  raw[11] = 0xd3;
  raw[12] = 0x30; // Power=0, Mode=kDaikinCool(0b011)
  raw[13] = 0x11; // SwingV (upper nibble) = 0x1 (lowest)
  raw[16] = 0x1e; // Temp = (25-10)=15 at bits 1-6 → 0x1e
  raw[17] = 0x0a; // Fan = kDaikinFanAuto(0xA) at bits 0-3... wait
  raw[18] = 0x08;
  return raw;
}

export function buildDaikin160Raw(state: Daikin160State): Uint8Array {
  const raw = defaultState();

  // Mode (byte 12, bits 4–6)
  let mode: number = state.mode ?? DaikinMode.Cool;
  if (!(mode === DaikinMode.Auto || mode === DaikinMode.Cool || mode === DaikinMode.Heat || mode === DaikinMode.Fan || mode === DaikinMode.Dry))
    mode = DaikinMode.Auto;
  setBitsRange(raw, 12, 4, 3, mode);

  // Power (byte 12, bit 0)
  setBit(raw, 12, 0, state.power ?? false);

  // Temp (byte 16, bits 1–6) — stored as (degrees - 10)
  const temp = Math.min(Math.max(state.temp ?? 25, DAIKIN_MIN_TEMP), DAIKIN_MAX_TEMP);
  setBitsRange(raw, 16, 1, 6, temp - 10);

  // Fan (byte 17, bits 0–3)
  const fanInput = state.fan ?? DaikinFan.Auto;
  let fan: number;
  if (fanInput === DaikinFan.Quiet || fanInput === DaikinFan.Auto) fan = fanInput;
  else if (fanInput < 1 || fanInput > 5) fan = DaikinFan.Auto;
  else fan = fanInput + 2;
  setBitsRange(raw, 17, 0, 4, fan);

  // SwingV (byte 13, bits 4–7)
  const swingV = state.swingVertical ?? Daikin160SwingV.Auto;
  setBitsRange(raw, 13, 4, 4, swingV);

  // Checksums
  raw[6] = sumBytes(raw, 0, SECTION1_LEN - 1);
  raw[19] = sumBytes(raw, SECTION1_LEN, STATE_LENGTH - 1);

  return raw;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export function sendDaikin160(state: Daikin160State, repeat = 0): number[] {
  return encodeDaikin160Raw(buildDaikin160Raw(state), repeat);
}

export function encodeDaikin160Raw(data: Uint8Array, repeat = 0): number[] {
  const result: number[] = [];
  const opts = {
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE,
    zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP, msbFirst: false,
  };

  for (let r = 0; r <= repeat; r++) {
    const s1 = sendGenericBytes({ ...opts, data: data.subarray(0, SECTION1_LEN) });
    for (let i = 0; i < s1.length; i++) result.push(s1[i]!);
    const s2 = sendGenericBytes({ ...opts, data: data.subarray(SECTION1_LEN) });
    for (let i = 0; i < s2.length; i++) result.push(s2[i]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Decode API
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Daikin160 message.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeDaikin160(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Daikin160State | null {
  let pos = offset;

  // Section 1: bytes 0–6 (7 bytes)
  const section1 = matchGenericBytes(
    timings, pos, timings.length - pos, SECTION1_LEN,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false, // atLeast, tol, excess, msbFirst=false
    headerOptional,
  );
  if (!section1) return null;
  pos += section1.used;

  // Section 2: bytes 7–19 (13 bytes)
  const section2Len = STATE_LENGTH - SECTION1_LEN;
  const section2 = matchGenericBytes(
    timings, pos, timings.length - pos, section2Len,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false,
  );
  if (!section2) return null;

  // Combine into full raw array.
  const raw = new Uint8Array(STATE_LENGTH);
  raw.set(section1.data, 0);
  raw.set(section2.data, SECTION1_LEN);

  // Validate checksums.
  if (raw[6] !== sumBytes(raw, 0, SECTION1_LEN - 1)) return null;
  if (raw[19] !== sumBytes(raw, SECTION1_LEN, STATE_LENGTH - 1)) return null;

  // Extract state from byte/bit positions.
  const mode = ((raw[12]! >> 4) & 0b111) as DaikinModeValue;
  const temp = ((raw[16]! >> 1) & 0x3F) + 10;

  const fanInternal = raw[17]! & 0x0F;
  const fan: DaikinFanValue =
    fanInternal === DaikinFan.Auto || fanInternal === DaikinFan.Quiet
      ? fanInternal
      : (fanInternal - 2) as DaikinFanValue;

  const swingV = ((raw[13]! >> 4) & 0x0F) as Daikin160SwingVValue;

  return {
    power: !!(raw[12]! & 0x01),
    temp,
    mode,
    fan,
    swingVertical: swingV,
  };
}
