/**
 * Mitsubishi Heavy Industries 88-bit A/C protocol. (MITSUBISHI_HEAVY_88)
 *
 * Ported from IRremoteESP8266 `ir_MitsubishiHeavy.cpp` (`IRMitsubishiHeavy88Ac`).
 * An 11-byte message: a 5-byte ZJS signature followed by data bytes interleaved
 * with their bit-complements. The vertical and horizontal swing values are each
 * split across two bit-fields.
 * Models: RKX502A001C remote, SRKxxZJ-S A/C.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/660
 */

import { encodeMitsubishiHeavy, decodeMitsubishiHeavyBytes, applyInvertedPairs, checkInvertedPairs, MH_CHECKSUM_OFFSET } from "./mitsubishi_heavy_common.js";

const STATE_LENGTH = 11;
const TEMP_MIN = 17;
const TEMP_MAX = 31;
/** ZJS signature (bytes 0–4). */
const SIG = [0xad, 0x51, 0x3c, 0xd9, 0x26] as const;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const MitsubishiHeavy88Mode = {
  Auto: 0,
  Cool: 1,
  Dry: 2,
  Fan: 3,
  Heat: 4,
} as const;
export type MitsubishiHeavy88ModeValue = (typeof MitsubishiHeavy88Mode)[keyof typeof MitsubishiHeavy88Mode];

export const MitsubishiHeavy88Fan = {
  Auto: 0,
  Low: 2,
  Med: 3,
  High: 4,
  Turbo: 6,
  Econo: 7,
} as const;
export type MitsubishiHeavy88FanValue = (typeof MitsubishiHeavy88Fan)[keyof typeof MitsubishiHeavy88Fan];

export const MitsubishiHeavy88SwingV = {
  Off: 0b000,
  Auto: 0b100,
  Highest: 0b110,
  High: 0b001,
  Middle: 0b011,
  Low: 0b101,
  Lowest: 0b111,
} as const;
export type MitsubishiHeavy88SwingVValue = (typeof MitsubishiHeavy88SwingV)[keyof typeof MitsubishiHeavy88SwingV];

export const MitsubishiHeavy88SwingH = {
  Off: 0b0000,
  Auto: 0b1000,
  LeftMax: 0b0001,
  Left: 0b0101,
  Middle: 0b1001,
  Right: 0b1101,
  RightMax: 0b0010,
  RightLeft: 0b1010,
  LeftRight: 0b0110,
  ThreeD: 0b1110,
} as const;
export type MitsubishiHeavy88SwingHValue = (typeof MitsubishiHeavy88SwingH)[keyof typeof MitsubishiHeavy88SwingH];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface MitsubishiHeavy88State {
  power?: boolean;
  /** Temperature in °C (17–31). */
  temp?: number;
  mode?: MitsubishiHeavy88ModeValue;
  fan?: MitsubishiHeavy88FanValue;
  swingV?: MitsubishiHeavy88SwingVValue;
  swingH?: MitsubishiHeavy88SwingHValue;
  clean?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function setBits(raw: Uint8Array, idx: number, off: number, size: number, val: number): void {
  const mask = ((1 << size) - 1) << off;
  raw[idx] = (raw[idx]! & ~mask) | ((val << off) & mask);
}

// ---------------------------------------------------------------------------
// Build raw 11-byte state
// ---------------------------------------------------------------------------

/** Build the raw 11-byte Mitsubishi Heavy 88 state from a state object. */
export function buildMitsubishiHeavy88Raw(state: MitsubishiHeavy88State): Uint8Array {
  const raw = new Uint8Array(STATE_LENGTH);
  raw.set(SIG, 0);

  const swingV = state.swingV ?? MitsubishiHeavy88SwingV.Off;
  const swingH = state.swingH ?? MitsubishiHeavy88SwingH.Off;

  // Byte 5: SwingV5(bit1), SwingH1(bits2-3), Clean(bit5), SwingH2(bits6-7).
  setBits(raw, 5, 1, 1, swingV & 0x1); // SwingV5 (low bit)
  setBits(raw, 5, 2, 2, swingH & 0x3); // SwingH1 (low 2 bits)
  setBits(raw, 5, 5, 1, state.clean ? 1 : 0);
  setBits(raw, 5, 6, 2, (swingH >> 2) & 0x3); // SwingH2 (high 2 bits)
  // Byte 7: SwingV7(bits3-4), Fan(bits5-7).
  setBits(raw, 7, 3, 2, (swingV >> 1) & 0x3); // SwingV7 (high 2 bits)
  setBits(raw, 7, 5, 3, state.fan ?? MitsubishiHeavy88Fan.Auto);
  // Byte 9: Mode(0-2), Power(3), Temp(4-7).
  setBits(raw, 9, 0, 3, state.mode ?? MitsubishiHeavy88Mode.Auto);
  setBits(raw, 9, 3, 1, state.power ? 1 : 0);
  setBits(raw, 9, 4, 4, clamp(state.temp ?? 24, TEMP_MIN, TEMP_MAX) - TEMP_MIN);

  applyInvertedPairs(raw, MH_CHECKSUM_OFFSET);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw Mitsubishi Heavy 88 payload into IR timings. */
export function encodeMitsubishiHeavy88Raw(data: Uint8Array, repeat: number = 0): number[] {
  return encodeMitsubishiHeavy(data, repeat);
}

/** Encode a Mitsubishi Heavy 88 state into raw IR timings. */
export function sendMitsubishiHeavy88(state: MitsubishiHeavy88State, repeat: number = 0): number[] {
  return encodeMitsubishiHeavy(buildMitsubishiHeavy88Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 11-byte Mitsubishi Heavy 88 state into a state object. */
export function parseMitsubishiHeavy88State(raw: Uint8Array): MitsubishiHeavy88State {
  const swingV = ((raw[5]! >> 1) & 0x1) | (((raw[7]! >> 3) & 0x3) << 1);
  const swingH = ((raw[5]! >> 2) & 0x3) | (((raw[5]! >> 6) & 0x3) << 2);
  return {
    power: !!((raw[9]! >> 3) & 1),
    temp: ((raw[9]! >> 4) & 0x0f) + TEMP_MIN,
    mode: (raw[9]! & 0x07) as MitsubishiHeavy88ModeValue,
    fan: ((raw[7]! >> 5) & 0x07) as MitsubishiHeavy88FanValue,
    swingV: swingV as MitsubishiHeavy88SwingVValue,
    swingH: swingH as MitsubishiHeavy88SwingHValue,
    clean: !!((raw[5]! >> 5) & 1),
  };
}

/**
 * Decode raw IR timings as a Mitsubishi Heavy 88-bit message.
 *
 * Validates the ZJS signature and the inverted-byte-pair checksum.
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeMitsubishiHeavy88(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): MitsubishiHeavy88State | null {
  const raw = decodeMitsubishiHeavyBytes(timings, offset, STATE_LENGTH, headerOptional);
  if (!raw) return null;
  for (let i = 0; i < SIG.length; i++) if (raw[i] !== SIG[i]) return null;
  if (!checkInvertedPairs(raw, MH_CHECKSUM_OFFSET)) return null;
  return parseMitsubishiHeavy88State(raw);
}
