/**
 * Technibel A/C IR protocol encoder and decoder. (TECHNIBEL_AC)
 *
 * Ported from IRremoteESP8266 `ir_Technibel.cpp` / `ir_Technibel.h` — full
 * coverage of the `IRTechnibelAc` class and the `sendTechnibelAc` /
 * `decodeTechnibelAc` wire format.
 *
 * Wire format: a 56-bit value sent **MSB-first** behind an 8836/4380 header.
 * byte 6 is a fixed `0x18` header; byte 0 is a two's-complement checksum of
 * bytes 2–5. Temperature is stored as the literal degree value (°C 16–31 /
 * °F 61–88). Dry mode forces low fan; the timer is in whole hours.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Technibel.cpp
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric, kMarkExcess, kTolerance } from "../decode.js";

const HDR_MARK = 8836;
const HDR_SPACE = 4380;
const BIT_MARK = 523;
const ONE_SPACE = 1696;
const ZERO_SPACE = 564;
const GAP = 100000;

export const TECHNIBEL_AC_BITS = 56;
const MASK = (1n << 56n) - 1n;
const HEADER = 0x18;

export const TechnibelAcMode = { Cool: 0b0001, Dry: 0b0010, Fan: 0b0100, Heat: 0b1000 } as const;
export type TechnibelAcModeValue = (typeof TechnibelAcMode)[keyof typeof TechnibelAcMode];
export const TechnibelAcFan = { Low: 0b001, Medium: 0b010, High: 0b100 } as const;
export type TechnibelAcFanValue = (typeof TechnibelAcFan)[keyof typeof TechnibelAcFan];

const TEMP_MIN_C = 16;
const TEMP_MAX_C = 31;
const TEMP_MIN_F = 61;
const TEMP_MAX_F = 88;
const TIMER_MAX = 24; // hours

export interface TechnibelAcState {
  power?: boolean;
  mode?: TechnibelAcModeValue;
  /** Temperature in the active unit (°C 16–31 / °F 61–88). */
  temp?: number;
  /** Whether {@link temp} is Celsius. Defaults to true. */
  celsius?: boolean;
  fan?: TechnibelAcFanValue;
  swing?: boolean;
  sleep?: boolean;
  /** Off-timer in minutes (whole-hour resolution; 0 disables). */
  timer?: number;
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

function isMode(m: number | undefined): boolean {
  return m === TechnibelAcMode.Cool || m === TechnibelAcMode.Dry ||
    m === TechnibelAcMode.Fan || m === TechnibelAcMode.Heat;
}
function isFan(f: number | undefined): boolean {
  return f === TechnibelAcFan.Low || f === TechnibelAcFan.Medium || f === TechnibelAcFan.High;
}

/** Checksum: two's complement of the sum of bytes 2–5 (stored in byte 0). */
export function technibelAcCalcChecksum(value: bigint): number {
  let sum = 0;
  for (let off = 16; off < 48; off += 8) sum += getF(value, off, 8);
  return (~sum + 1) & 0xff;
}

/** Verify the byte-0 checksum of a 56-bit Technibel value. */
export function technibelAcValidChecksum(value: bigint): boolean {
  return getF(value, 0, 8) === technibelAcCalcChecksum(value);
}

/**
 * Build the raw 56-bit Technibel value from a state object. Dry mode forces low
 * fan (as the class does); the timer is stored in whole hours.
 */
export function buildTechnibelAcRaw(state: TechnibelAcState): bigint {
  const fahr = !(state.celsius ?? true);
  const mode = isMode(state.mode) ? state.mode! : TechnibelAcMode.Cool;
  const fan = mode === TechnibelAcMode.Dry ? TechnibelAcFan.Low : (isFan(state.fan) ? state.fan! : TechnibelAcFan.Low);
  const min = fahr ? TEMP_MIN_F : TEMP_MIN_C;
  const max = fahr ? TEMP_MAX_F : TEMP_MAX_C;
  const hours = Math.min(TIMER_MAX, Math.floor(Math.max(0, state.timer ?? 0) / 60));

  let v = BigInt(HEADER) << 48n;
  v = setF(v, 16, 5, hours); // TimerHours
  v = setF(v, 24, 7, clamp(state.temp ?? 20, min, max)); // Temp
  v = setF(v, 32, 3, fan); // Fan
  v = setF(v, 36, 1, (state.sleep ?? false) ? 1 : 0); // Sleep
  v = setF(v, 37, 1, (state.swing ?? false) ? 1 : 0); // Swing
  v = setF(v, 38, 1, fahr ? 1 : 0); // UseFah
  v = setF(v, 39, 1, hours > 0 ? 1 : 0); // TimerEnable
  v = setF(v, 40, 4, mode); // Mode
  v = setF(v, 47, 1, (state.power ?? false) ? 1 : 0); // Power
  v = setF(v, 0, 8, technibelAcCalcChecksum(v)); // Sum
  return v & MASK;
}

/** Encode a raw 56-bit Technibel value into IR timings (MSB-first). */
export function encodeTechnibelAcRaw(data: bigint, repeat: number = 0): number[] {
  return sendGeneric({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP, data: data & MASK, nbits: TECHNIBEL_AC_BITS, msbFirst: true, repeat,
  });
}

/** Build + encode a Technibel state into IR timings. */
export function sendTechnibelAc(state: TechnibelAcState, repeat: number = 0): number[] {
  return encodeTechnibelAcRaw(buildTechnibelAcRaw(state), repeat);
}

/** Parse a validated 56-bit Technibel value into a state object. */
export function parseTechnibelAcState(v: bigint): TechnibelAcState {
  const enabled = getF(v, 39, 1) === 1;
  return {
    power: getF(v, 47, 1) === 1,
    mode: getF(v, 40, 4) as TechnibelAcModeValue,
    celsius: getF(v, 38, 1) === 0,
    temp: getF(v, 24, 7),
    fan: getF(v, 32, 3) as TechnibelAcFanValue,
    swing: getF(v, 37, 1) === 1,
    sleep: getF(v, 36, 1) === 1,
    timer: enabled ? getF(v, 16, 5) * 60 : 0,
  };
}

/**
 * Decode raw IR timings as a Technibel A/C message (`IRrecv::decodeTechnibelAc`):
 * match a 56-bit MSB-first value, verify the fixed header byte and checksum.
 */
export function decodeTechnibelAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): TechnibelAcState | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, TECHNIBEL_AC_BITS,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP, true, kTolerance, kMarkExcess, true, headerOptional,
  );
  if (!result) return null;
  const v = result.data & MASK;
  if (getF(v, 48, 8) !== HEADER) return null;
  if (!technibelAcValidChecksum(v)) return null;
  return parseTechnibelAcState(v);
}
