/**
 * Delonghi A/C IR protocol encoder and decoder. (DELONGHI_AC)
 *
 * Ported from IRremoteESP8266 `ir_Delonghi.cpp` / `ir_Delonghi.h` — full coverage
 * of the `IRDelonghiAc` class and the `sendDelonghiAc` / `decodeDelonghiAc` wire
 * format. Models: Delonghi PAC portable A/Cs.
 *
 * Wire format: a 64-bit value sent LSB-first behind an 8984/4200 header. byte 0
 * is a `0x53` header; byte 7 is a plain sum of bytes 0–6. Carries
 * power/mode/temp (°C 18–32 / °F 64–90)/fan/boost/sleep and On/Off timers.
 * Auto & Dry force a fixed temp code, Fan mode forces another, and each mode
 * constrains the fan speed — all reproduced from the class.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Delonghi.cpp
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric, kMarkExcess, kTolerance } from "../decode.js";

const HDR_MARK = 8984;
const HDR_SPACE = 4200;
const BIT_MARK = 572;
const ONE_SPACE = 1558;
const ZERO_SPACE = 510;
const MESSAGE_GAP = 100000;

export const DELONGHI_AC_BITS = 64;
const MASK = (1n << 64n) - 1n;
const HEADER = 0x53;

export const DelonghiAcMode = { Cool: 0b000, Dry: 0b001, Fan: 0b010, Auto: 0b100 } as const;
export type DelonghiAcModeValue = (typeof DelonghiAcMode)[keyof typeof DelonghiAcMode];
export const DelonghiAcFan = { Auto: 0b00, High: 0b01, Medium: 0b10, Low: 0b11 } as const;
export type DelonghiAcFanValue = (typeof DelonghiAcFan)[keyof typeof DelonghiAcFan];

const TEMP_MIN_C = 18;
const TEMP_MAX_C = 32;
const TEMP_MIN_F = 64;
const TEMP_MAX_F = 90;
const TEMP_AUTO_DRY = 0;
const TEMP_FAN = 0b00110;
const TIMER_MAX = 23 * 60 + 59;

export interface DelonghiAcState {
  power?: boolean;
  mode?: DelonghiAcModeValue;
  /** Temperature in the active unit (°C 18–32 / °F 64–90). Forced in non-Cool modes. */
  temp?: number;
  /** Whether {@link temp} is Celsius. Defaults to true. */
  celsius?: boolean;
  fan?: DelonghiAcFanValue;
  /** Boost / Turbo. */
  boost?: boolean;
  sleep?: boolean;
  /** On-timer in minutes (0 disables). */
  onTimer?: number;
  /** Off-timer in minutes (0 disables). */
  offTimer?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Checksum: sum of bytes 0–6 (stored in byte 7). */
export function delonghiAcCalcChecksum(value: bigint): number {
  let sum = 0;
  for (let i = 0; i < 56; i += 8) sum += Number((value >> BigInt(i)) & 0xffn);
  return sum & 0xff;
}

/** Verify the byte-7 checksum of a 64-bit Delonghi value. */
export function delonghiAcValidChecksum(value: bigint): boolean {
  return Number((value >> 56n) & 0xffn) === delonghiAcCalcChecksum(value);
}

/**
 * Build the raw 64-bit Delonghi value from a state object, mirroring the
 * `IRDelonghiAc` setter sequence (power → temp → mode → fan → boost → sleep →
 * timers) including the saved-temp / mode-forced-temp / fan-constraint logic.
 */
