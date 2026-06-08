/**
 * Mitsubishi Heavy Industries 152-bit A/C protocol. (MITSUBISHI_HEAVY_152)
 *
 * Ported from IRremoteESP8266 `ir_MitsubishiHeavy.cpp` (`IRMitsubishiHeavy152Ac`).
 * A 19-byte message: a 5-byte ZMS signature followed by data bytes interleaved
 * with their bit-complements (the protocol's integrity scheme).
 * Models: RLA502A700B remote, SRKxxZM-S / SRKxxZMXA-S A/Cs.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/660
 */

import { encodeMitsubishiHeavy, decodeMitsubishiHeavyBytes, applyInvertedPairs, checkInvertedPairs, MH_CHECKSUM_OFFSET } from "./mitsubishi_heavy_common.js";

const STATE_LENGTH = 19;
const TEMP_MIN = 17;
const TEMP_MAX = 31;
/** ZMS signature (bytes 0–4). */
const SIG = [0xad, 0x51, 0x3c, 0xe5, 0x1a] as const;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const MitsubishiHeavy152Mode = {
  Auto: 0,
  Cool: 1,
  Dry: 2,
  Fan: 3,
  Heat: 4,
} as const;
export type MitsubishiHeavy152ModeValue = (typeof MitsubishiHeavy152Mode)[keyof typeof MitsubishiHeavy152Mode];

export const MitsubishiHeavy152Fan = {
  Auto: 0x0,
  Low: 0x1,
  Med: 0x2,
  High: 0x3,
  Max: 0x4,
  Econo: 0x6,
  Turbo: 0x8,
} as const;
export type MitsubishiHeavy152FanValue = (typeof MitsubishiHeavy152Fan)[keyof typeof MitsubishiHeavy152Fan];

export const MitsubishiHeavy152SwingV = {
  Auto: 0,
  Highest: 1,
  High: 2,
  Middle: 3,
  Low: 4,
  Lowest: 5,
  Off: 6,
} as const;
export type MitsubishiHeavy152SwingVValue = (typeof MitsubishiHeavy152SwingV)[keyof typeof MitsubishiHeavy152SwingV];

export const MitsubishiHeavy152SwingH = {
  Auto: 0,
  LeftMax: 1,
  Left: 2,
  Middle: 3,
  Right: 4,
  RightMax: 5,
  RightLeft: 6,
  LeftRight: 7,
  Off: 8,
} as const;
export type MitsubishiHeavy152SwingHValue = (typeof MitsubishiHeavy152SwingH)[keyof typeof MitsubishiHeavy152SwingH];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface MitsubishiHeavy152State {
  power?: boolean;
  /** Temperature in °C (17–31). */
  temp?: number;
  mode?: MitsubishiHeavy152ModeValue;
  fan?: MitsubishiHeavy152FanValue;
  swingV?: MitsubishiHeavy152SwingVValue;
  swingH?: MitsubishiHeavy152SwingHValue;
  night?: boolean;
  silent?: boolean;
  filter?: boolean;
  clean?: boolean;
  /** 3D airflow. */
  threeD?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function setBits(raw: Uint8Array, idx: number, off: number, size: number, val: number): void {
  const mask = ((1 << size) - 1) << off;
  raw[idx] = (raw[idx]! & ~mask) | ((val << off) & mask);
}

// ---------------------------------------------------------------------------
// Build raw 19-byte state
// ---------------------------------------------------------------------------

/** Build the raw 19-byte Mitsubishi Heavy 152 state from a state object. */
export function buildMitsubishiHeavy152Raw(state: MitsubishiHeavy152State): Uint8Array {
  const raw = new Uint8Array(STATE_LENGTH);
  raw.set(SIG, 0);
  // Byte 5: Mode(0-2), Power(3), Clean(5), Filter(6).
  setBits(raw, 5, 0, 3, state.mode ?? MitsubishiHeavy152Mode.Auto);
  setBits(raw, 5, 3, 1, state.power ? 1 : 0);
  setBits(raw, 5, 5, 1, state.clean ? 1 : 0);
  setBits(raw, 5, 6, 1, state.filter ? 1 : 0);
  // Byte 7: Temp(0-3).
  setBits(raw, 7, 0, 4, clamp(state.temp ?? 24, TEMP_MIN, TEMP_MAX) - TEMP_MIN);
  // Byte 9: Fan(0-3).
  setBits(raw, 9, 0, 4, state.fan ?? MitsubishiHeavy152Fan.Auto);
  // Byte 11: Three(1), D(4), SwingV(5-7).
  const threeD = state.threeD ? 1 : 0;
  setBits(raw, 11, 1, 1, threeD);
  setBits(raw, 11, 4, 1, threeD);
  setBits(raw, 11, 5, 3, Math.min(state.swingV ?? MitsubishiHeavy152SwingV.Auto, MitsubishiHeavy152SwingV.Off));
  // Byte 13: SwingH(0-3).
  setBits(raw, 13, 0, 4, state.swingH ?? MitsubishiHeavy152SwingH.Auto);
  // Byte 15: Night(6), Silent(7).
  setBits(raw, 15, 6, 1, state.night ? 1 : 0);
  setBits(raw, 15, 7, 1, state.silent ? 1 : 0);
  raw[17] = 0x80; // constant data byte

  applyInvertedPairs(raw, MH_CHECKSUM_OFFSET);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw Mitsubishi Heavy 152 payload into IR timings. */
export function encodeMitsubishiHeavy152Raw(data: Uint8Array, repeat: number = 0): number[] {
  return encodeMitsubishiHeavy(data, repeat);
}

/** Encode a Mitsubishi Heavy 152 state into raw IR timings. */
export function sendMitsubishiHeavy152(state: MitsubishiHeavy152State, repeat: number = 0): number[] {
  return encodeMitsubishiHeavy(buildMitsubishiHeavy152Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 19-byte Mitsubishi Heavy 152 state into a state object. */
export function parseMitsubishiHeavy152State(raw: Uint8Array): MitsubishiHeavy152State {
  return {
    power: !!((raw[5]! >> 3) & 1),
    temp: (raw[7]! & 0x0f) + TEMP_MIN,
    mode: (raw[5]! & 0x07) as MitsubishiHeavy152ModeValue,
    fan: (raw[9]! & 0x0f) as MitsubishiHeavy152FanValue,
    swingV: ((raw[11]! >> 5) & 0x07) as MitsubishiHeavy152SwingVValue,
    swingH: (raw[13]! & 0x0f) as MitsubishiHeavy152SwingHValue,
    night: !!((raw[15]! >> 6) & 1),
    silent: !!((raw[15]! >> 7) & 1),
    filter: !!((raw[5]! >> 6) & 1),
    clean: !!((raw[5]! >> 5) & 1),
    threeD: !!((raw[11]! >> 1) & 1) && !!((raw[11]! >> 4) & 1),
  };
}

/**
 * Decode raw IR timings as a Mitsubishi Heavy 152-bit message.
 *
 * Validates the ZMS signature and the inverted-byte-pair checksum.
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeMitsubishiHeavy152(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): MitsubishiHeavy152State | null {
  const raw = decodeMitsubishiHeavyBytes(timings, offset, STATE_LENGTH, headerOptional);
  if (!raw) return null;
  for (let i = 0; i < SIG.length; i++) if (raw[i] !== SIG[i]) return null;
  if (!checkInvertedPairs(raw, MH_CHECKSUM_OFFSET)) return null;
  return parseMitsubishiHeavy152State(raw);
}
