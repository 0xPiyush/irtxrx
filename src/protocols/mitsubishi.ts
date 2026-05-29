/**
 * Mitsubishi 16-bit (TV) IR protocol encoder and decoder.
 *
 * Ported from IRremoteESP8266 `ir_Mitsubishi.cpp` (`sendMitsubishi` /
 * `decodeMitsubishi`). A headerless 16-bit value sent MSB-first, padded to a
 * minimum command length. No checksum (timing match only).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Mitsubishi.cpp
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

const MITSUBISHI_TICK = 30;
const MITSUBISHI_BIT_MARK = 10 * MITSUBISHI_TICK;  // 300
const MITSUBISHI_ONE_SPACE = 70 * MITSUBISHI_TICK; // 2100
const MITSUBISHI_ZERO_SPACE = 30 * MITSUBISHI_TICK; // 900
const MITSUBISHI_MIN_COMMAND_LEN = 1786 * MITSUBISHI_TICK; // 53580
const MITSUBISHI_MIN_GAP = 936 * MITSUBISHI_TICK;  // 28080
const MITSUBISHI_TOLERANCE = 30;

export const MITSUBISHI_BITS = 16;

/** A decoded Mitsubishi TV code. */
export interface MitsubishiState {
  /** 16-bit command value. */
  value: number;
}

/** Encode a raw 16-bit Mitsubishi TV value into IR timings. */
export function encodeMitsubishiRaw(value: number, repeat: number = 1): number[] {
  return sendGeneric({
    headerMark: 0,
    headerSpace: 0,
    oneMark: MITSUBISHI_BIT_MARK,
    oneSpace: MITSUBISHI_ONE_SPACE,
    zeroMark: MITSUBISHI_BIT_MARK,
    zeroSpace: MITSUBISHI_ZERO_SPACE,
    footerMark: MITSUBISHI_BIT_MARK,
    gap: MITSUBISHI_MIN_GAP,
    mesgTime: MITSUBISHI_MIN_COMMAND_LEN,
    data: BigInt(value & 0xffff),
    nbits: MITSUBISHI_BITS,
    msbFirst: true,
    repeat,
  });
}

/** Encode a Mitsubishi TV state into IR timings. */
export function sendMitsubishi(state: MitsubishiState, repeat: number = 1): number[] {
  return encodeMitsubishiRaw(state.value, repeat);
}

/**
 * Decode raw IR timings as a Mitsubishi TV code.
 *
 * @returns The decoded 16-bit value, or null on mismatch.
 */
export function decodeMitsubishi(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): MitsubishiState | null {
  void headerOptional; // headerless protocol — parameter kept for signature parity
  const result = matchGeneric(
    timings, offset, timings.length - offset, MITSUBISHI_BITS,
    0, 0,
    MITSUBISHI_BIT_MARK, MITSUBISHI_ONE_SPACE,
    MITSUBISHI_BIT_MARK, MITSUBISHI_ZERO_SPACE,
    MITSUBISHI_BIT_MARK, MITSUBISHI_MIN_GAP,
    true, MITSUBISHI_TOLERANCE, 0, true,
  );
  if (!result) return null;
  return { value: Number(result.data & 0xffffn) };
}
