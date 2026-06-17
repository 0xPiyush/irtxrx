/**
 * Truma A/C IR protocol encoder and decoder. (TRUMA)
 *
 * Ported from IRremoteESP8266 `ir_Truma.cpp` / `ir_Truma.h` — full coverage of
 * the `IRTrumaAc` class and the `sendTruma` / `decodeTruma` wire format. Models:
 * Truma Aventa caravan/RV A/Cs.
 *
 * Wire format: a 56-bit value sent LSB-first, preceded by a long 20200/1000
 * leader and an 1800/630 header. Bits are **mark-encoded** (600µs = 1, 1200µs =
 * 0, with a constant 630µs space). byte 0 is `0x81`, byte 1's high nibble bits
 * are `0b11`, bytes 3–5 are `0xFF`; byte 6 is the checksum (5 + sum of bytes
 * 0–5).
 *
 * Quiet fan is only valid in Cool; power-off forces the mode field to Fan — both
 * reproduced from the class (its `_lastmode`/`_lastfan` latches don't affect the
 * emitted bytes given the standard setter order).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Truma.cpp
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric, matchMark, matchSpace, kMarkExcess, kTolerance } from "../decode.js";

const LDR_MARK = 20200;
const LDR_SPACE = 1000;
const HDR_MARK = 1800;
const SPACE = 630;
const ONE_MARK = 600;
const ZERO_MARK = 1200;
const FOOTER_MARK = ONE_MARK;
const GAP = 100000;

export const TRUMA_BITS = 56;
const MASK = (1n << 56n) - 1n;
const DEFAULT_STATE = 0x50ffffffe6e781n; // Off, Auto, 16C, High
const CHECKSUM_INIT = 5;

export const TrumaMode = { Auto: 0, Cool: 2, Fan: 3 } as const;
export type TrumaModeValue = (typeof TrumaMode)[keyof typeof TrumaMode];
export const TrumaFan = { Quiet: 3, High: 4, Med: 5, Low: 6 } as const;
export type TrumaFanValue = (typeof TrumaFan)[keyof typeof TrumaFan];

const TEMP_OFFSET = 10;
const TEMP_MIN = 16;
const TEMP_MAX = 31;

export interface TrumaState {
  power?: boolean;
  mode?: TrumaModeValue;
  /** Temperature in °C (16–31). */
  temp?: number;
  fan?: TrumaFanValue;
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
  return m === TrumaMode.Auto || m === TrumaMode.Cool || m === TrumaMode.Fan ? m : TrumaMode.Auto;
}

/** Checksum: `(5 + sum(bytes 0–5)) & 0xFF` (stored in byte 6). */
export function trumaCalcChecksum(value: bigint): number {
  let sum = CHECKSUM_INIT;
  for (let i = 0; i < 6; i++) sum += getF(value, i * 8, 8);
  return sum & 0xff;
}

/** Verify the byte-6 checksum of a 56-bit Truma value. */
export function trumaValidChecksum(value: bigint): boolean {
  return getF(value, 48, 8) === trumaCalcChecksum(value);
}

/**
 * Build the raw 56-bit Truma value from a state object. Power-off forces the
 * mode field to Fan; Quiet fan is honoured only in Cool (else High), matching
 * the class with the standard `setPower → setMode → setTemp → setFan` order.
 */
export function buildTrumaRaw(state: TrumaState): bigint {
  const power = state.power ?? false;
  const mode = power ? validMode(state.mode ?? TrumaMode.Auto) : TrumaMode.Fan;

  // Fan: High/Med/Low pass through; Quiet only in Cool, else stays High (the
  // reset value pre-setFan); anything else → High.
  let fan: number = state.fan ?? TrumaFan.High;
  if (fan === TrumaFan.High || fan === TrumaFan.Med || fan === TrumaFan.Low) {
    // pass through
  } else if (fan === TrumaFan.Quiet) {
    fan = mode === TrumaMode.Cool ? TrumaFan.Quiet : TrumaFan.High;
  } else {
    fan = TrumaFan.High;
  }

  let v = DEFAULT_STATE;
  v = setF(v, 8, 2, mode);
  v = setF(v, 10, 1, power ? 0 : 1); // PowerOff
  v = setF(v, 11, 3, fan);
  v = setF(v, 16, 5, clamp(state.temp ?? TEMP_MIN, TEMP_MIN, TEMP_MAX) - TEMP_OFFSET);
  v = setF(v, 48, 8, trumaCalcChecksum(v));
  return v & MASK;
}

/** Encode a raw 56-bit Truma value into IR timings (`IRsend::sendTruma`). */
export function encodeTrumaRaw(data: bigint, repeat: number = 0): number[] {
  const out: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    out.push(LDR_MARK, LDR_SPACE); // leader
    const frame = sendGeneric({
      headerMark: HDR_MARK, headerSpace: SPACE,
      oneMark: ONE_MARK, oneSpace: SPACE, zeroMark: ZERO_MARK, zeroSpace: SPACE,
      footerMark: FOOTER_MARK, gap: GAP, data: data & MASK, nbits: TRUMA_BITS, msbFirst: false,
    });
    for (const t of frame) out.push(t);
  }
  return out;
}

/** Build + encode a Truma state into IR timings. */
export function sendTruma(state: TrumaState, repeat: number = 0): number[] {
  return encodeTrumaRaw(buildTrumaRaw(state), repeat);
}

/** Parse a validated 56-bit Truma value into a state object. */
export function parseTrumaState(v: bigint): TrumaState {
  return {
    power: getF(v, 10, 1) === 0,
    mode: getF(v, 8, 2) as TrumaModeValue,
    temp: getF(v, 16, 5) + TEMP_OFFSET,
    fan: getF(v, 11, 3) as TrumaFanValue,
  };
}

/**
 * Decode raw IR timings as a Truma A/C message (`IRrecv::decodeTruma`): match the
 * leader, then a 56-bit LSB-first value, and validate the checksum.
 */
export function decodeTruma(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): TrumaState | null {
  let pos = offset;
  if (pos + 1 < timings.length &&
      matchMark(timings[pos]!, LDR_MARK) && matchSpace(timings[pos + 1]!, LDR_SPACE)) {
    pos += 2;
  } else if (!headerOptional) {
    return null;
  }
  const result = matchGeneric(
    timings, pos, timings.length - pos, TRUMA_BITS,
    HDR_MARK, SPACE, ONE_MARK, SPACE, ZERO_MARK, SPACE,
    FOOTER_MARK, GAP, true, kTolerance, kMarkExcess, false, headerOptional,
  );
  if (!result) return null;
  const v = result.data & MASK;
  if (getF(v, 0, 8) !== 0x81) return null;
  if (!trumaValidChecksum(v)) return null;
  return parseTrumaState(v);
}
