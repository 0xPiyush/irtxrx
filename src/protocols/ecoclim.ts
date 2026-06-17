/**
 * EcoClim A/C IR protocol encoder and decoder. (ECOCLIM)
 *
 * Ported from IRremoteESP8266 `ir_Ecoclim.cpp` / `ir_Ecoclim.h` — full coverage
 * of the `IREcoclimAc` class and the `sendEcoclim` / `decodeEcoclim` wire format
 * (the 56-bit remote message; the 15-bit short sensor report is receive-only in
 * the vendor and has no encode/structured path, so it's out of scope).
 *
 * Wire format: a 56-bit value sent MSB-first as **three identical sections**
 * (each a 5730/1935 header + data, no per-section footer), then one 7820µs
 * footer mark + gap. There is **no checksum**; the message is gated on the fixed
 * `0b010` low bits and the three sections matching.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Ecoclim.cpp
 */

import { encodeData } from "../encode.js";
import { matchGeneric, kMarkExcess } from "../decode.js";

const HDR_MARK = 5730;
const HDR_SPACE = 1935;
const BIT_MARK = 440;
const ONE_SPACE = 1739;
const ZERO_SPACE = 637;
const FOOTER_MARK = 7820;
const GAP = 100000;
const SECTIONS = 3;
const TOLERANCE = 30; // kTolerance (25) + kEcoclimExtraTolerance (5)

export const ECOCLIM_BITS = 56;
const MASK = (1n << 56n) - 1n;
const DEFAULT_STATE = 0x11063000ffff02n;

export const EcoclimMode = {
  Auto: 0b000, Cool: 0b001, Dry: 0b010, Recycle: 0b011, Fan: 0b100, Heat: 0b101, Sleep: 0b111,
} as const;
export type EcoclimModeValue = (typeof EcoclimMode)[keyof typeof EcoclimMode];
export const EcoclimFan = { Min: 0b00, Med: 0b01, Max: 0b10, Auto: 0b11 } as const;
export type EcoclimFanValue = (typeof EcoclimFan)[keyof typeof EcoclimFan];
export const EcoclimType = { Master: 0b0000, Slave: 0b0111 } as const;
export type EcoclimTypeValue = (typeof EcoclimType)[keyof typeof EcoclimType];

const TEMP_MIN = 5;
const TEMP_MAX = 36;
const CLOCK_MAX = 24 * 60 - 1;
const TIMER_DISABLE = 0x1f * 60 + 7 * 10; // 1930 (OnHours=31, OnTenMins=7)

