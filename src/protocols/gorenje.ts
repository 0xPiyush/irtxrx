/**
 * Gorenje cooker-hood IR protocol encoder and decoder. (GORENJE)
 *
 * Ported from IRremoteESP8266 `ir_Gorenje.cpp` (`sendGorenje` / `decodeGorenje`).
 * Models: Gorenje DKF 2600 MWT cooker hood.
 *
 * An opaque 8-bit code sent MSB-first with **no header** (1300µs bit-mark,
 * 5700/1700µs one/zero spaces, 0.1s gap, 7% tolerance). It carries no decodable
 * appliance state — the value is an opaque button code matched on timing.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Gorenje.cpp
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

const BIT_MARK = 1300;
const ONE_SPACE = 5700;
const ZERO_SPACE = 1700;
const MIN_GAP = 100000;
const TOLERANCE = 7; // kGorenjeTolerance (%)

export const GORENJE_BITS = 8;
const MASK = (1n << 8n) - 1n;

/** Encode an 8-bit Gorenje code into IR timings (`IRsend::sendGorenje`). */
export function encodeGorenje(data: bigint, repeat: number = 0): number[] {
  return sendGeneric({
    headerMark: 0, headerSpace: 0,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: MIN_GAP, data: data & MASK, nbits: GORENJE_BITS, msbFirst: true, repeat,
  });
}

/** Decode raw IR timings into an 8-bit Gorenje code, or null on mismatch. */
export function decodeGorenje(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): bigint | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, GORENJE_BITS,
    0, 0, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MIN_GAP, true, TOLERANCE, 0, true, headerOptional,
  );
  if (!result) return null;
  return result.data & MASK;
}
