/**
 * Coolix48 IR protocol encoder and decoder.
 *
 * Ported from IRremoteESP8266 `ir_Coolix.cpp` (`sendCoolix48` /
 * `decodeCoolix48`).
 *
 * Unlike the standard 24-bit {@link CoolixState | Coolix} protocol — which sends
 * each data byte followed by its bitwise inverse — Coolix48 is a plain 48-bit
 * value sent MSB-first with the same header/bit/footer timings and **no
 * integrity structure**. It carries no decodable appliance state; the value is
 * an opaque 48-bit code, so it is matched purely on timing.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Coolix.cpp
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — identical to ir_Coolix.h (shared with the 24-bit variant)
// ---------------------------------------------------------------------------

const COOLIX_TICK = 276;
const COOLIX_HDR_MARK = 17 * COOLIX_TICK;  // 4692
const COOLIX_HDR_SPACE = 16 * COOLIX_TICK; // 4416
const COOLIX_BIT_MARK = 2 * COOLIX_TICK;   // 552
const COOLIX_ONE_SPACE = 6 * COOLIX_TICK;  // 1656
const COOLIX_ZERO_SPACE = 2 * COOLIX_TICK; // 552
const COOLIX_MIN_GAP = 19 * COOLIX_TICK;   // 5244
/** 25% default + 5% extra, matching kCoolixExtraTolerance in C++. */
const COOLIX_TOLERANCE = 30;

/** Number of data bits in a Coolix48 frame. */
export const COOLIX48_BITS = 48;

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a 48-bit Coolix48 code into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendCoolix48`. The default repeat (1)
 * mirrors `kCoolixDefaultRepeat`.
 *
 * @param data   48-bit code (only the low 48 bits are used).
 * @param repeat Number of additional frame repeats (default 1).
 */
export function encodeCoolix48(data: bigint, repeat: number = 1): number[] {
  return sendGeneric({
    headerMark: COOLIX_HDR_MARK,
    headerSpace: COOLIX_HDR_SPACE,
    oneMark: COOLIX_BIT_MARK,
    oneSpace: COOLIX_ONE_SPACE,
    zeroMark: COOLIX_BIT_MARK,
    zeroSpace: COOLIX_ZERO_SPACE,
    footerMark: COOLIX_BIT_MARK,
    gap: COOLIX_MIN_GAP,
    data: data & ((1n << 48n) - 1n),
    nbits: COOLIX48_BITS,
    msbFirst: true,
    repeat,
  });
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings into a 48-bit Coolix48 code.
 *
 * Coolix48 has no checksum or inversion parity, so a match is established
 * purely from the header/bit/footer timing structure.
 *
 * @param timings        Raw mark/space timing array in microseconds.
 * @param offset         Starting index in the timings array (default 0).
 * @param headerOptional Allow a missing header (hardware captures often drop it).
 * @returns The 48-bit code, or null on mismatch.
 */
export function decodeCoolix48(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): bigint | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, COOLIX48_BITS,
    COOLIX_HDR_MARK, COOLIX_HDR_SPACE,
    COOLIX_BIT_MARK, COOLIX_ONE_SPACE,
    COOLIX_BIT_MARK, COOLIX_ZERO_SPACE,
    COOLIX_BIT_MARK, COOLIX_MIN_GAP,
    true, COOLIX_TOLERANCE, 0, true, headerOptional,
  );
  if (!result) return null;
  return result.data & ((1n << 48n) - 1n);
}
