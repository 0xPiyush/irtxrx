/**
 * Kelon A/C IR protocol encoder and decoder (the 48-bit variant).
 *
 * Ported from IRremoteESP8266 `ir_Kelon.cpp` / `ir_Kelon.h`.
 *
 * Wire format: a 48-bit value sent LSB-first with a header and a trailing gap
 * (no checksum). The first two bytes are a fixed preamble (0x83, 0x06) which we
 * validate on decode as an integrity marker. Many fields are toggles (the unit
 * has no absolute power/swing state), matching the real remote.
 *
 * Fan note: Kelon's wire fan speeds run backwards (0:Auto, 1:Max … 3:Min). As
 * the C++ library does, the public API exposes the sane order (0:Auto, 1:Min,
 * 2:Med, 3:Max) and converts internally.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Kelon.cpp
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Kelon.cpp exactly
// ---------------------------------------------------------------------------

const KELON_HDR_MARK = 9000;
const KELON_HDR_SPACE = 4600;
const KELON_BIT_MARK = 560;
const KELON_ONE_SPACE = 1680;
const KELON_ZERO_SPACE = 600;
const KELON_GAP = 2 * 100000; // 2 * kDefaultMessageGap
const KELON_TOLERANCE = 25;

export const KELON_BITS = 48;

const KELON_PREAMBLE0 = 0x83;
const KELON_PREAMBLE1 = 0x06;

const KELON_TEMP_MIN = 18;
const KELON_TEMP_MAX = 32;
const KELON_TIMER_MAX = 24 * 60;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const KelonMode = {
  Heat: 0,
  Smart: 1,
  Cool: 2,
  Dry: 3,
  Fan: 4,
} as const;
export type KelonModeValue = (typeof KelonMode)[keyof typeof KelonMode];

/** Public (sane-order) fan speeds; converted to the backwards wire order. */
export const KelonFan = {
  Auto: 0,
  Min: 1,
  Med: 2,
  Max: 3,
} as const;
export type KelonFanValue = (typeof KelonFan)[keyof typeof KelonFan];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface KelonState {
  /** Toggle the power state (the unit has no absolute on/off). */
  powerToggle?: boolean;
  /** Fan speed in the sane order (see {@link KelonFan}). */
  fan?: number;
  sleep?: boolean;
  /** Dehumidifier grade, −2…+2 (Dry mode). */
  dryGrade?: number;
  /** Toggle the vertical swing. */
  swingVToggle?: boolean;
  mode?: number;
  /** Temperature in °C (18–32). */
  temp?: number;
  timerEnabled?: boolean;
  /** Timer in minutes (0–1440). */
  timerMinutes?: number;
  smartMode?: boolean;
  superCool?: boolean;
}

// ---------------------------------------------------------------------------
// Fan / dry-grade / timer helpers (mirror the C++ class)
// ---------------------------------------------------------------------------

/** Convert between the sane API order and the backwards wire order (involution). */
function flipFan(v: number): number {
  return (((v - 4) * -1) % 4 + 4) % 4;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function encodeDryGrade(grade: number): number {
  const g = clamp(grade, -2, 2);
  return g < 0 ? 0b100 | (-g & 0b011) : g & 0b011;
}

function decodeDryGrade(v: number): number {
  return (v & 0b011) * (v & 0b100 ? -1 : 1);
}

// ---------------------------------------------------------------------------
// Build raw 48-bit value from state
// ---------------------------------------------------------------------------

/** Build the raw 48-bit Kelon value (as 6 little-endian bytes) from a state. */
export function buildKelonBytes(state: KelonState): Uint8Array {
  const b = new Uint8Array(6);
  b[0] = KELON_PREAMBLE0;
  b[1] = KELON_PREAMBLE1;

  const fan = flipFan(clamp(state.fan ?? KelonFan.Auto, 0, KelonFan.Max));
  const tempC = clamp(state.temp ?? KELON_TEMP_MIN, KELON_TEMP_MIN, KELON_TEMP_MAX);
  const tempField = tempC - KELON_TEMP_MIN;

  // Timer encoding (mirrors setTimer).
  const timer = clamp(state.timerMinutes ?? 0, 0, KELON_TIMER_MAX);
  let timerHalfHour: number;
  let timerHours: number;
  if (timer / 60 >= 10) {
    const hours = Math.floor(timer / 60) + 10;
    timerHalfHour = hours & 1;
    timerHours = hours >> 1;
  } else {
    timerHalfHour = timer % 60 >= 30 ? 1 : 0;
    timerHours = Math.floor(timer / 60);
  }

  // Byte 2: Fan(0-1), PowerToggle(2), Sleep(3), DryGrade(4-6), SwingVToggle(7)
  b[2] =
    (fan & 0x3) |
    ((state.powerToggle ? 1 : 0) << 2) |
    ((state.sleep ? 1 : 0) << 3) |
    ((encodeDryGrade(state.dryGrade ?? 0) & 0x7) << 4) |
    ((state.swingVToggle ? 1 : 0) << 7);
  // Byte 3: Mode(0-2), TimerEnabled(3), Temp(4-7)
  b[3] =
    ((state.mode ?? KelonMode.Heat) & 0x7) |
    ((state.timerEnabled ? 1 : 0) << 3) |
    ((tempField & 0xf) << 4);
  // Byte 4: TimerHalfHour(0), TimerHours(1-6), SmartMode(7)
  b[4] =
    (timerHalfHour & 0x1) |
    ((timerHours & 0x3f) << 1) |
    ((state.smartMode ? 1 : 0) << 7);
  // Byte 5: pad(0-3), SuperCool1(4), pad(5-6), SuperCool2(7)
  b[5] = ((state.superCool ? 1 : 0) << 4) | ((state.superCool ? 1 : 0) << 7);

  return b;
}

function bytesToValue(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!);
  return v;
}

