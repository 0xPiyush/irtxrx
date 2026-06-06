/**
 * Haier 176-bit A/C IR protocol encoder and decoder. (HAIER_AC176)
 *
 * Ported from IRremoteESP8266 `ir_Haier.cpp` (the `IRHaierAC176` class).
 * A 22-byte message in two checksummed sections (bytes 0–13 and 14–21). The
 * first section is the YRW02-compatible body; the second carries the `0xB7`
 * prefix and a mirror of the fan speed. Temperatures are modelled in Celsius
 * (the protocol's Fahrenheit encoding is out of scope).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1804
 */

import { encodeHaier, decodeHaierBytes, haierSum } from "./haier_common.js";

const STATE_LENGTH = 22;
const SECTION1_LENGTH = 14;
const PREFIX2 = 0xb7;
const TEMP_MIN = 16;
const TEMP_MAX = 30;
const MAX_TIME = 23 * 60 + 59;
const DEFAULT_BUTTON = 0b00101; // Power

// ---------------------------------------------------------------------------
// Enumerations (shared with HAIER_AC_YRW02)
// ---------------------------------------------------------------------------

export const HaierAcYrw02Mode = {
  Auto: 0b000,
  Cool: 0b001,
  Dry: 0b010,
  Heat: 0b100,
  Fan: 0b110,
} as const;
export type HaierAcYrw02ModeValue = (typeof HaierAcYrw02Mode)[keyof typeof HaierAcYrw02Mode];

export const HaierAcYrw02Fan = {
  High: 0b001,
  Med: 0b010,
  Low: 0b011,
  Auto: 0b101,
} as const;
export type HaierAcYrw02FanValue = (typeof HaierAcYrw02Fan)[keyof typeof HaierAcYrw02Fan];

export const HaierAc176SwingV = {
  Off: 0x0,
  Top: 0x1,
  Middle: 0x2,
  Bottom: 0x3,
  Down: 0xa,
  Auto: 0xc,
} as const;
export type HaierAc176SwingVValue = (typeof HaierAc176SwingV)[keyof typeof HaierAc176SwingV];

export const HaierAc176SwingH = {
  Middle: 0x0,
  LeftMax: 0x3,
  Left: 0x4,
  Right: 0x5,
  RightMax: 0x6,
  Auto: 0x7,
} as const;
export type HaierAc176SwingHValue = (typeof HaierAc176SwingH)[keyof typeof HaierAc176SwingH];