export interface EcoclimState {
  power?: boolean;
  mode?: EcoclimModeValue;
  /** Desired temperature in °C (5–36). */
  temp?: number;
  fan?: EcoclimFanValue;
  /** Sensed (FollowMe) temperature in °C (5–36). */
  sensorTemp?: number;
  /** Clock: minutes past midnight (0–1439). */
  clock?: number;
  /** On-timer in minutes (10-min resolution; ≥1440 = disabled). */
  onTimer?: number;
  /** Off-timer in minutes (10-min resolution; ≥1440 = disabled). */
  offTimer?: number;
  /** Master/Slave dip config. */
  type?: EcoclimTypeValue;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
function getF(v: bigint, pos: number, width: number): number {
  return Number((v >> BigInt(pos)) & ((1n << BigInt(width)) - 1n));
}
function setF(v: bigint, pos: number, width: number, val: number): bigint {
  const m = ((1n << BigInt(width)) - 1n) << BigInt(pos);
  return (v & ~m) | ((BigInt(val) << BigInt(pos)) & m);
}

function validMode(m: number): number {
  switch (m) {
    case EcoclimMode.Auto: case EcoclimMode.Cool: case EcoclimMode.Dry:
    case EcoclimMode.Recycle: case EcoclimMode.Fan: case EcoclimMode.Heat: case EcoclimMode.Sleep:
      return m;
    default: return EcoclimMode.Auto;
  }
}

/** Build the raw 56-bit EcoClim value from a state object. */
export function buildEcoclimRaw(state: EcoclimState): bigint {
  let v = DEFAULT_STATE;
  v = setF(v, 4, 4, state.type === EcoclimType.Slave ? EcoclimType.Slave : EcoclimType.Master); // DipConfig
  v = setF(v, 24, 11, clamp(state.clock ?? 0, 0, CLOCK_MAX)); // Clock
  v = setF(v, 36, 2, Math.min(state.fan ?? EcoclimFan.Auto, EcoclimFan.Auto)); // Fan
  v = setF(v, 38, 1, (state.power ?? false) ? 1 : 0); // Power
  v = setF(v, 40, 5, clamp(state.temp ?? 24, TEMP_MIN, TEMP_MAX) - TEMP_MIN); // Temp
  v = setF(v, 45, 3, validMode(state.mode ?? EcoclimMode.Auto)); // Mode
  v = setF(v, 48, 5, clamp(state.sensorTemp ?? 24, TEMP_MIN, TEMP_MAX) - TEMP_MIN); // SensorTemp

  const onMins = state.onTimer ?? TIMER_DISABLE;
  if (onMins < 24 * 60) {
    v = setF(v, 19, 5, Math.floor(onMins / 60)); // OnHours
    v = setF(v, 16, 3, Math.floor((onMins % 60) / 10)); // OnTenMins
  } else {
    v = setF(v, 19, 5, 0x1f); v = setF(v, 16, 3, 0x7);
  }
  const offMins = state.offTimer ?? TIMER_DISABLE;
  if (offMins < 24 * 60) {
    v = setF(v, 11, 5, Math.floor(offMins / 60)); // OffHours
    v = setF(v, 8, 3, Math.floor((offMins % 60) / 10)); // OffTenMins
  } else {
    v = setF(v, 11, 5, 0x1f); v = setF(v, 8, 3, 0x7);
  }
  return v & MASK;
}

/** Encode a raw 56-bit EcoClim value into IR timings (`IRsend::sendEcoclim`). */
export function encodeEcoclimRaw(data: bigint, repeat: number = 0): number[] {
  const out: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    for (let s = 0; s < SECTIONS; s++) {
      out.push(HDR_MARK, HDR_SPACE);
      for (const t of encodeData(BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, data & MASK, ECOCLIM_BITS, true)) out.push(t);
    }
    out.push(FOOTER_MARK, GAP);
  }
  return out;
}

/** Build + encode an EcoClim state into IR timings. */
export function sendEcoclim(state: EcoclimState, repeat: number = 0): number[] {
  return encodeEcoclimRaw(buildEcoclimRaw(state), repeat);
}

/** Parse a 56-bit EcoClim value into a state object. */
export function parseEcoclimState(v: bigint): EcoclimState {
  return {
    power: getF(v, 38, 1) === 1,
    mode: getF(v, 45, 3) as EcoclimModeValue,
    temp: getF(v, 40, 5) + TEMP_MIN,
    fan: getF(v, 36, 2) as EcoclimFanValue,
    sensorTemp: getF(v, 48, 5) + TEMP_MIN,
    clock: getF(v, 24, 11),
    onTimer: getF(v, 19, 5) * 60 + getF(v, 16, 3) * 10,
    offTimer: getF(v, 11, 5) * 60 + getF(v, 8, 3) * 10,
    type: getF(v, 4, 4) === EcoclimType.Slave ? EcoclimType.Slave : EcoclimType.Master,
  };
}

/**
 * Decode raw IR timings as an EcoClim A/C message (`IRrecv::decodeEcoclim`):
 * match three identical 56-bit MSB-first sections; gate on the fixed `0b010`
 * low bits (there is no checksum).
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeEcoclim(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): EcoclimState | null {
  let pos = offset;
  let value: bigint | null = null;
  for (let s = 0; s < SECTIONS; s++) {
    const result = matchGeneric(
      timings, pos, timings.length - pos, ECOCLIM_BITS,
      HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
      0, 0, false, TOLERANCE, kMarkExcess, true, headerOptional,
    );
    if (!result) return null; // all three sections are required
    const v = result.data & MASK;
    if (s === 0) value = v;
    else if (v !== value) return null; // sections must match
    pos += result.used;
  }
  if (value === null) return null;
  if ((value & 0b111n) !== 0b010n) return null; // fixed low bits
  return parseEcoclimState(value);
}
