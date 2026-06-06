/**
 * Haier 160-bit A/C IR protocol encoder and decoder. (HAIER_AC160)
 *
 * Ported from IRremoteESP8266 `ir_Haier.cpp` (the `IRHaierAC160` class).
 * A 20-byte message in two checksummed sections (bytes 0–13 and 14–19). Shares
 * the YRW02 mode/fan vocabulary but has its own vertical-swing positions plus
 * Clean, Aux-Heating and a button-driven Light toggle. The second section
 * carries the `0xB5` prefix, a Clean mirror, and a 3-bit fan mirror.
 * Temperatures are modelled in Celsius (Fahrenheit is out of scope).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1804
 */

import { encodeHaier, decodeHaierBytes, haierSum } from "./haier_common.js";
import { HaierAcYrw02Mode, HaierAcYrw02Fan } from "./haier_ac176.js";

const STATE_LENGTH = 20;
const SECTION1_LENGTH = 14;
const PREFIX = 0xb5;
const MODEL = 0xa6;
const TEMP_MIN = 16;
const TEMP_MAX = 30;
const MAX_TIME = 23 * 60 + 59;
const DEFAULT_BUTTON = 0b00101; // Power
const BUTTON_LIGHT = 0b10101;

export { HaierAcYrw02Mode, HaierAcYrw02Fan } from "./haier_ac176.js";
export type { HaierAcYrw02ModeValue, HaierAcYrw02FanValue } from "./haier_ac176.js";

export const HaierAc160SwingV = {
  Off: 0b0000,
  Top: 0b0001,
  Highest: 0b0010,
  High: 0b0100,
  Middle: 0b0110,
  Low: 0b1000,
  Lowest: 0b0011,
  Auto: 0b1100,
} as const;
export type HaierAc160SwingVValue = (typeof HaierAc160SwingV)[keyof typeof HaierAc160SwingV];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface HaierAc160State {
  power?: boolean;
  /** Temperature in °C (16–30). */
  temp?: number;
  mode?: import("./haier_ac176.js").HaierAcYrw02ModeValue;
  fan?: import("./haier_ac176.js").HaierAcYrw02FanValue;
  swingV?: HaierAc160SwingVValue;
  health?: boolean;
  sleep?: boolean;
  turbo?: boolean;
  quiet?: boolean;
  clean?: boolean;
  auxHeating?: boolean;
  lock?: boolean;
  /** Button/command code (defaults to Power; the Light toggle is button-driven). */
  button?: number;
  timerMode?: number;
  onTimer?: number;
  offTimer?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ---------------------------------------------------------------------------
// Build raw 20-byte state
// ---------------------------------------------------------------------------

/** Build the raw 20-byte Haier AC160 state from a state object. */
export function buildHaierAc160Raw(state: HaierAc160State): Uint8Array {
  const raw = new Uint8Array(STATE_LENGTH);
  const fan = state.fan ?? HaierAcYrw02Fan.Auto;
  const clean = state.clean ?? false;
  const onMins = clamp(state.onTimer ?? 0, 0, MAX_TIME);
  const offMins = clamp(state.offTimer ?? 0, 0, MAX_TIME);

  raw[0] = MODEL;
  raw[1] = ((state.swingV ?? HaierAc160SwingV.Off) & 0x0f) |
    (((clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_MIN) & 0x0f) << 4);
  raw[3] = ((state.health ? 1 : 0) << 1) | (((state.timerMode ?? 0) & 0x07) << 5);
  raw[4] = ((state.power ? 1 : 0) << 6) | ((state.auxHeating ? 1 : 0) << 7);
  raw[5] = (Math.trunc(offMins / 60) & 0x1f) | ((fan & 0x07) << 5);
  raw[6] = ((offMins % 60) & 0x3f) | ((state.turbo ? 1 : 0) << 6) | ((state.quiet ? 1 : 0) << 7);
  raw[7] = (Math.trunc(onMins / 60) & 0x1f) | (((state.mode ?? HaierAcYrw02Mode.Auto) & 0x07) << 5);
  raw[8] = ((onMins % 60) & 0x3f) | ((state.sleep ? 1 : 0) << 7);
  raw[10] = (clean ? 1 : 0) << 4;
  raw[12] = ((state.button ?? DEFAULT_BUTTON) & 0x1f) | ((state.lock ? 1 : 0) << 5);
  raw[13] = haierSum(raw, 0, SECTION1_LENGTH - 1);
  raw[14] = PREFIX;
  raw[15] = (clean ? 1 : 0) << 6; // Clean2 mirror
  raw[16] = ((fan === HaierAcYrw02Fan.Auto ? 0 : fan) & 0x07) << 5; // Fan2 mirror (3 bits)
  raw[19] = haierSum(raw, SECTION1_LENGTH, STATE_LENGTH - SECTION1_LENGTH - 1);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw Haier 20-byte payload into IR timings. */
export function encodeHaierAc160Raw(data: Uint8Array, repeat: number = 0): number[] {
  return encodeHaier(data, repeat);
}

/** Encode a Haier AC160 state into raw IR timings. */
export function sendHaierAc160(state: HaierAc160State, repeat: number = 0): number[] {
  return encodeHaier(buildHaierAc160Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 20-byte Haier AC160 state into a state object. */
export function parseHaierAc160State(raw: Uint8Array): HaierAc160State {
  const button = raw[12]! & 0x1f;
  return {
    power: !!((raw[4]! >> 6) & 1),
    temp: ((raw[1]! >> 4) & 0x0f) + TEMP_MIN,
    mode: ((raw[7]! >> 5) & 0x07) as import("./haier_ac176.js").HaierAcYrw02ModeValue,
    fan: ((raw[5]! >> 5) & 0x07) as import("./haier_ac176.js").HaierAcYrw02FanValue,
    swingV: (raw[1]! & 0x0f) as HaierAc160SwingVValue,
    health: !!((raw[3]! >> 1) & 1),
    sleep: !!((raw[8]! >> 7) & 1),
    turbo: !!((raw[6]! >> 6) & 1),
    quiet: !!((raw[6]! >> 7) & 1),
    clean: !!((raw[10]! >> 4) & 1) && !!((raw[15]! >> 6) & 1),
    auxHeating: !!((raw[4]! >> 7) & 1),
    lock: !!((raw[12]! >> 5) & 1),
    button,
    timerMode: (raw[3]! >> 5) & 0x07,
    onTimer: (raw[7]! & 0x1f) * 60 + (raw[8]! & 0x3f),
    offTimer: (raw[5]! & 0x1f) * 60 + (raw[6]! & 0x3f),
  };
}

/** True if the message represents a Light toggle (button-driven). */
export function haierAc160LightToggle(state: HaierAc160State): boolean {
  return (state.button ?? DEFAULT_BUTTON) === BUTTON_LIGHT;
}

/**
 * Decode raw IR timings as a Haier AC160 (20-byte) message.
 *
 * Validates both section byte-sum checksums.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeHaierAc160(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): HaierAc160State | null {
  const raw = decodeHaierBytes(timings, offset, STATE_LENGTH, headerOptional);
  if (!raw) return null;
  if (raw[14] !== PREFIX) return null; // 0xB5 second-section prefix
  if (raw[13] !== haierSum(raw, 0, SECTION1_LENGTH - 1)) return null;
  if (raw[19] !== haierSum(raw, SECTION1_LENGTH, STATE_LENGTH - SECTION1_LENGTH - 1)) return null;
  return parseHaierAc160State(raw);
}