export const HaierAc176Model = {
  V9014557A: 0xa6,
  V9014557B: 0x59,
} as const;
export type HaierAc176ModelValue = (typeof HaierAc176Model)[keyof typeof HaierAc176Model];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface HaierAc176State {
  /** Model byte (0xA6 = "A" setting, 0x59 = "B" setting). */
  model?: HaierAc176ModelValue;
  power?: boolean;
  /** Temperature in °C (16–30). */
  temp?: number;
  mode?: HaierAcYrw02ModeValue;
  fan?: HaierAcYrw02FanValue;
  swingV?: HaierAc176SwingVValue;
  swingH?: HaierAc176SwingHValue;
  health?: boolean;
  sleep?: boolean;
  turbo?: boolean;
  quiet?: boolean;
  lock?: boolean;
  /** Button/command code (defaults to Power). */
  button?: number;
  /** Timer mode (0 = none). */
  timerMode?: number;
  /** On-timer in minutes (0 = unset). */
  onTimer?: number;
  /** Off-timer in minutes (0 = unset). */
  offTimer?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ---------------------------------------------------------------------------
// Build raw 22-byte state
// ---------------------------------------------------------------------------

/** Build the raw 22-byte Haier AC176 state from a state object. */
export function buildHaierAc176Raw(state: HaierAc176State): Uint8Array {
  const raw = new Uint8Array(STATE_LENGTH);
  const fan = state.fan ?? HaierAcYrw02Fan.Auto;
  const onMins = clamp(state.onTimer ?? 0, 0, MAX_TIME);
  const offMins = clamp(state.offTimer ?? 0, 0, MAX_TIME);

  raw[0] = state.model ?? HaierAc176Model.V9014557A;
  raw[1] = ((state.swingV ?? HaierAc176SwingV.Off) & 0x0f) |
    (((clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_MIN) & 0x0f) << 4);
  raw[2] = ((state.swingH ?? HaierAc176SwingH.Middle) & 0x07) << 5;
  raw[3] = ((state.health ? 1 : 0) << 1) | (((state.timerMode ?? 0) & 0x07) << 5);
  raw[4] = (state.power ? 1 : 0) << 6;
  raw[5] = (Math.trunc(offMins / 60) & 0x1f) | ((fan & 0x07) << 5);
  raw[6] = ((offMins % 60) & 0x3f) | ((state.turbo ? 1 : 0) << 6) | ((state.quiet ? 1 : 0) << 7);
  raw[7] = (Math.trunc(onMins / 60) & 0x1f) | (((state.mode ?? HaierAcYrw02Mode.Auto) & 0x07) << 5);
  raw[8] = ((onMins % 60) & 0x3f) | ((state.sleep ? 1 : 0) << 7);
  raw[10] = 0; // ExtraDegreeF + UseFahrenheit (Celsius only)
  raw[12] = ((state.button ?? DEFAULT_BUTTON) & 0x1f) | ((state.lock ? 1 : 0) << 5);
  raw[13] = haierSum(raw, 0, SECTION1_LENGTH - 1);
  raw[14] = PREFIX2;
  raw[16] = ((fan === HaierAcYrw02Fan.Auto ? 0 : fan) & 0x03) << 6; // Fan2 mirror
  raw[21] = haierSum(raw, SECTION1_LENGTH, STATE_LENGTH - SECTION1_LENGTH - 1);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw Haier 22-byte payload into IR timings. */
export function encodeHaierAc176Raw(data: Uint8Array, repeat: number = 0): number[] {
  return encodeHaier(data, repeat);
}

/** Encode a Haier AC176 state into raw IR timings. */
export function sendHaierAc176(state: HaierAc176State, repeat: number = 0): number[] {
  return encodeHaier(buildHaierAc176Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 22-byte (or 14-byte YRW02) Haier state into a state object. */
export function parseHaierAc176State(raw: Uint8Array): HaierAc176State {
  return {
    model: raw[0] as HaierAc176ModelValue,
    power: !!((raw[4]! >> 6) & 1),
    temp: ((raw[1]! >> 4) & 0x0f) + TEMP_MIN,
    mode: ((raw[7]! >> 5) & 0x07) as HaierAcYrw02ModeValue,
    fan: ((raw[5]! >> 5) & 0x07) as HaierAcYrw02FanValue,
    swingV: (raw[1]! & 0x0f) as HaierAc176SwingVValue,
    swingH: ((raw[2]! >> 5) & 0x07) as HaierAc176SwingHValue,
    health: !!((raw[3]! >> 1) & 1),
    sleep: !!((raw[8]! >> 7) & 1),
    turbo: !!((raw[6]! >> 6) & 1),
    quiet: !!((raw[6]! >> 7) & 1),
    lock: !!((raw[12]! >> 5) & 1),
    button: raw[12]! & 0x1f,
    timerMode: (raw[3]! >> 5) & 0x07,
    onTimer: (raw[7]! & 0x1f) * 60 + (raw[8]! & 0x3f),
    offTimer: (raw[5]! & 0x1f) * 60 + (raw[6]! & 0x3f),
  };
}

/**
 * Decode raw IR timings as a Haier AC176 (22-byte) message.
 *
 * Validates both section byte-sum checksums.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeHaierAc176(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): HaierAc176State | null {
  const raw = decodeHaierBytes(timings, offset, STATE_LENGTH, headerOptional);
  if (!raw) return null;
  if (raw[14] !== PREFIX2) return null; // 0xB7 second-section prefix
  if (raw[13] !== haierSum(raw, 0, SECTION1_LENGTH - 1)) return null;
  if (raw[21] !== haierSum(raw, SECTION1_LENGTH, STATE_LENGTH - SECTION1_LENGTH - 1)) return null;
  return parseHaierAc176State(raw);
}
