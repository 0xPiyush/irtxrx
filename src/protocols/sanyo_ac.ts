/**
 * Sanyo A/C IR protocol encoder and decoder. (SANYO_AC)
 *
 * Ported from IRremoteESP8266 `ir_Sanyo.cpp` (the `IRSanyoAc` class).
 * A 9-byte LSB-first message with a nibble-sum checksum in the final byte and a
 * fixed `0x6A` lead byte.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1211
 */

import { sendGenericBytes, sumNibbles } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Sanyo.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 8500;
const HDR_SPACE = 4200;
const BIT_MARK = 500;
const ONE_SPACE = 1600;
const ZERO_SPACE = 550;
const GAP = 100000; // kDefaultMessageGap

const STATE_LENGTH = 9;
const TEMP_MIN = 16;
const TEMP_MAX = 30;
const TEMP_DELTA = 4;
const HOUR_MAX = 15;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const SanyoAcMode = {
  Heat: 1,
  Cool: 2,
  Dry: 3,
  Auto: 4,
} as const;
export type SanyoAcModeValue = (typeof SanyoAcMode)[keyof typeof SanyoAcMode];

export const SanyoAcFan = {
  Auto: 0,
  High: 1,
  Low: 2,
  Medium: 3,
} as const;
export type SanyoAcFanValue = (typeof SanyoAcFan)[keyof typeof SanyoAcFan];

export const SanyoAcSwingV = {
  Auto: 0,
  Lowest: 2,
  Low: 3,
  LowerMiddle: 4,
  UpperMiddle: 5,
  High: 6,
  Highest: 7,
} as const;
export type SanyoAcSwingVValue = (typeof SanyoAcSwingV)[keyof typeof SanyoAcSwingV];

const POWER_OFF = 0b01;
const POWER_ON = 0b10;

/** Reset state from `IRSanyoAc::stateReset`. */
const TEMPLATE: readonly number[] = [
  0x6a, 0x6d, 0x51, 0x00, 0x10, 0x45, 0x00, 0x00, 0x33,
];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface SanyoAcState {
  power?: boolean;
  /** Temperature in °C (16–30). */
  temp?: number;
  mode?: SanyoAcModeValue;
  fan?: SanyoAcFanValue;
  swingV?: SanyoAcSwingVValue;
  sleep?: boolean;
  beep?: boolean;
  /** Temperature sensor location: false = remote, true = A/C unit. */
  sensor?: boolean;
  /** Sensed temperature in °C (16–30). */
  sensorTemp?: number;
  /** Off-timer in minutes (1-hour resolution, 0 = off). */
  offTimer?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function setBits(raw: Uint8Array, idx: number, off: number, size: number, val: number): void {
  const mask = ((1 << size) - 1) << off;
  raw[idx] = (raw[idx]! & ~mask) | ((val << off) & mask);
}

// ---------------------------------------------------------------------------
// Build raw 9-byte state
// ---------------------------------------------------------------------------

/** Build the raw 9-byte Sanyo A/C state from a state object. */
export function buildSanyoAcRaw(state: SanyoAcState): Uint8Array {
  const raw = Uint8Array.from(TEMPLATE);
  setBits(raw, 1, 0, 5, clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_DELTA);
  setBits(raw, 2, 0, 5, clamp(state.sensorTemp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_DELTA);
  setBits(raw, 2, 5, 1, state.sensor ? 1 : 0);
  setBits(raw, 2, 6, 1, state.beep ?? true ? 1 : 0);

  const offMins = clamp(state.offTimer ?? 0, 0, HOUR_MAX * 60);
  const offHours = Math.trunc(offMins / 60);
  setBits(raw, 3, 0, 4, offHours);
  setBits(raw, 4, 0, 2, state.fan ?? SanyoAcFan.Auto);
  setBits(raw, 4, 2, 1, offHours > 0 ? 1 : 0); // OffTimer
  setBits(raw, 4, 4, 3, state.mode ?? SanyoAcMode.Auto);
  setBits(raw, 5, 0, 3, state.swingV ?? SanyoAcSwingV.Auto);
  setBits(raw, 5, 6, 2, (state.power ?? false) ? POWER_ON : POWER_OFF);
  setBits(raw, 6, 3, 1, state.sleep ? 1 : 0);

  raw[STATE_LENGTH - 1] = sumNibbles(raw, 0, STATE_LENGTH - 1);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw Sanyo A/C payload into IR timings (LSB-first). */
export function encodeSanyoAcRaw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP,
    data, msbFirst: false, repeat,
  });
}

/** Encode a Sanyo A/C state into raw IR timings. */
export function sendSanyoAc(state: SanyoAcState, repeat: number = 0): number[] {
  return encodeSanyoAcRaw(buildSanyoAcRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Verify the Sanyo A/C nibble-sum checksum. */
export function sanyoAcValidChecksum(raw: Uint8Array): boolean {
  return raw[STATE_LENGTH - 1] === sumNibbles(raw, 0, STATE_LENGTH - 1);
}

/** Parse a validated 9-byte Sanyo A/C state into a state object. */
export function parseSanyoAcState(raw: Uint8Array): SanyoAcState {
  const offHours = raw[3]! & 0x0f;
  return {
    power: ((raw[5]! >> 6) & 0x03) === POWER_ON,
    temp: (raw[1]! & 0x1f) + TEMP_DELTA,
    mode: ((raw[4]! >> 4) & 0x07) as SanyoAcModeValue,
    fan: (raw[4]! & 0x03) as SanyoAcFanValue,
    swingV: (raw[5]! & 0x07) as SanyoAcSwingVValue,
    sleep: !!((raw[6]! >> 3) & 1),
    beep: !!((raw[2]! >> 6) & 1),
    sensor: !!((raw[2]! >> 5) & 1),
    sensorTemp: (raw[2]! & 0x1f) + TEMP_DELTA,
    offTimer: ((raw[4]! >> 2) & 1) ? offHours * 60 : 0,
  };
}

/**
 * Decode raw IR timings as a Sanyo A/C (9-byte) message.
 *
 * Validates the fixed `0x6A` lead byte and the nibble-sum checksum.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeSanyoAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): SanyoAcState | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false, headerOptional,
  );
  if (!frame) return null;
  if (frame.data[0] !== 0x6a) return null;
  if (!sanyoAcValidChecksum(frame.data)) return null;
  return parseSanyoAcState(frame.data);
}
