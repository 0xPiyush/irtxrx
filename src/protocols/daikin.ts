/**
 * Daikin ESP / standard 280-bit (35-byte) IR protocol encoder.
 *
 * Header (5-bit) + 3 sections: bytes 0–7 (8) + bytes 8–15 (8) + bytes 16–34 (19).
 * Ported from IRremoteESP8266 `ir_Daikin.cpp`.
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
} from "./daikin_common.js";
import type { DaikinModeValue, DaikinFanValue } from "./daikin_common.js";

export { DaikinMode, DaikinFan } from "./daikin_common.js";

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

const HDR_MARK = 3650;
const HDR_SPACE = 1623;
const BIT_MARK = 428;
const ONE_SPACE = 1280;
const ZERO_SPACE = 428;
const GAP = 29000;
const FOOTER_GAP = ZERO_SPACE + GAP; // 29428
const STATE_LENGTH = 35;
const SECTION1_LEN = 8;
const SECTION2_LEN = 8;
const HEADER_BITS = 5;
const UNUSED_TIME = 0x600;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface DaikinESPState {
  power?: boolean;
  /** Temperature in °C (10–32). Supports 0.5°C increments. */
  temp?: number;
  mode?: DaikinModeValue;
  fan?: DaikinFanValue;
  swingVertical?: boolean;
  swingHorizontal?: boolean;
  quiet?: boolean;
  powerful?: boolean;
  econo?: boolean;
  mold?: boolean;
  comfort?: boolean;
  sensor?: boolean;
  /** Weekly timer enable. */
  weeklyTimer?: boolean;
  /** Current time in minutes past midnight (0–1439). */
  currentTime?: number;
  /** Current day of week (1=SUN..7=SAT). */
  currentDay?: number;
  /** On timer: minutes past midnight. Undefined = disabled. */
  onTime?: number;
  /** Off timer: minutes past midnight. Undefined = disabled. */
  offTime?: number;
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

/** Set a multi-byte little-endian bitfield spanning byte boundaries. */
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
  raw[0] = 0x11; raw[1] = 0xda; raw[2] = 0x27; raw[4] = 0xc5;
  raw[8] = 0x11; raw[9] = 0xda; raw[10] = 0x27; raw[12] = 0x42;
  raw[16] = 0x11; raw[17] = 0xda; raw[18] = 0x27;
  raw[21] = 0x49; // Power=1, OnTimer=0, OffTimer=0, :1=1, Mode=kDaikinHeat(0b100)
  raw[22] = 0x1e; // Temp = 15°C * 2 = 30 = 0x1E
  raw[24] = 0xb0; // SwingV=0, Fan=0xB
  raw[27] = 0x06;
  raw[28] = 0x60;
  raw[31] = 0xc0;
  return raw;
}

