/**
 * LG A/C IR protocol encoder and decoder. (LG / LG2 A/C)
 *
 * Ported from IRremoteESP8266 `ir_LG.cpp` (the `IRLgAc` class).
 * Models the **main** 28-bit A/C command — power, mode, temperature, fan —
 * carried over the LG (or LG2) wire. The 28-bit value packs:
 * `Sign(8)=0x88 | Power(2) | …(3) | Mode(3) | Temp(4) | Fan(4) | Checksum(4)`,
 * with the 4-bit nibble-sum checksum shared with the {@link decodeLg} wire.
 *
 * The remote model selects the wire variant (LG vs LG2) and the fan-code
 * mapping. Swing, vane, light and the dedicated power-off command are sent as
 * separate one-off command codes by the real remote and are out of scope here.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1513
 */

import { sumNibbles64 } from "../encode.js";
import { encodeLgRaw, decodeLg } from "./lg.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGNATURE = 0x88; // bits 20-27
const TEMP_ADJUST = 15;
const TEMP_MIN = 16;
const TEMP_MAX = 30;
const POWER_ON = 0; // 0b00
const POWER_OFF = 3; // 0b11

// Internal fan codes (some are model-specific).
const FAN_LOWEST = 0;
const FAN_LOW = 1;
const FAN_MEDIUM = 2;
const FAN_MAX = 4;
const FAN_AUTO = 5;
const FAN_LOW_ALT = 9;
const FAN_HIGH = 10;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const LgAcMode = {
  Cool: 0,
  Dry: 1,
  Fan: 2,
  Auto: 3,
  Heat: 4,
} as const;
export type LgAcModeValue = (typeof LgAcMode)[keyof typeof LgAcMode];

/** Logical fan speeds accepted by the state (raw codes are model-dependent). */
export const LgAcFan = {
  Lowest: FAN_LOWEST,
  Low: FAN_LOW,
  Medium: FAN_MEDIUM,
  High: FAN_HIGH,
  Max: FAN_MAX,
  Auto: FAN_AUTO,
} as const;
export type LgAcFanValue = (typeof LgAcFan)[keyof typeof LgAcFan];

export const LgAcModel = {
  GE6711AR2853M: 1, // LG wire
  AKB75215403: 2, // LG2 wire
  AKB74955603: 3, // LG2 wire (alt fan codes)
  AKB73757604: 4, // LG2 wire
  LG6711A20083V: 5, // LG wire (swingV toggle)
} as const;
export type LgAcModelValue = (typeof LgAcModel)[keyof typeof LgAcModel];

const LG2_MODELS = new Set<number>([
  LgAcModel.AKB75215403, LgAcModel.AKB74955603, LgAcModel.AKB73757604,
]);

