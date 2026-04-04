/**
 * Daikin 216-bit (27-byte) IR protocol encoder.
 *
 * 2 sections: bytes 0–7 (8 bytes) + bytes 8–26 (19 bytes).
 * Ported from IRremoteESP8266 `ir_Daikin.cpp`.
 */

import { sumBytes, sendGenericBytes } from "../encode.js";
import {
  DaikinMode,
  DaikinFan,
  DAIKIN_SWING_ON,
  DAIKIN_SWING_OFF,
  DAIKIN_MIN_TEMP,
  DAIKIN_MAX_TEMP,
} from "./daikin_common.js";
import type { DaikinModeValue, DaikinFanValue } from "./daikin_common.js";

export { DaikinMode, DaikinFan } from "./daikin_common.js";

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

const HDR_MARK = 3440;
const HDR_SPACE = 1750;
const BIT_MARK = 420;
const ONE_SPACE = 1300;
const ZERO_SPACE = 450;
const GAP = 29650;
const STATE_LENGTH = 27;
const SECTION1_LEN = 8;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Daikin216State {
  power?: boolean;
  temp?: number;
  mode?: DaikinModeValue;
  fan?: DaikinFanValue;
  swingVertical?: boolean;
  swingHorizontal?: boolean;
  powerful?: boolean;
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
  raw[0] = 0x11; raw[1] = 0xda; raw[2] = 0x27; raw[3] = 0xf0;
  raw[8] = 0x11; raw[9] = 0xda; raw[10] = 0x27;
  raw[23] = 0xc0;
  return raw;
}

export function buildDaikin216Raw(state: Daikin216State): Uint8Array {
  const raw = defaultState();

  // Mode (byte 13, bits 4–6)
  let mode: number = state.mode ?? DaikinMode.Auto;
  if (!(mode === DaikinMode.Auto || mode === DaikinMode.Cool || mode === DaikinMode.Heat || mode === DaikinMode.Fan || mode === DaikinMode.Dry))
    mode = DaikinMode.Auto;
  setBitsRange(raw, 13, 4, 3, mode);

  // Power (byte 13, bit 0)
  setBit(raw, 13, 0, state.power ?? false);

  // Temp (byte 14, bits 1–6) — direct value
  const temp = Math.min(Math.max(state.temp ?? 25, DAIKIN_MIN_TEMP), DAIKIN_MAX_TEMP);
  setBitsRange(raw, 14, 1, 6, temp);

  // Fan (byte 16, bits 4–7)
  const fanInput = state.fan ?? DaikinFan.Auto;
  let fan: number;
  if (fanInput === DaikinFan.Quiet || fanInput === DaikinFan.Auto) fan = fanInput;
  else if (fanInput < 1 || fanInput > 5) fan = DaikinFan.Auto;
  else fan = fanInput + 2;
  setBitsRange(raw, 16, 4, 4, fan);

  // SwingV (byte 16, bits 0–3)
  setBitsRange(raw, 16, 0, 4, (state.swingVertical ?? false) ? DAIKIN_SWING_ON : DAIKIN_SWING_OFF);

  // SwingH (byte 17, bits 0–3)
  setBitsRange(raw, 17, 0, 4, (state.swingHorizontal ?? false) ? DAIKIN_SWING_ON : DAIKIN_SWING_OFF);

  // Powerful (byte 21, bit 0)
  setBit(raw, 21, 0, state.powerful ?? false);

  // Checksums
  raw[7] = sumBytes(raw, 0, SECTION1_LEN - 1);
  raw[26] = sumBytes(raw, SECTION1_LEN, STATE_LENGTH - 1);

  return raw;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export function sendDaikin216(state: Daikin216State, repeat = 0): number[] {
  return encodeDaikin216Raw(buildDaikin216Raw(state), repeat);
}

export function encodeDaikin216Raw(data: Uint8Array, repeat = 0): number[] {
  const result: number[] = [];
  const opts = {
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE,
    zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP, msbFirst: false,
  };

  for (let r = 0; r <= repeat; r++) {
    // Section 1 (bytes 0–7)
    const s1 = sendGenericBytes({ ...opts, data: data.subarray(0, SECTION1_LEN) });
    for (let i = 0; i < s1.length; i++) result.push(s1[i]!);
    // Section 2 (bytes 8–26)
    const s2 = sendGenericBytes({ ...opts, data: data.subarray(SECTION1_LEN) });
    for (let i = 0; i < s2.length; i++) result.push(s2[i]!);
  }
  return result;
}
