/**
 * Airton A/C IR protocol encoder and decoder. (AIRTON)
 *
 * Ported from IRremoteESP8266 `ir_Airton.cpp` / `ir_Airton.h` — full coverage of
 * the `IRAirtonAc` class and the `sendAirton` / `decodeAirton` wire format.
 *
 * Wire format: a 56-bit value sent LSB-first behind a 6630/3350 header. Bytes
 * 0–1 are a fixed `0x11D3` header; byte 6 is the checksum
 * `((0x7F − sum(bytes 0–5)) & 0xFF) ^ 0x2C`. The build mirrors the class's
 * order-dependent setters (mode derives the NotAutoOn/HeatOn bits from power,
 * Auto fixes the temp, turbo forces max fan, econo only applies in Cool, sleep
 * is cleared in Auto/Fan).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Airton.cpp
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric, kMarkExcess, kTolerance } from "../decode.js";

const HDR_MARK = 6630;
const HDR_SPACE = 3350;
const BIT_MARK = 400;
const ONE_SPACE = 1260;
const ZERO_SPACE = 430;
const MESSAGE_GAP = 100000;

export const AIRTON_BITS = 56;
const MASK = (1n << 56n) - 1n;
const HEADER = 0x11d3;

export const AirtonMode = { Auto: 0, Cool: 1, Dry: 2, Fan: 3, Heat: 4 } as const;
export type AirtonModeValue = (typeof AirtonMode)[keyof typeof AirtonMode];
export const AirtonFan = { Auto: 0, Min: 1, Low: 2, Med: 3, High: 4, Max: 5 } as const;
export type AirtonFanValue = (typeof AirtonFan)[keyof typeof AirtonFan];

const MIN_TEMP = 16;
const MAX_TEMP = 31;

export interface AirtonState {
  power?: boolean;
  mode?: AirtonModeValue;
  /** Temperature in °C (16–31). Fixed at 31 in Auto mode. */
  temp?: number;
  fan?: AirtonFanValue;
  turbo?: boolean;
  swingV?: boolean;
  econo?: boolean;
  sleep?: boolean;
  health?: boolean;
  light?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Checksum: `((0x7F − sum(bytes 0–5)) & 0xFF) ^ 0x2C`. */
export function airtonCalcChecksum(value: bigint): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number((value >> BigInt(i * 8)) & 0xffn);
  return ((0x7f - sum) & 0xff) ^ 0x2c;
}

/** Verify the byte-6 checksum of a 56-bit Airton value. */
export function airtonValidChecksum(value: bigint): boolean {
  return Number((value >> 48n) & 0xffn) === airtonCalcChecksum(value);
}

/**
 * Build the raw 56-bit Airton value from a state object, mirroring the
 * `IRAirtonAc` setter sequence (setPower → setMode → setTemp → setFan → setSwingV
 * → setEcono → setTurbo → setSleep → setHealth → setLight) and its interactions.
 */
