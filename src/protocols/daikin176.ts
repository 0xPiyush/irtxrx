/**
 * Daikin 176-bit (22-byte) IR protocol encoder.
 *
 * 2 sections: bytes 0–6 (7 bytes) + bytes 7–21 (15 bytes).
 * Uses different mode values from the shared Daikin constants.
 * Ported from IRremoteESP8266 `ir_Daikin.cpp`.
 */

import { sumBytes, sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";
import { DAIKIN_MIN_TEMP, DAIKIN_MAX_TEMP } from "./daikin_common.js";

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

const HDR_MARK = 5070;
const HDR_SPACE = 2140;
const BIT_MARK = 370;
const ONE_SPACE = 1780;
const ZERO_SPACE = 710;
const GAP = 29410;
const STATE_LENGTH = 22;
const SECTION1_LEN = 7;

// ---------------------------------------------------------------------------
// Daikin176-specific mode values (different from shared DaikinMode!)
// ---------------------------------------------------------------------------

export const Daikin176Mode = {
  Fan: 0b000,
  Heat: 0b001,
  Cool: 0b010,
  Auto: 0b011,
  Dry: 0b111,
} as const;

export type Daikin176ModeValue = (typeof Daikin176Mode)[keyof typeof Daikin176Mode];

const DRY_FAN_TEMP = 17;
const MODE_BUTTON = 0x04;
const FAN_MAX = 3;

export const Daikin176SwingH = {
  Off: 0x6,
  Auto: 0x5,
} as const;

export type Daikin176SwingHValue = (typeof Daikin176SwingH)[keyof typeof Daikin176SwingH];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Daikin176State {
  power?: boolean;
  temp?: number;
  mode?: Daikin176ModeValue;
  /** Fan speed: 1 (min) or 3 (max). Only two positions supported. */
  fan?: 1 | 3;
  swingHorizontal?: Daikin176SwingHValue;
  id?: 0 | 1;
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
  raw[0] = 0x11; raw[1] = 0xda; raw[2] = 0x17; raw[3] = 0x18; raw[4] = 0x04;
  raw[7] = 0x11; raw[8] = 0xda; raw[9] = 0x17; raw[10] = 0x18;
  raw[12] = 0x73;
  raw[14] = 0x20; // Power=0, Mode=Cool(0b010) at bits 4-6
  raw[18] = 0x16; // Fan and SwingH
  raw[20] = 0x20;
  return raw;
}

export function buildDaikin176Raw(state: Daikin176State): Uint8Array {
  const raw = defaultState();

  // Id (byte 3 bit 0 and byte 10 bit 0)
  const id = state.id ?? 0;
  setBit(raw, 3, 0, id === 1);
  setBit(raw, 10, 0, id === 1);

  // Mode (byte 14, bits 4–6) + AltMode (byte 12, bits 4–6)
  let mode: number = state.mode ?? Daikin176Mode.Cool;
  let altMode: number;
  switch (mode) {
    case Daikin176Mode.Dry: altMode = 2; break;
    case Daikin176Mode.Fan: altMode = 6; break;
    case Daikin176Mode.Auto:
    case Daikin176Mode.Cool:
    case Daikin176Mode.Heat: altMode = 7; break;
    default: mode = Daikin176Mode.Cool; altMode = 7;
  }
  setBitsRange(raw, 14, 4, 3, mode);
  setBitsRange(raw, 12, 4, 3, altMode);

  // Temp (byte 17, bits 1–6) — stored as (degrees - 9)
  // Dry/Fan modes force temp to 17
  let temp: number;
  if (state.temp !== undefined) {
    temp = Math.min(Math.max(state.temp, DAIKIN_MIN_TEMP), DAIKIN_MAX_TEMP);
  } else {
    temp = 25;
  }
  const storedTemp = (mode === Daikin176Mode.Dry || mode === Daikin176Mode.Fan)
    ? DRY_FAN_TEMP - 9
    : temp - 9;
  setBitsRange(raw, 17, 1, 6, storedTemp);

  // ModeButton (byte 13) — setMode sets it to MODE_BUTTON, setTemp clears it
  // Since setMode is called last logically, set it
  raw[13] = MODE_BUTTON;

  // Fan (byte 18, bits 4–7) — only 1 or FAN_MAX(3) supported
  const fanInput = state.fan ?? FAN_MAX;
  const fan = (fanInput === 1) ? 1 : FAN_MAX;
  setBitsRange(raw, 18, 4, 4, fan);
  // setFan clears ModeButton
  raw[13] = 0;

  // Power (byte 14, bit 0) — setPower clears ModeButton
  setBit(raw, 14, 0, state.power ?? false);
  raw[13] = 0;

  // SwingH (byte 18, bits 0–3)
  const swingH = state.swingHorizontal ?? Daikin176SwingH.Auto;
  setBitsRange(raw, 18, 0, 4, swingH === Daikin176SwingH.Off ? Daikin176SwingH.Off : Daikin176SwingH.Auto);

  // Checksums
  raw[6] = sumBytes(raw, 0, SECTION1_LEN - 1);
  raw[21] = sumBytes(raw, SECTION1_LEN, STATE_LENGTH - 1);

  return raw;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export function sendDaikin176(state: Daikin176State, repeat = 0): number[] {
  return encodeDaikin176Raw(buildDaikin176Raw(state), repeat);
}

export function encodeDaikin176Raw(data: Uint8Array, repeat = 0): number[] {
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
 * Decode raw IR timings as a Daikin176 message.
 *
 * The protocol has 2 sections (7 + 15 bytes), each with its own header,
 * data, footer, and checksum. No leader/preamble.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeDaikin176(
  timings: number[],
  offset: number = 0,
): Daikin176State | null {
  let pos = offset;

  // Section 1: 7 bytes (header + data + footer).
  const section1 = matchGenericBytes(
    timings, pos, timings.length - pos, SECTION1_LEN,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false, // atLeast, tol, excess, msbFirst=false
  );
  if (!section1) return null;
  pos += section1.used;

  // Section 2: 15 bytes (header + data + footer).
  const section2Len = STATE_LENGTH - SECTION1_LEN;
  const section2 = matchGenericBytes(
    timings, pos, timings.length - pos, section2Len,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false, // atLeast, tol, excess, msbFirst=false
  );
  if (!section2) return null;

  // Combine into full 22-byte array.
  const raw = new Uint8Array(STATE_LENGTH);
  raw.set(section1.data, 0);
  raw.set(section2.data, SECTION1_LEN);

  // Validate checksums.
  if (raw[6] !== sumBytes(raw, 0, SECTION1_LEN - 1)) return null;
  if (raw[21] !== sumBytes(raw, SECTION1_LEN, STATE_LENGTH - 1)) return null;

  // Extract state from byte/bit positions.
  const mode = ((raw[14]! >> 4) & 0b111) as Daikin176ModeValue;
  const storedTemp = (raw[17]! >> 1) & 0x3F;
  const temp = storedTemp + 9;
  const fan = ((raw[18]! >> 4) & 0x0F) as 1 | 3;
  const swingHRaw = raw[18]! & 0x0F;
  const swingHorizontal: Daikin176SwingHValue =
    swingHRaw === Daikin176SwingH.Auto ? Daikin176SwingH.Auto : Daikin176SwingH.Off;
  const id: 0 | 1 = (raw[3]! & 0x01) ? 1 : 0;

  return {
    power: !!(raw[14]! & 0x01),
    temp,
    mode,
    fan,
    swingHorizontal,
    id,
  };
}