export function buildDelonghiAcRaw(state: DelonghiAcState): bigint {
  const w = {
    temp: 0, fan: 0, fahr: false, power: false, mode: 0, boost: false, sleep: false,
    onTimer: false, onH: 0, onM: 0, offTimer: false, offH: 0, offM: 0,
    savedTemp: 23, savedUnits: false,
  };

  const setTemp = (deg: number, fahr: boolean, force: boolean): void => {
    if (force) { w.temp = deg; return; }
    const min = fahr ? TEMP_MIN_F : TEMP_MIN_C;
    const max = fahr ? TEMP_MAX_F : TEMP_MAX_C;
    w.fahr = fahr;
    const t = clamp(deg, min, max);
    w.savedTemp = t;
    w.savedUnits = fahr;
    w.temp = t - min + 1;
  };
  const setFan = (speed: number): void => {
    switch (w.mode) {
      case DelonghiAcMode.Fan:
        if (speed === DelonghiAcFan.Auto) {
          if (w.fan === DelonghiAcFan.Auto) w.fan = DelonghiAcFan.High;
          return;
        }
        break;
      case DelonghiAcMode.Auto:
      case DelonghiAcMode.Dry:
        if (speed !== DelonghiAcFan.Auto) { w.fan = DelonghiAcFan.Auto; return; }
        break;
    }
    w.fan = speed > DelonghiAcFan.Low ? DelonghiAcFan.Auto : speed;
  };
  const setMode = (mode: number): void => {
    w.mode = mode;
    switch (mode) {
      case DelonghiAcMode.Auto:
      case DelonghiAcMode.Dry:
        setTemp(TEMP_AUTO_DRY, w.fahr, true); break;
      case DelonghiAcMode.Fan:
        setTemp(TEMP_FAN, w.fahr, true); break;
      case DelonghiAcMode.Cool:
        setTemp(w.savedTemp, w.savedUnits, false); break;
      default:
        w.mode = DelonghiAcMode.Auto;
        setTemp(TEMP_AUTO_DRY, w.fahr, true);
    }
    setFan(w.fan);
  };
  const setOnTimer = (mins: number): void => {
    const v = Math.min(TIMER_MAX, Math.max(0, mins));
    w.onM = v % 60; w.onH = Math.floor(v / 60); w.onTimer = v > 0;
  };
  const setOffTimer = (mins: number): void => {
    const v = Math.min(TIMER_MAX, Math.max(0, mins));
    w.offM = v % 60; w.offH = Math.floor(v / 60); w.offTimer = v > 0;
  };

  const fahr = !(state.celsius ?? true);
  w.power = state.power ?? false;
  setTemp(state.temp ?? 23, fahr, false);
  setMode(state.mode ?? DelonghiAcMode.Auto);
  setFan(state.fan ?? DelonghiAcFan.Auto);
  w.boost = state.boost ?? false;
  w.sleep = state.sleep ?? false;
  setOnTimer(state.onTimer ?? 0);
  setOffTimer(state.offTimer ?? 0);

  let v = BigInt(HEADER);
  v |= BigInt(w.temp) << 8n;
  v |= BigInt(w.fan) << 13n;
  v |= BigInt(w.fahr ? 1 : 0) << 15n;
  v |= BigInt(w.power ? 1 : 0) << 16n;
  v |= BigInt(w.mode) << 17n;
  v |= BigInt(w.boost ? 1 : 0) << 20n;
  v |= BigInt(w.sleep ? 1 : 0) << 21n;
  v |= BigInt(w.onTimer ? 1 : 0) << 24n;
  v |= BigInt(w.onH) << 25n;
  v |= BigInt(w.onM) << 32n;
  v |= BigInt(w.offTimer ? 1 : 0) << 40n;
  v |= BigInt(w.offH) << 41n;
  v |= BigInt(w.offM) << 48n;
  v |= BigInt(delonghiAcCalcChecksum(v)) << 56n;
  return v & MASK;
}

/** Encode a raw 64-bit Delonghi value into IR timings. */
export function encodeDelonghiAcRaw(data: bigint, repeat: number = 0): number[] {
  return sendGeneric({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: MESSAGE_GAP, data: data & MASK, nbits: DELONGHI_AC_BITS, msbFirst: false, repeat,
  });
}

/** Build + encode a Delonghi state into IR timings. */
export function sendDelonghiAc(state: DelonghiAcState, repeat: number = 0): number[] {
  return encodeDelonghiAcRaw(buildDelonghiAcRaw(state), repeat);
}

const getF = (v: bigint, pos: number, width: number): number =>
  Number((v >> BigInt(pos)) & ((1n << BigInt(width)) - 1n));

/** Parse a validated 64-bit Delonghi value into a state object. */
export function parseDelonghiAcState(v: bigint): DelonghiAcState {
  const fahr = getF(v, 15, 1) === 1;
  const onTimer = getF(v, 25, 5) * 60 + getF(v, 32, 6);
  const offTimer = getF(v, 41, 5) * 60 + getF(v, 48, 6);
  return {
    power: getF(v, 16, 1) === 1,
    mode: getF(v, 17, 3) as DelonghiAcModeValue,
    celsius: !fahr,
    temp: getF(v, 8, 5) + (fahr ? TEMP_MIN_F : TEMP_MIN_C) - 1,
    fan: getF(v, 13, 2) as DelonghiAcFanValue,
    boost: getF(v, 20, 1) === 1,
    sleep: getF(v, 21, 1) === 1,
    onTimer: getF(v, 24, 1) === 1 ? onTimer : 0,
    offTimer: getF(v, 40, 1) === 1 ? offTimer : 0,
  };
}

/**
 * Decode raw IR timings as a Delonghi A/C message (`IRrecv::decodeDelonghiAc`):
 * match a 64-bit LSB-first value and validate the checksum.
 */
export function decodeDelonghiAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): DelonghiAcState | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, DELONGHI_AC_BITS,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MESSAGE_GAP, true, kTolerance, kMarkExcess, false, headerOptional,
  );
  if (!result) return null;
  const v = result.data & MASK;
  if ((v & 0xffn) !== BigInt(HEADER)) return null;
  if (!delonghiAcValidChecksum(v)) return null;
  return parseDelonghiAcState(v);
}