function valueToBytes(v: bigint): Uint8Array {
  const b = new Uint8Array(6);
  for (let i = 0; i < 6; i++) b[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return b;
}

/** Build the raw 48-bit Kelon value (as a bigint) from a state. */
export function buildKelonRaw(state: KelonState): bigint {
  return bytesToValue(buildKelonBytes(state));
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw 48-bit Kelon value into IR timings. */
export function encodeKelonRaw(value: bigint, repeat: number = 0): number[] {
  return sendGeneric({
    headerMark: KELON_HDR_MARK,
    headerSpace: KELON_HDR_SPACE,
    oneMark: KELON_BIT_MARK,
    oneSpace: KELON_ONE_SPACE,
    zeroMark: KELON_BIT_MARK,
    zeroSpace: KELON_ZERO_SPACE,
    footerMark: KELON_BIT_MARK,
    gap: KELON_GAP,
    data: value & ((1n << 48n) - 1n),
    nbits: KELON_BITS,
    msbFirst: false,
    repeat,
  });
}

/** Encode a Kelon A/C state into raw IR timings. */
export function sendKelon(state: KelonState, repeat: number = 0): number[] {
  return encodeKelonRaw(buildKelonRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a raw 48-bit Kelon value (6 little-endian bytes) into a state. */
export function parseKelonState(b: Uint8Array): KelonState | null {
  if (b[0] !== KELON_PREAMBLE0 || b[1] !== KELON_PREAMBLE1) return null;

  const b2 = b[2]!, b3 = b[3]!, b4 = b[4]!, b5 = b[5]!;

  const timerHalfHour = b4 & 0x1;
  const timerHours = (b4 >> 1) & 0x3f;
  const timerMinutes =
    timerHours >= 10
      ? (((timerHours << 1) | timerHalfHour) - 10) * 60
      : timerHours * 60 + (timerHalfHour ? 30 : 0);

  return {
    fan: flipFan(b2 & 0x3),
    powerToggle: !!((b2 >> 2) & 1),
    sleep: !!((b2 >> 3) & 1),
    dryGrade: decodeDryGrade((b2 >> 4) & 0x7),
    swingVToggle: !!((b2 >> 7) & 1),
    mode: b3 & 0x7,
    timerEnabled: !!((b3 >> 3) & 1),
    temp: ((b3 >> 4) & 0xf) + KELON_TEMP_MIN,
    timerMinutes,
    smartMode: !!((b4 >> 7) & 1),
    superCool: !!((b5 >> 4) & 1),
  };
}

/**
 * Decode raw IR timings as a Kelon A/C state.
 *
 * @param timings        Raw mark/space timing array in microseconds.
 * @param offset         Starting index in the timings array (default 0).
 * @param headerOptional Allow a missing header (default false).
 * @returns Decoded state, or null on mismatch / bad preamble.
 */
export function decodeKelon(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): KelonState | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, KELON_BITS,
    KELON_HDR_MARK, KELON_HDR_SPACE,
    KELON_BIT_MARK, KELON_ONE_SPACE,
    KELON_BIT_MARK, KELON_ZERO_SPACE,
    KELON_BIT_MARK, KELON_GAP,
    true, KELON_TOLERANCE, 0, false, headerOptional,
  );
  if (!result) return null;
  return parseKelonState(valueToBytes(result.data & ((1n << 48n) - 1n)));
}
