/**
 * Daikin2 312-bit (39-byte) IR protocol encoder.
 *
 * Leader + 2 sections: bytes 0–19 (20) + bytes 20–38 (19).
 * 36700 Hz carrier frequency.
 * Ported from IRremoteESP8266 `ir_Daikin.cpp`.
 */

import { sumBytes, sendGenericBytes } from "../encode.js";
import { matchGeneric, matchGenericBytes } from "../decode.js";
import {
  DaikinMode,
  DaikinFan,
  DAIKIN_MIN_TEMP,
  DAIKIN_MAX_TEMP,
  DAIKIN2_MIN_COOL_TEMP,
} from "./daikin_common.js";
import type { DaikinModeValue, DaikinFanValue } from "./daikin_common.js";

export { DaikinMode, DaikinFan } from "./daikin_common.js";

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

const LDR_MARK = 10024;
const LDR_SPACE = 25180;
const HDR_MARK = 3500;
const HDR_SPACE = 1728;
const BIT_MARK = 460;
const ONE_SPACE = 1270;
const ZERO_SPACE = 420;
const GAP = LDR_MARK + LDR_SPACE; // 35204
const STATE_LENGTH = 39;
const SECTION1_LEN = 20;
const UNUSED_TIME = 0x600;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Daikin2State {
  power?: boolean;
  temp?: number;
  mode?: DaikinModeValue;
  fan?: DaikinFanValue;
  swingVertical?: number;
  swingHorizontal?: number;
  quiet?: boolean;
  powerful?: boolean;
  econo?: boolean;
  /** Light setting (0–3). */
  light?: number;
  /** Beep setting (0–3). */
  beep?: number;
  clean?: boolean;
  mold?: boolean;
  freshAir?: boolean;
  freshAirHigh?: boolean;
  eye?: boolean;
  eyeAuto?: boolean;
  purify?: boolean;
  currentTime?: number;
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

function setFieldLE(
  raw: Uint8Array, startByte: number, startBit: number, totalBits: number, value: number,
) {
  let v = value;
  let byte = startByte;
  let bit = startBit;
  let remaining = totalBits;
  while (remaining > 0) {
    const bitsInThisByte = Math.min(remaining, 8 - bit);
    const mask = ((1 << bitsInThisByte) - 1) << bit;
    raw[byte] = (raw[byte]! & ~mask) | (((v & ((1 << bitsInThisByte) - 1)) << bit) & mask);
    v >>>= bitsInThisByte;
    remaining -= bitsInThisByte;
    byte++;
    bit = 0;
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function defaultState(): Uint8Array {
  const raw = new Uint8Array(STATE_LENGTH);
  // Section 1 defaults
  raw[0] = 0x11; raw[1] = 0xda; raw[2] = 0x27;
  raw[4] = 0x01; raw[6] = 0xc0; raw[7] = 0x70;
  raw[8] = 0x08; raw[9] = 0x0c; raw[10] = 0x80;
  raw[11] = 0x04; raw[12] = 0xb0; raw[13] = 0x16;
  raw[14] = 0x24;
  raw[17] = 0xbe; raw[18] = 0xd0;
  // Section 2 defaults
  raw[20] = 0x11; raw[21] = 0xda; raw[22] = 0x27;
  raw[25] = 0x08; // Power=0, Mode=kDaikinAuto(0)
  raw[28] = 0xa0; // Fan=kDaikinFanAuto(0xA)
  raw[35] = 0xc1; raw[36] = 0x80; raw[37] = 0x60;

  // disableOnTimer: OnTime = UNUSED_TIME, OnTimer = false, SleepTimer = false
  setFieldLE(raw, 30, 0, 12, UNUSED_TIME);
  setBit(raw, 25, 1, false); // OnTimer
  setBit(raw, 36, 5, false); // SleepTimer

  // disableOffTimer: OffTime = UNUSED_TIME, OffTimer = false
  setFieldLE(raw, 31, 4, 12, UNUSED_TIME);
  setBit(raw, 25, 2, false); // OffTimer

  return raw;
}

export function buildDaikin2Raw(state: Daikin2State): Uint8Array {
  const raw = defaultState();

  // --- Section 1 fields ---

  // CurrentTime (bytes 5–6, bits 0–11 starting at byte 5 bit 0)
  if (state.currentTime !== undefined) {
    let mins = state.currentTime;
    if (mins > 24 * 60) mins = 0;
    setFieldLE(raw, 5, 0, 12, mins);
  }

  // Light (byte 7, bits 4–5)
  if (state.light !== undefined) setBitsRange(raw, 7, 4, 2, state.light & 0x3);
  // Beep (byte 7, bits 6–7)
  if (state.beep !== undefined) setBitsRange(raw, 7, 6, 2, state.beep & 0x3);

  // FreshAir (byte 8, bit 0), Mold (byte 8, bit 3), Clean (byte 8, bit 5), FreshAirHigh (byte 8, bit 7)
  if (state.freshAir !== undefined) setBit(raw, 8, 0, state.freshAir);
  if (state.mold !== undefined) setBit(raw, 8, 3, state.mold);
  if (state.clean !== undefined) setBit(raw, 8, 5, state.clean);
  if (state.freshAirHigh !== undefined) setBit(raw, 8, 7, state.freshAirHigh);

  // EyeAuto (byte 13, bit 7)
  if (state.eyeAuto !== undefined) setBit(raw, 13, 7, state.eyeAuto);

  // SwingH (byte 17, all 8 bits)
  raw[17] = (state.swingHorizontal ?? 0) & 0xff;

  // SwingV (byte 18, bits 0–3)
  setBitsRange(raw, 18, 0, 4, (state.swingVertical ?? 0) & 0xf);

  // --- Section 2 fields ---

  // Mode (byte 25, bits 4–6)
  let mode: number = state.mode ?? DaikinMode.Auto;
  if (!(mode === DaikinMode.Auto || mode === DaikinMode.Cool || mode === DaikinMode.Heat || mode === DaikinMode.Fan || mode === DaikinMode.Dry))
    mode = DaikinMode.Auto;
  setBitsRange(raw, 25, 4, 3, mode);

  // Temp (byte 26, bits 1–6)
  let temp: number;
  if (state.temp !== undefined) {
    const minTemp = (mode === DaikinMode.Cool) ? DAIKIN2_MIN_COOL_TEMP : DAIKIN_MIN_TEMP;
    temp = Math.min(Math.max(state.temp, minTemp), DAIKIN_MAX_TEMP);
  } else {
    temp = 25;
  }
  setBitsRange(raw, 26, 1, 6, temp);

  // Fan (byte 28, bits 4–7)
  const fanInput = state.fan ?? DaikinFan.Auto;
  let fan: number;
  if (fanInput === DaikinFan.Quiet || fanInput === DaikinFan.Auto) fan = fanInput;
  else if (fanInput < 1 || fanInput > 5) fan = DaikinFan.Auto;
  else fan = fanInput + 2;
  setBitsRange(raw, 28, 4, 4, fan);

  // Power (byte 25, bit 0) + Power2 (byte 6, bit 7 — inverted)
  const power = state.power ?? false;
  setBit(raw, 25, 0, power);
  // Power2 is at section 1, byte 6 bit 7 (bit 15 of the CurrentTime+Power2 field)
  setBit(raw, 6, 7, !power);

  // Quiet (byte 33, bit 5), Powerful (byte 33, bit 0)
  let quiet = state.quiet ?? false;
  let powerful = state.powerful ?? false;
  if (quiet) powerful = false;
  if (powerful) quiet = false;
  setBit(raw, 33, 5, quiet);
  setBit(raw, 33, 0, powerful);

  // Econo (byte 36, bit 2), Eye (byte 36, bit 1), Purify (byte 36, bit 4)
  if (state.econo !== undefined) setBit(raw, 36, 2, state.econo);
  if (state.eye !== undefined) setBit(raw, 36, 1, state.eye);
  if (state.purify !== undefined) setBit(raw, 36, 4, state.purify);

  // --- Checksums ---
  raw[19] = sumBytes(raw, 0, SECTION1_LEN - 1);
  raw[38] = sumBytes(raw, SECTION1_LEN, STATE_LENGTH - 1);

  return raw;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export function sendDaikin2(state: Daikin2State, repeat = 0): number[] {
  return encodeDaikin2Raw(buildDaikin2Raw(state), repeat);
}

export function encodeDaikin2Raw(data: Uint8Array, repeat = 0): number[] {
  const result: number[] = [];
  const sectionOpts = {
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE,
    zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP, msbFirst: false,
  };

  for (let r = 0; r <= repeat; r++) {
    // Leader (mark + space)
    result.push(LDR_MARK);
    result.push(LDR_SPACE);

    // Section 1 (bytes 0–19)
    const s1 = sendGenericBytes({ ...sectionOpts, data: data.subarray(0, SECTION1_LEN) });
    for (let i = 0; i < s1.length; i++) result.push(s1[i]!);

    // Section 2 (bytes 20–38)
    const s2 = sendGenericBytes({ ...sectionOpts, data: data.subarray(SECTION1_LEN) });
    for (let i = 0; i < s2.length; i++) result.push(s2[i]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Decode API
// ---------------------------------------------------------------------------

/**
 * Read a little-endian bitfield spanning one or more bytes.
 * Inverse of `setFieldLE`.
 */
function getFieldLE(
  raw: Uint8Array, startByte: number, startBit: number, totalBits: number,
): number {
  let value = 0;
  let byte = startByte;
  let bit = startBit;
  let remaining = totalBits;
  let shift = 0;
  while (remaining > 0) {
    const bitsInThisByte = Math.min(remaining, 8 - bit);
    const mask = ((1 << bitsInThisByte) - 1) << bit;
    value |= ((raw[byte]! & mask) >>> bit) << shift;
    shift += bitsInThisByte;
    remaining -= bitsInThisByte;
    byte++;
    bit = 0;
  }
  return value;
}

/**
 * Decode raw IR timings as a Daikin2 message.
 *
 * The leader mark/space pair is optional — hardware captures may miss it.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeDaikin2(
  timings: number[],
  offset: number = 0,
): Daikin2State | null {
  let pos = offset;

  // Try to skip leader (mark + space pair, 0 data bits).
  const leader = matchGeneric(
    timings, pos, timings.length - pos, 0,
    LDR_MARK, LDR_SPACE,             // header mark/space
    BIT_MARK, ONE_SPACE,              // oneMark, oneSpace (unused, 0 bits)
    BIT_MARK, ZERO_SPACE,             // zeroMark, zeroSpace (unused, 0 bits)
    0, 0,                             // no footer
    true,                             // atLeast
  );
  if (leader) pos += leader.used;

  // Section 1: 20 bytes (LSB-first)
  const s1 = matchGenericBytes(
    timings, pos, timings.length - pos, SECTION1_LEN,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false,
  );
  if (!s1) return null;
  pos += s1.used;

  // Section 2: 19 bytes (LSB-first)
  const s2Len = STATE_LENGTH - SECTION1_LEN;
  const s2 = matchGenericBytes(
    timings, pos, timings.length - pos, s2Len,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false,
  );
  if (!s2) return null;

  // Concatenate sections into one 39-byte array.
  const raw = new Uint8Array(STATE_LENGTH);
  raw.set(s1.data, 0);
  raw.set(s2.data, SECTION1_LEN);

  // Validate checksums.
  if (raw[19] !== sumBytes(raw, 0, SECTION1_LEN - 1)) return null;
  if (raw[38] !== sumBytes(raw, SECTION1_LEN, STATE_LENGTH - 1)) return null;

  // --- Extract state ---

  // CurrentTime (bytes 5–6, bits 0–11 LE)
  const currentTime = getFieldLE(raw, 5, 0, 12);

  // Light (byte 7, bits 4–5)
  const light = (raw[7]! >> 4) & 0x3;

  // Beep (byte 7, bits 6–7)
  const beep = (raw[7]! >> 6) & 0x3;

  // FreshAir, Mold, Clean, FreshAirHigh (byte 8)
  const freshAir = !!(raw[8]! & (1 << 0));
  const mold = !!(raw[8]! & (1 << 3));
  const clean = !!(raw[8]! & (1 << 5));
  const freshAirHigh = !!(raw[8]! & (1 << 7));

  // EyeAuto (byte 13, bit 7)
  const eyeAuto = !!(raw[13]! & (1 << 7));

  // SwingH (byte 17, all 8 bits)
  const swingHorizontal = raw[17]!;

  // SwingV (byte 18, bits 0–3)
  const swingVertical = raw[18]! & 0x0f;

  // Mode (byte 25, bits 4–6)
  const mode = ((raw[25]! >> 4) & 0b111) as DaikinModeValue;

  // Temp (byte 26, bits 1–6)
  const temp = (raw[26]! >> 1) & 0x3f;

  // Fan (byte 28, bits 4–7)
  const fanInternal = (raw[28]! >> 4) & 0x0f;
  const fan: DaikinFanValue =
    fanInternal === DaikinFan.Auto || fanInternal === DaikinFan.Quiet
      ? fanInternal
      : (fanInternal - 2) as DaikinFanValue;

  // Power (byte 25, bit 0)
  const power = !!(raw[25]! & 0x01);

  // Quiet (byte 33, bit 5), Powerful (byte 33, bit 0)
  const quiet = !!(raw[33]! & (1 << 5));
  const powerful = !!(raw[33]! & (1 << 0));

  // Econo (byte 36, bit 2), Eye (byte 36, bit 1), Purify (byte 36, bit 4)
  const econo = !!(raw[36]! & (1 << 2));
  const eye = !!(raw[36]! & (1 << 1));
  const purify = !!(raw[36]! & (1 << 4));

  return {
    power,
    temp,
    mode,
    fan,
    swingVertical,
    swingHorizontal,
    quiet,
    powerful,
    econo,
    light,
    beep,
    clean,
    mold,
    freshAir,
    freshAirHigh,
    eye,
    eyeAuto,
    purify,
    currentTime,
  };
}