/** True if the model transmits on the LG2 wire variant. */
export function lgAcModelIsLg2(model: number): boolean {
  return LG2_MODELS.has(model);
}

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface LgAcState {
  model?: LgAcModelValue;
  power?: boolean;
  mode?: LgAcModeValue;
  /** Temperature in °C (16–30). */
  temp?: number;
  fan?: LgAcFanValue;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function setBits(raw: number, off: number, size: number, val: number): number {
  const mask = ((1 << size) - 1) << off;
  return (raw & ~mask) | ((val << off) & mask);
}

/** Checksum: 4-bit nibble-sum of the 16 bits above the checksum nibble. */
function lgAcChecksum(raw: number): number {
  return sumNibbles64(BigInt((raw >>> 4) & 0xffff), 16);
}

// ---------------------------------------------------------------------------
// Build raw 28-bit value — emulates the IRLgAc setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 28-bit LG A/C value from a state object.
 *
 * Mirrors the `IRLgAc` setter order used by the cross-check runner
 * (model → power → mode → temp → fan), including the model-dependent fan codes.
 */
export function buildLgAcRaw(state: LgAcState): number {
  const model = state.model ?? LgAcModel.GE6711AR2853M;
  const isAkb74955603 = model === LgAcModel.AKB74955603;

  let raw = SIGNATURE << 20; // sign byte; all other fields start at 0

  // Power (bits 18-19) — 0b00 on, 0b11 off.
  raw = setBits(raw, 18, 2, (state.power ?? false) ? POWER_ON : POWER_OFF);

  // Mode (bits 12-14) — unknown values fall back to Auto.
  let mode: number = state.mode ?? LgAcMode.Auto;
  switch (mode) {
    case LgAcMode.Cool:
    case LgAcMode.Dry:
    case LgAcMode.Fan:
    case LgAcMode.Auto:
    case LgAcMode.Heat:
      break;
    default:
      mode = LgAcMode.Auto;
  }
  raw = setBits(raw, 12, 3, mode);

  // Temp (bits 8-11) — clamped, stored offset by 15.
  raw = setBits(raw, 8, 4, clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_ADJUST);

  // Fan (bits 4-7) — model-dependent encoding (mirrors IRLgAc::setFan).
  const speed: number = state.fan ?? FAN_AUTO;
  let fanCode: number;
  if (!isAkb74955603 && speed === FAN_LOW_ALT) {
    fanCode = FAN_LOW;
  } else if (!isAkb74955603 && speed === FAN_HIGH) {
    fanCode = FAN_MAX;
  } else {
    switch (speed) {
      case FAN_LOW:
      case FAN_LOW_ALT:
        fanCode = isAkb74955603 ? FAN_LOW_ALT : FAN_LOW;
        break;
      case FAN_HIGH:
        fanCode = isAkb74955603 ? FAN_HIGH : FAN_MAX;
        break;
      case FAN_AUTO:
      case FAN_LOWEST:
      case FAN_MEDIUM:
      case FAN_MAX:
        fanCode = speed;
        break;
      default:
        fanCode = FAN_AUTO;
    }
  }
  raw = setBits(raw, 4, 4, fanCode);

  // Checksum (bits 0-3).
  raw = setBits(raw, 0, 4, lgAcChecksum(raw));
  return raw >>> 0;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode an LG A/C state into raw IR timings. */
export function sendLgAc(state: LgAcState, repeat: number = 0): number[] {
  const raw = buildLgAcRaw(state);
  const lg2 = lgAcModelIsLg2(state.model ?? LgAcModel.GE6711AR2853M);
  return encodeLgRaw(BigInt(raw), 28, lg2, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Map a raw fan-field code to a logical fan speed. */
function fanFieldToLogical(field: number): LgAcFanValue {
  switch (field) {
    case FAN_LOWEST: return LgAcFan.Lowest;
    case FAN_LOW: return LgAcFan.Low;
    case FAN_LOW_ALT: return LgAcFan.Low;
    case FAN_MEDIUM: return LgAcFan.Medium;
    case FAN_MAX: return LgAcFan.Max;
    case FAN_HIGH: return LgAcFan.High;
    default: return LgAcFan.Auto;
  }
}

/** Parse a validated 28-bit LG A/C value into a state object. */
export function parseLgAcState(raw: number, lg2: boolean): LgAcState {
  const fanField = (raw >>> 4) & 0xf;
  // Model: LG → GE; LG2 → AKB74955603 if it uses the alt fan codes, else AKB75215403.
  const model: LgAcModelValue = !lg2
    ? LgAcModel.GE6711AR2853M
    : (fanField & 0x8) ? LgAcModel.AKB74955603 : LgAcModel.AKB75215403;
  return {
    model,
    power: ((raw >>> 18) & 0x3) === POWER_ON,
    mode: ((raw >>> 12) & 0x7) as LgAcModeValue,
    temp: ((raw >>> 8) & 0xf) + TEMP_ADJUST,
    fan: fanFieldToLogical(fanField),
  };
}

/**
 * Decode raw IR timings as an LG A/C (main command) message.
 *
 * Reuses the LG/LG2 wire decoder (header auto-detect + nibble checksum), then
 * requires the `0x88` A/C signature byte.
 *
 * @returns Decoded state, or null on mismatch / non-A/C frame.
 */
export function decodeLgAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): LgAcState | null {
  const lg = decodeLg(timings, offset, headerOptional);
  if (!lg) return null;
  const raw = Number(lg.data);
  if (((raw >>> 20) & 0xff) !== SIGNATURE) return null; // not an A/C message
  return parseLgAcState(raw, lg.lg2);
}
