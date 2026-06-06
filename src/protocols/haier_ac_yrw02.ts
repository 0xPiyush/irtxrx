/**
 * Haier YR-W02 A/C IR protocol encoder and decoder. (HAIER_AC_YRW02)
 *
 * Ported from IRremoteESP8266 `ir_Haier.cpp` (the `IRHaierACYRW02` class).
 * A 14-byte message — the body shared with {@link buildHaierAc176Raw} but
 * without the second (`0xB7`) section — closed by a single byte-sum checksum.
 * Temperatures are modelled in Celsius (Fahrenheit is out of scope).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/485
 */

import { encodeHaier, decodeHaierBytes, haierSum } from "./haier_common.js";
import {
  HaierAcYrw02Mode, HaierAcYrw02Fan, HaierAc176SwingV, HaierAc176SwingH, HaierAc176Model,
  parseHaierAc176State,
} from "./haier_ac176.js";
import type { HaierAc176State } from "./haier_ac176.js";

const STATE_LENGTH = 14;
const TEMP_MIN = 16;
const TEMP_MAX = 30;
const MAX_TIME = 23 * 60 + 59;
const DEFAULT_BUTTON = 0b00101; // Power

// Re-export the shared enums under YRW02 names for a self-contained module.
export {
  HaierAcYrw02Mode, HaierAcYrw02Fan,
  HaierAc176SwingV as HaierAcYrw02SwingV,
  HaierAc176SwingH as HaierAcYrw02SwingH,
  HaierAc176Model as HaierAcYrw02ModelEnum,
} from "./haier_ac176.js";
export type { HaierAcYrw02ModeValue, HaierAcYrw02FanValue } from "./haier_ac176.js";

/** YR-W02 state — the same field set as AC176, minus the second section. */
export type HaierAcYrw02State = HaierAc176State;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ---------------------------------------------------------------------------
// Build raw 14-byte state
// ---------------------------------------------------------------------------

/** Build the raw 14-byte Haier YR-W02 state from a state object. */
export function buildHaierAcYrw02Raw(state: HaierAcYrw02State): Uint8Array {
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
  raw[12] = ((state.button ?? DEFAULT_BUTTON) & 0x1f) | ((state.lock ? 1 : 0) << 5);
  raw[13] = haierSum(raw, 0, STATE_LENGTH - 1);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw Haier 14-byte payload into IR timings. */
export function encodeHaierAcYrw02Raw(data: Uint8Array, repeat: number = 0): number[] {
  return encodeHaier(data, repeat);
}

/** Encode a Haier YR-W02 state into raw IR timings. */
export function sendHaierAcYrw02(state: HaierAcYrw02State, repeat: number = 0): number[] {
  return encodeHaier(buildHaierAcYrw02Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 14-byte Haier YR-W02 state into a state object. */
export function parseHaierAcYrw02State(raw: Uint8Array): HaierAcYrw02State {
  return parseHaierAc176State(raw);
}

/**
 * Decode raw IR timings as a Haier YR-W02 (14-byte) message.
 *
 * Validates the byte-sum checksum.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeHaierAcYrw02(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): HaierAcYrw02State | null {
  const raw = decodeHaierBytes(timings, offset, STATE_LENGTH, headerOptional);
  if (!raw) return null;
  // Model byte gates against false matches (0xA6 = "A", 0x59 = "B").
  if (raw[0] !== HaierAc176Model.V9014557A && raw[0] !== HaierAc176Model.V9014557B) return null;
  if (raw[13] !== haierSum(raw, 0, STATE_LENGTH - 1)) return null;
  return parseHaierAcYrw02State(raw);
}