export function buildAirtonRaw(state: AirtonState): bigint {
  const w = {
    mode: 0, power: false, fan: 0, turbo: false, tempDeg: MIN_TEMP, swingV: false,
    econo: false, sleep: false, notAutoOn: false, heatOn: false, health: false, light: false,
  };

  const setTemp = (deg: number): void => {
    let t = clamp(deg, MIN_TEMP, MAX_TEMP);
    if (w.mode === AirtonMode.Auto) t = MAX_TEMP; // Auto has a fixed temp
    w.tempDeg = t;
  };
  const setFan = (s: number): void => { w.fan = s > AirtonFan.Max ? AirtonFan.Auto : s; };
  const setEcono = (on: boolean): void => { w.econo = on && w.mode === AirtonMode.Cool; };
  const setSleep = (on: boolean): void => {
    w.sleep = (w.mode === AirtonMode.Auto || w.mode === AirtonMode.Fan) ? false : on;
  };
  const setMode = (mode: number): void => {
    if (mode !== w.mode) setSleep(false); // changing mode clears sleep
    w.mode = mode > AirtonMode.Heat ? AirtonMode.Auto : mode;
    switch (w.mode) {
      case AirtonMode.Auto:
        setTemp(25);
        w.notAutoOn = !w.power;
        break;
      case AirtonMode.Heat:
        w.heatOn = w.power;
        // FALL-THRU
      default:
        w.notAutoOn = true;
    }
    setEcono(w.econo);
  };
  const setPower = (on: boolean): void => { w.power = on; setMode(w.mode); };
  const setTurbo = (on: boolean): void => { w.turbo = on; if (on) setFan(AirtonFan.Max); };

  setPower(state.power ?? false);
  setMode(state.mode ?? AirtonMode.Auto);
  setTemp(state.temp ?? 25);
  setFan(state.fan ?? AirtonFan.Auto);
  w.swingV = state.swingV ?? false;
  setEcono(state.econo ?? false);
  setTurbo(state.turbo ?? false);
  setSleep(state.sleep ?? false);
  w.health = state.health ?? false;
  w.light = state.light ?? false;

  let v = BigInt(HEADER);
  v |= BigInt(w.mode) << 16n;
  v |= BigInt(w.power ? 1 : 0) << 19n;
  v |= BigInt(w.fan) << 20n;
  v |= BigInt(w.turbo ? 1 : 0) << 23n;
  v |= BigInt(w.tempDeg - MIN_TEMP) << 24n;
  v |= BigInt(w.swingV ? 1 : 0) << 32n;
  v |= BigInt(w.econo ? 1 : 0) << 40n;
  v |= BigInt(w.sleep ? 1 : 0) << 41n;
  v |= BigInt(w.notAutoOn ? 1 : 0) << 42n;
  v |= BigInt(w.heatOn ? 1 : 0) << 44n;
  v |= BigInt(w.health ? 1 : 0) << 46n;
  v |= BigInt(w.light ? 1 : 0) << 47n;
  v |= BigInt(airtonCalcChecksum(v)) << 48n;
  return v & MASK;
}

/** Encode a raw 56-bit Airton value into IR timings (`IRsend::sendAirton`). */
export function encodeAirtonRaw(data: bigint, repeat: number = 0): number[] {
  return sendGeneric({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: MESSAGE_GAP, data: data & MASK, nbits: AIRTON_BITS, msbFirst: false, repeat,
  });
}

/** Build + encode an Airton state into IR timings. */
export function sendAirton(state: AirtonState, repeat: number = 0): number[] {
  return encodeAirtonRaw(buildAirtonRaw(state), repeat);
}

const getF = (v: bigint, pos: number, width: number): number =>
  Number((v >> BigInt(pos)) & ((1n << BigInt(width)) - 1n));

/** Parse a validated 56-bit Airton value into a state object. */
export function parseAirtonState(v: bigint): AirtonState {
  return {
    power: getF(v, 19, 1) === 1,
    mode: getF(v, 16, 3) as AirtonModeValue,
    temp: getF(v, 24, 4) + MIN_TEMP,
    fan: getF(v, 20, 3) as AirtonFanValue,
    turbo: getF(v, 23, 1) === 1,
    swingV: getF(v, 32, 1) === 1,
    econo: getF(v, 40, 1) === 1,
    sleep: getF(v, 41, 1) === 1,
    health: getF(v, 46, 1) === 1,
    light: getF(v, 47, 1) === 1,
  };
}

/**
 * Decode raw IR timings as an Airton A/C message (`IRrecv::decodeAirton`):
 * match a 56-bit LSB-first value and validate the checksum.
 */
export function decodeAirton(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): AirtonState | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, AIRTON_BITS,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MESSAGE_GAP, true, kTolerance, kMarkExcess, false, headerOptional,
  );
  if (!result) return null;
  const v = result.data & MASK;
  if ((v & 0xffffn) !== BigInt(HEADER)) return null;
  if (!airtonValidChecksum(v)) return null;
  return parseAirtonState(v);
}
