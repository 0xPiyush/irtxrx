/**
 * Argo A/C IR protocol encoder and decoder — WREM-2 remote. (ARGO)
 *
 * Ported from IRremoteESP8266 `ir_Argo.cpp` / `ir_Argo.h` (`IRArgoAC`,
 * `sendArgo` / `decodeArgo`). Models the Argo Ulisse 13 DCI with the WREM-2
 * remote. (The newer WREM-3 remote is a separate protocol — see `argo_wrem3`.)
 *
 * Wire format: a 12-byte (96-bit) A/C-control message sent LSB-first behind a
 * 6400/3300 header with **no footer** (the bits' last space terminates it).
 * Bytes 0–1 are fixed preamble `0xAC 0xF5`; many fields **straddle byte
 * boundaries** (Temp, RoomTemp, the checksum). The checksum is `(sum(bytes
 * 0–9) + 2) & 0xFF` stored in the `Sum` field, with a constant `Post = 0b10`.
 *
 * A separate 4-byte "iFeel" sensor-temperature report (`sendArgoSensorTemp`) is
 * also supported, using a split CheckHi/CheckLo integrity field.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Argo.cpp
 */

import { encodeData, sumBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

const HDR_MARK = 6400;
const HDR_SPACE = 3300;
const BIT_MARK = 400;
const ONE_SPACE = 2200;
const ZERO_SPACE = 900;

export const ARGO_STATE_LENGTH = 12;
const SHORT_STATE_LENGTH = 4;

const PREAMBLE1 = 0xac; // kArgoPreamble1 (0b10101100)
const PREAMBLE2 = 0xf5; // kArgoPreamble2 (0b11110101)
const POST = 0b10; // kArgoPost
const SENSOR_CHECK = 52;
const SENSOR_FIXED = 0b011;

/** WREM-2 operating modes (raw field values). */
export const ArgoMode = { Cool: 0, Dry: 1, Auto: 2, Off: 3, Heat: 4, HeatAuto: 5 } as const;
export type ArgoModeValue = (typeof ArgoMode)[keyof typeof ArgoMode];
/** WREM-2 fan speeds (raw). */
export const ArgoFan = { Auto: 0, Min: 1, Med: 2, Max: 3 } as const;
export type ArgoFanValue = (typeof ArgoFan)[keyof typeof ArgoFan];
/** Flap / vertical-swing positions (0 = auto, 1 = highest … 6 = lowest, 7 = full). */
export const ArgoFlap = { Auto: 0, Pos1: 1, Pos2: 2, Pos3: 3, Pos4: 4, Pos5: 5, Pos6: 6, Full: 7 } as const;
export type ArgoFlapValue = (typeof ArgoFlap)[keyof typeof ArgoFlap];

const TEMP_MIN = 10;
const TEMP_MAX = 32;
const TEMP_DELTA = 4;
const ROOM_TEMP_MAX = 35;

export interface ArgoState {
  power?: boolean;
  mode?: ArgoModeValue;
  /** Temperature in °C (10–32). */
  temp?: number;
  fan?: ArgoFanValue;
  /** Flap / vertical swing position. */
  flap?: ArgoFlapValue;
  /** Reported room (ambient) temperature in °C (4–35). */
  roomTemp?: number;
  /** Max / Turbo. */
  max?: boolean;
  /** Night / Sleep. */
  night?: boolean;
  iFeel?: boolean;
  /**
   * If set, build a standalone 4-byte iFeel sensor-temperature report (°C 4–35)
   * instead of the A/C-control message — mirrors `IRArgoAC::sendSensorTemp`.
   */
  sensorReport?: number;
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
function toBytes(v: bigint, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Number((v >> BigInt(i * 8)) & 0xffn);
  return out;
}
function fromBytes(raw: Uint8Array): bigint {
  let v = 0n;
  for (let i = 0; i < raw.length; i++) v |= BigInt(raw[i]!) << BigInt(i * 8);
  return v;
}

/** WREM-2 A/C-control checksum: `(sum(bytes 0–9) + 2) & 0xFF`. */
export function argoCalcChecksum(raw: Uint8Array): number {
  return (sumBytes(raw, 0, ARGO_STATE_LENGTH - 2) + POST) & 0xff;
}

/** Verify the checksum (Sum field at bits 82–89) of a 12-byte WREM-2 state. */
export function argoValidChecksum(raw: Uint8Array): boolean {
  return getF(fromBytes(raw), 82, 8) === argoCalcChecksum(raw);
}

/** Build the raw 4-byte WREM-2 iFeel sensor-temperature report. */
export function buildArgoSensorRaw(degrees: number): Uint8Array {
  const temp = clamp(degrees, TEMP_DELTA, ROOM_TEMP_MAX) - TEMP_DELTA;
  const check = SENSOR_CHECK + temp;
  let v = 0n;
  v = setF(v, 0, 8, PREAMBLE1);
  v = setF(v, 8, 8, PREAMBLE2);
  v = setF(v, 16, 3, check >> 5); // CheckHi
  v = setF(v, 19, 5, temp); // SensorT
  v = setF(v, 24, 3, SENSOR_FIXED); // Fixed
  v = setF(v, 27, 5, check & 0x1f); // CheckLo
  return toBytes(v, SHORT_STATE_LENGTH);
}

/** Build the raw 12-byte WREM-2 A/C-control state from a state object. */
export function buildArgoRaw(state: ArgoState): Uint8Array {
  if (state.sensorReport !== undefined) return buildArgoSensorRaw(state.sensorReport);

  let v = 0n;
  v = setF(v, 0, 8, PREAMBLE1);
  v = setF(v, 8, 8, PREAMBLE2);
  v = setF(v, 19, 3, state.mode ?? ArgoMode.Auto); // Mode
  v = setF(v, 22, 5, clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_DELTA); // Temp (straddles)
  v = setF(v, 27, 2, Math.min(state.fan ?? ArgoFan.Auto, ArgoFan.Max)); // Fan
  v = setF(v, 29, 5, clamp(state.roomTemp ?? TEMP_DELTA, TEMP_DELTA, ROOM_TEMP_MAX) - TEMP_DELTA); // RoomTemp (straddles)
  v = setF(v, 34, 3, (state.flap ?? ArgoFlap.Auto) & 0b111); // Flap
  v = setF(v, 74, 1, (state.night ?? false) ? 1 : 0); // Night
  v = setF(v, 75, 1, (state.max ?? false) ? 1 : 0); // Max
  v = setF(v, 77, 1, (state.power ?? false) ? 1 : 0); // Power
  v = setF(v, 79, 1, (state.iFeel ?? false) ? 1 : 0); // iFeel

  // Checksum over bytes 0–9, then the Post + Sum fields (bytes 10–11).
  const sum = argoCalcChecksum(toBytes(v, ARGO_STATE_LENGTH));
  v = setF(v, 80, 2, POST); // Post
  v = setF(v, 82, 8, sum); // Sum (straddles bytes 10–11)
  return toBytes(v, ARGO_STATE_LENGTH);
}

/**
 * Encode a raw Argo WREM-2 state (12-byte A/C control or 4-byte iFeel) into IR
 * timings: header + data, LSB-first, **no footer** (`IRsend::sendArgo`).
 */
export function encodeArgoRaw(raw: Uint8Array, repeat: number = 0): number[] {
  const out: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    out.push(HDR_MARK, HDR_SPACE);
    for (let i = 0; i < raw.length; i++) {
      for (const t of encodeData(BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, BigInt(raw[i]!), 8, false)) out.push(t);
    }
  }
  return out;
}

/** Build + encode an Argo WREM-2 state into IR timings. */
export function sendArgo(state: ArgoState, repeat: number = 0): number[] {
  return encodeArgoRaw(buildArgoRaw(state), repeat);
}

/** Build + encode a standalone iFeel sensor-temperature report. */
export function sendArgoSensorTemp(degrees: number, repeat: number = 0): number[] {
  return encodeArgoRaw(buildArgoSensorRaw(degrees), repeat);
}

/** Parse a validated 12-byte WREM-2 A/C-control state into a state object. */
export function parseArgoState(raw: Uint8Array): ArgoState {
  const v = fromBytes(raw);
  return {
    power: getF(v, 77, 1) === 1,
    mode: getF(v, 19, 3) as ArgoModeValue,
    temp: getF(v, 22, 5) + TEMP_DELTA,
    fan: getF(v, 27, 2) as ArgoFanValue,
    flap: getF(v, 34, 3) as ArgoFlapValue,
    roomTemp: getF(v, 29, 5) + TEMP_DELTA,
    max: getF(v, 75, 1) === 1,
    night: getF(v, 74, 1) === 1,
    iFeel: getF(v, 79, 1) === 1,
  };
}

/**
 * Decode raw IR timings as an Argo WREM-2 A/C-control message
 * (`IRrecv::decodeArgo`): match the header + 12 LSB-first bytes (no footer) and
 * validate the checksum + fixed preamble.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeArgo(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): ArgoState | null {
  const result = matchGenericBytes(
    timings, offset, timings.length - offset, ARGO_STATE_LENGTH,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    0, 0, false, undefined, 0, false, headerOptional,
  );
  if (!result) return null;
  if (result.data[0] !== PREAMBLE1 || result.data[1] !== PREAMBLE2) return null;
  if (!argoValidChecksum(result.data)) return null;
  return parseArgoState(result.data);
}
