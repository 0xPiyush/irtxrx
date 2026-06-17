/**
 * Amcor A/C IR protocol encoder and decoder. (AMCOR)
 *
 * Ported from IRremoteESP8266 `ir_Amcor.cpp` / `ir_Amcor.h` — full coverage of
 * the `IRAmcorAc` class and the `sendAmcor` / `decodeAmcor` wire format.
 *
 * Wire format: an 8-byte (64-bit) state sent LSB-first behind an 8200/4200
 * header; bits are mark-encoded (1500/600 vs 600/1500 mark/space). byte 0 is a
 * `0x01` header; byte 7 is a nibble-sum checksum of bytes 0–6. The "Max" boost
 * is only valid in Cool/Heat (forcing temp to the extreme), and Fan mode sets a
 * "Vent" flag — both reproduced from the class.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Amcor.cpp
 */

import { sendGenericBytes, sumNibbles } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

const HDR_MARK = 8200;
const HDR_SPACE = 4200;
const ONE_MARK = 1500;
const ZERO_MARK = 600;
const ONE_SPACE = ZERO_MARK; // 600
const ZERO_SPACE = ONE_MARK; // 1500
const FOOTER_MARK = 1900;
const GAP = 34300;
const TOLERANCE = 40; // kAmcorTolerance (%)

export const AMCOR_STATE_LENGTH = 8;

export const AmcorMode = { Cool: 0b001, Heat: 0b010, Fan: 0b011, Dry: 0b100, Auto: 0b101 } as const;
export type AmcorModeValue = (typeof AmcorMode)[keyof typeof AmcorMode];
export const AmcorFan = { Min: 0b001, Med: 0b010, Max: 0b011, Auto: 0b100 } as const;
export type AmcorFanValue = (typeof AmcorFan)[keyof typeof AmcorFan];

const TEMP_MIN = 12;
const TEMP_MAX = 32;
const POWER_ON = 0b0011;
const POWER_OFF = 0b1100;
const MAX_ON = 0b11;
const VENT_ON = 0b11;

export interface AmcorState {
  power?: boolean;
  mode?: AmcorModeValue;
  /** Temperature in °C (12–32). */
  temp?: number;
  fan?: AmcorFanValue;
  /** Max/boost — only honoured in Cool/Heat (forces temp to the extreme). */
  max?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
function getBits(raw: Uint8Array, idx: number, off: number, size: number): number {
  return (raw[idx]! >> off) & ((1 << size) - 1);
}
function setBits(raw: Uint8Array, idx: number, off: number, size: number, val: number): void {
  const mask = ((1 << size) - 1) << off;
  raw[idx] = (raw[idx]! & ~mask) | ((val << off) & mask);
}

/** Verify the byte-7 nibble-sum checksum of an 8-byte Amcor state. */
export function amcorValidChecksum(raw: Uint8Array): boolean {
  return raw[AMCOR_STATE_LENGTH - 1] === sumNibbles(raw, 0, AMCOR_STATE_LENGTH - 1);
}

function isMode(m: number | undefined): boolean {
  return m === AmcorMode.Cool || m === AmcorMode.Heat || m === AmcorMode.Fan ||
    m === AmcorMode.Dry || m === AmcorMode.Auto;
}
function isFan(f: number | undefined): boolean {
  return f === AmcorFan.Min || f === AmcorFan.Med || f === AmcorFan.Max || f === AmcorFan.Auto;
}

/** Build the raw 8-byte Amcor state (mirrors `stateReset` + setters). */
export function buildAmcorRaw(state: AmcorState): Uint8Array {
  const raw = new Uint8Array(AMCOR_STATE_LENGTH);
  raw[0] = 0x01;

  const mode = isMode(state.mode) ? state.mode! : AmcorMode.Auto;
  setBits(raw, 1, 0, 3, mode); // Mode
  setBits(raw, 6, 6, 2, mode === AmcorMode.Fan ? VENT_ON : 0); // Vent
  setBits(raw, 5, 4, 4, (state.power ?? false) ? POWER_ON : POWER_OFF); // Power
  setBits(raw, 1, 4, 3, isFan(state.fan) ? state.fan! : AmcorFan.Auto); // Fan

  // Temp + Max: Max only valid in Cool/Heat (forces the temp extreme).
  let temp = clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX);
  let max = false;
  if (state.max) {
    if (mode === AmcorMode.Cool) { temp = TEMP_MIN; max = true; }
    else if (mode === AmcorMode.Heat) { temp = TEMP_MAX; max = true; }
  }
  setBits(raw, 2, 1, 6, temp); // Temp
  setBits(raw, 6, 0, 2, max ? MAX_ON : 0); // Max

  raw[7] = sumNibbles(raw, 0, AMCOR_STATE_LENGTH - 1);
  return raw;
}

/** Encode a raw 8-byte Amcor state into IR timings (`IRsend::sendAmcor`). */
export function encodeAmcorRaw(raw: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: ONE_MARK, oneSpace: ONE_SPACE, zeroMark: ZERO_MARK, zeroSpace: ZERO_SPACE,
    footerMark: FOOTER_MARK, gap: GAP, data: raw, msbFirst: false, repeat,
  });
}

/** Build + encode an Amcor state into IR timings. */
export function sendAmcor(state: AmcorState, repeat: number = 0): number[] {
  return encodeAmcorRaw(buildAmcorRaw(state), repeat);
}

/** Parse a validated 8-byte Amcor state. */
export function parseAmcorState(raw: Uint8Array): AmcorState {
  return {
    power: getBits(raw, 5, 4, 4) === POWER_ON,
    mode: getBits(raw, 1, 0, 3) as AmcorModeValue,
    temp: getBits(raw, 2, 1, 6),
    fan: getBits(raw, 1, 4, 3) as AmcorFanValue,
    max: getBits(raw, 6, 0, 2) === MAX_ON,
  };
}

/**
 * Decode raw IR timings as an Amcor A/C message (`IRrecv::decodeAmcor`): match
 * the header + 8 LSB-first bytes + footer, then validate the nibble-sum checksum.
 */
export function decodeAmcor(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): AmcorState | null {
  const result = matchGenericBytes(
    timings, offset, timings.length - offset, AMCOR_STATE_LENGTH,
    HDR_MARK, HDR_SPACE, ONE_MARK, ONE_SPACE, ZERO_MARK, ZERO_SPACE,
    FOOTER_MARK, GAP, true, TOLERANCE, 0, false, headerOptional,
  );
  if (!result) return null;
  if (result.data[0] !== 0x01) return null;
  if (!amcorValidChecksum(result.data)) return null;
  return parseAmcorState(result.data);
}
