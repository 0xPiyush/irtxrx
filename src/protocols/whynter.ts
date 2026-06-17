/**
 * Whynter A/C IR protocol encoder and decoder. (WHYNTER)
 *
 * Ported from IRremoteESP8266 `ir_Whynter.cpp` (`sendWhynter` / `decodeWhynter`).
 * Models: Whynter ARC-110WD A/C.
 *
 * An opaque 32-bit code sent MSB-first. Each frame begins with a pre-header
 * (a bit-mark + zero-space) before the main 2850/2850 header; the trailing gap
 * pads the frame to a fixed ~108ms command length. The value is opaque (no
 * decodable structure), matched on timing.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Whynter.cpp
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric, matchMark, matchSpace } from "../decode.js";

const TICK = 50;
const HDR_MARK = 57 * TICK; // 2850
const HDR_SPACE = 57 * TICK; // 2850
const BIT_MARK = 15 * TICK; // 750
const ONE_SPACE = 43 * TICK; // 2150
const ZERO_SPACE = 15 * TICK; // 750
const MIN_COMMAND_LENGTH = 2160 * TICK; // 108000
const MIN_GAP =
  (2160 - (2 * (15 + 15) + 32 * (15 + 43))) * TICK; // 12200

export const WHYNTER_BITS = 32;
const MASK = (1n << 32n) - 1n;

/** Encode a 32-bit Whynter code into IR timings (`IRsend::sendWhynter`). */
export function encodeWhynter(data: bigint, repeat: number = 0): number[] {
  const out: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    out.push(BIT_MARK, ZERO_SPACE); // pre-header
    const frame = sendGeneric({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: MIN_GAP,
      mesgTime: MIN_COMMAND_LENGTH - (BIT_MARK + ZERO_SPACE),
      data: data & MASK, nbits: WHYNTER_BITS, msbFirst: true,
    });
    for (const t of frame) out.push(t);
  }
  return out;
}

/** Decode raw IR timings into a 32-bit Whynter code, or null on mismatch. */
export function decodeWhynter(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): bigint | null {
  let pos = offset;
  // Pre-header: bit-mark + zero-space (skippable when headers are optional).
  if (pos + 1 < timings.length &&
      matchMark(timings[pos]!, BIT_MARK) && matchSpace(timings[pos + 1]!, ZERO_SPACE)) {
    pos += 2;
  } else if (!headerOptional) {
    return null;
  }
  const result = matchGeneric(
    timings, pos, timings.length - pos, WHYNTER_BITS,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MIN_GAP, true, undefined, undefined, true, headerOptional,
  );
  if (!result) return null;
  return result.data & MASK;
}