export function buildDaikinESPRaw(state: DaikinESPState): Uint8Array {
  const raw = defaultState();

  // --- Section 1 (bytes 0–7) ---
  // Comfort (byte 6, bit 4)
  setBit(raw, 6, 4, state.comfort ?? false);

  // --- Section 2 (bytes 8–15) ---
  // CurrentTime (bytes 13–14, bits 0–10 starting at byte 13 bit 0)
  if (state.currentTime !== undefined) {
    let mins = state.currentTime;
    if (mins > 24 * 60) mins = 0;
    setFieldLE(raw, 13, 0, 11, mins);
  }
  // CurrentDay (byte 14, bits 3–5)
  if (state.currentDay !== undefined) {
    setBitsRange(raw, 14, 3, 3, state.currentDay & 0x7);
  }

  // --- Section 3 (bytes 16–34) ---
  // Mode (byte 21, bits 4–6)
  let mode: number = state.mode ?? DaikinMode.Auto;
  if (!(mode === DaikinMode.Auto || mode === DaikinMode.Cool || mode === DaikinMode.Heat || mode === DaikinMode.Fan || mode === DaikinMode.Dry))
    mode = DaikinMode.Auto;
  setBitsRange(raw, 21, 4, 3, mode);

  // Power (byte 21, bit 0)
  setBit(raw, 21, 0, state.power ?? false);

  // Temp (byte 22) — stored as degrees * 2
  const temp = Math.min(Math.max(state.temp ?? 25, DAIKIN_MIN_TEMP), DAIKIN_MAX_TEMP);
  raw[22] = Math.round(temp * 2);

  // Fan (byte 24, bits 4–7)
  const fanInput = state.fan ?? DaikinFan.Auto;
  let fan: number;
  if (fanInput === DaikinFan.Quiet || fanInput === DaikinFan.Auto) fan = fanInput;
  else if (fanInput < 1 || fanInput > 5) fan = DaikinFan.Auto;
  else fan = fanInput + 2;
  setBitsRange(raw, 24, 4, 4, fan);

  // SwingV (byte 24, bits 0–3)
  setBitsRange(raw, 24, 0, 4, (state.swingVertical ?? false) ? DAIKIN_SWING_ON : DAIKIN_SWING_OFF);

  // SwingH (byte 25, bits 0–3)
  setBitsRange(raw, 25, 0, 4, (state.swingHorizontal ?? false) ? DAIKIN_SWING_ON : DAIKIN_SWING_OFF);

  // On/Off timers (bytes 26–28, 12 bits each)
  if (state.onTime !== undefined) {
    setBit(raw, 21, 1, true); // OnTimer enable
    setFieldLE(raw, 26, 0, 12, state.onTime);
  } else {
    setBit(raw, 21, 1, false);
    setFieldLE(raw, 26, 0, 12, UNUSED_TIME);
  }
  if (state.offTime !== undefined) {
    setBit(raw, 21, 2, true); // OffTimer enable
    setFieldLE(raw, 27, 4, 12, state.offTime);
  } else {
    setBit(raw, 21, 2, false);
    setFieldLE(raw, 27, 4, 12, UNUSED_TIME);
  }

  // Quiet/Powerful/Econo with mutual exclusions
  let quiet = state.quiet ?? false;
  let powerful = state.powerful ?? false;
  let econo = state.econo ?? false;
  if (quiet) powerful = false;
  if (powerful) { quiet = false; econo = false; }
  if (econo) powerful = false;

  setBit(raw, 29, 5, quiet);    // Byte 29, bit 5
  setBit(raw, 29, 0, powerful);  // Byte 29, bit 0
  setBit(raw, 32, 2, econo);    // Byte 32, bit 2

  // Other flags
  setBit(raw, 32, 1, state.sensor ?? false);
  setBit(raw, 32, 7, !(state.weeklyTimer ?? true)); // Inverted: bit=1 means disabled
  setBit(raw, 33, 1, state.mold ?? false);

  // The constant bit in byte 21 bit 3 should always be 1
  setBit(raw, 21, 3, true);

  // --- Checksums ---
  raw[7] = sumBytes(raw, 0, SECTION1_LEN - 1);
  raw[15] = sumBytes(raw, SECTION1_LEN, SECTION1_LEN + SECTION2_LEN - 1);
  raw[34] = sumBytes(raw, SECTION1_LEN + SECTION2_LEN, STATE_LENGTH - 1);

  return raw;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export function sendDaikinESP(state: DaikinESPState, repeat = 0): number[] {
  return encodeDaikinESPRaw(buildDaikinESPRaw(state), repeat);
}

export function encodeDaikinESPRaw(data: Uint8Array, repeat = 0): number[] {
  const result: number[] = [];
  const sectionOpts = {
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE,
    zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: FOOTER_GAP, msbFirst: false,
  };

  for (let r = 0; r <= repeat; r++) {
    // Header: 5 bits of zero (no header mark/space)
    const hdr = sendGeneric({
      headerMark: 0, headerSpace: 0,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE,
      zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: FOOTER_GAP,
      data: 0n, nbits: HEADER_BITS, msbFirst: false,
    });
    for (let i = 0; i < hdr.length; i++) result.push(hdr[i]!);

    // Section 1 (bytes 0–7)
    const s1 = sendGenericBytes({ ...sectionOpts, data: data.subarray(0, SECTION1_LEN) });
    for (let i = 0; i < s1.length; i++) result.push(s1[i]!);

    // Section 2 (bytes 8–15)
    const s2 = sendGenericBytes({ ...sectionOpts, data: data.subarray(SECTION1_LEN, SECTION1_LEN + SECTION2_LEN) });
    for (let i = 0; i < s2.length; i++) result.push(s2[i]!);

    // Section 3 (bytes 16–34)
    const s3 = sendGenericBytes({ ...sectionOpts, data: data.subarray(SECTION1_LEN + SECTION2_LEN) });
    for (let i = 0; i < s3.length; i++) result.push(s3[i]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Decode API
// ---------------------------------------------------------------------------

const SECTION3_LEN = STATE_LENGTH - SECTION1_LEN - SECTION2_LEN; // 19

/** Read a multi-byte little-endian bitfield (inverse of setFieldLE). */
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
 * Try to skip the 5-bit zero leader (no header mark/space).
 * Returns the new offset past the leader, or the original offset if no leader.
 */
function skipLeader(
  timings: number[],
  offset: number,
): number {
  const result = matchGeneric(
    timings, offset, timings.length - offset, HEADER_BITS,
    0, 0,                             // no header
    BIT_MARK, ONE_SPACE,              // oneMark, oneSpace
    BIT_MARK, ZERO_SPACE,             // zeroMark, zeroSpace
    BIT_MARK, FOOTER_GAP,             // footerMark, gap
    true,                             // atLeast for gap
  );
  return result ? offset + result.used : offset;
}

/**
 * Decode raw IR timings as a DaikinESP message.
 *
 * The 5-bit leader preamble is optional — hardware captures often miss it.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeDaikinESP(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): DaikinESPState | null {
  // Skip leader if present.
  let pos = skipLeader(timings, offset);

  // Section 1 (bytes 0–7): header + 8 bytes + footer.
  const s1 = matchGenericBytes(
    timings, pos, timings.length - pos, SECTION1_LEN,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, FOOTER_GAP,
    true, undefined, undefined, false, // atLeast, tol, excess, msbFirst=false
    headerOptional,
  );
  if (!s1) return null;
  pos += s1.used;

  // Section 2 (bytes 8–15): header + 8 bytes + footer.
  const s2 = matchGenericBytes(
    timings, pos, timings.length - pos, SECTION2_LEN,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, FOOTER_GAP,
    true, undefined, undefined, false,
  );
  if (!s2) return null;
  pos += s2.used;

  // Section 3 (bytes 16–34): header + 19 bytes + footer.
  const s3 = matchGenericBytes(
    timings, pos, timings.length - pos, SECTION3_LEN,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, FOOTER_GAP,
    true, undefined, undefined, false,
  );
  if (!s3) return null;

  // Concatenate sections into one 35-byte array.
  const raw = new Uint8Array(STATE_LENGTH);
  raw.set(s1.data, 0);
  raw.set(s2.data, SECTION1_LEN);
  raw.set(s3.data, SECTION1_LEN + SECTION2_LEN);

  // Validate checksums.
  if (raw[7] !== sumBytes(raw, 0, SECTION1_LEN - 1)) return null;
  if (raw[15] !== sumBytes(raw, SECTION1_LEN, SECTION1_LEN + SECTION2_LEN - 1)) return null;
  if (raw[34] !== sumBytes(raw, SECTION1_LEN + SECTION2_LEN, STATE_LENGTH - 1)) return null;

  // Extract state from byte/bit positions.

  // --- Section 1 fields ---
  const comfort = !!(raw[6]! & (1 << 4));

  // --- Section 2 fields ---
  // CurrentTime: 11-bit LE field at byte 13, bit 0
  const currentTime = getFieldLE(raw, 13, 0, 11);
  // CurrentDay: byte 14, bits 3–5
  const currentDay = (raw[14]! >> 3) & 0x07;

  // --- Section 3 fields ---
  // Mode (byte 21, bits 4–6)
  const mode = ((raw[21]! >> 4) & 0b111) as DaikinModeValue;

  // Power (byte 21, bit 0)
  const power = !!(raw[21]! & 0x01);

  // On/Off timer enables (byte 21, bits 1–2)
  const onTimerEnabled = !!(raw[21]! & (1 << 1));
  const offTimerEnabled = !!(raw[21]! & (1 << 2));

  // Temp (byte 22) — stored as degrees * 2
  const temp = raw[22]! / 2;

  // Fan (byte 24, bits 4–7)
  const fanInternal = (raw[24]! >> 4) & 0x0f;
  const fan: DaikinFanValue =
    fanInternal === DaikinFan.Auto || fanInternal === DaikinFan.Quiet
      ? fanInternal
      : (fanInternal - 2) as DaikinFanValue;

  // SwingV (byte 24, bits 0–3)
  const swingVertical = (raw[24]! & 0x0f) === DAIKIN_SWING_ON;

  // SwingH (byte 25, bits 0–3)
  const swingHorizontal = (raw[25]! & 0x0f) === DAIKIN_SWING_ON;

  // On timer: 12-bit LE field at byte 26, bit 0
  const onTimeRaw = getFieldLE(raw, 26, 0, 12);

  // Off timer: 12-bit LE field at byte 27, bit 4
  const offTimeRaw = getFieldLE(raw, 27, 4, 12);

  // Quiet (byte 29, bit 5)
  const quiet = !!(raw[29]! & (1 << 5));
  // Powerful (byte 29, bit 0)
  const powerful = !!(raw[29]! & (1 << 0));

  // Econo (byte 32, bit 2)
  const econo = !!(raw[32]! & (1 << 2));
  // Sensor (byte 32, bit 1)
  const sensor = !!(raw[32]! & (1 << 1));
  // WeeklyTimer (byte 32, bit 7) — inverted: bit=1 means disabled
  const weeklyTimer = !(raw[32]! & (1 << 7));

  // Mold (byte 33, bit 1)
  const mold = !!(raw[33]! & (1 << 1));

  const result: DaikinESPState = {
    power,
    temp,
    mode,
    fan,
    swingVertical,
    swingHorizontal,
    quiet,
    powerful,
    econo,
    mold,
    comfort,
    sensor,
    weeklyTimer,
    currentTime,
    currentDay,
  };
  if (onTimerEnabled) result.onTime = onTimeRaw;
  if (offTimerEnabled) result.offTime = offTimeRaw;

  return result;
}
