/**
 * Carrier 40-bit HVAC IR protocol encoder and decoder. (CARRIER_AC40)
 *
 * Ported from IRremoteESP8266 `ir_Carrier.cpp` / `ir_Carrier.h`.
 * A plain 40-bit value carrier with no checksum or internal structure.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1190
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Carrier.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 8402;
const HDR_SPACE = 4166;
const BIT_MARK = 547;
const ONE_SPACE = 1540;
const ZERO_SPACE = 497;
const GAP = 150000;

export const CARRIER_AC40_BITS = 40;
const MASK40 = (1n << 40n) - 1n;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface CarrierAc40State {
  /** Full 40-bit message value (lossless; re-encoded verbatim). */
  data: bigint;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 40-bit Carrier value into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendCarrierAC40`.
 */
export function encodeCarrierAc40Raw(
  data: bigint,
  nbits: number = CARRIER_AC40_BITS,
  repeat: number = 2, // kCarrierAc40MinRepeat
): number[] {
  return sendGeneric({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP,
    data: data & MASK40, nbits, msbFirst: true, repeat,
  });
}

/** Encode a Carrier 40-bit state into raw IR timings. */
export function sendCarrierAc40(state: CarrierAc40State, repeat: number = 2): number[] {
  return encodeCarrierAc40Raw(state.data & MASK40, CARRIER_AC40_BITS, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Carrier 40-bit message.
 *
 * Matches IRremoteESP8266 `IRrecv::decodeCarrierAC40`. There is no checksum, so
 * the match is timing-only.
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeCarrierAc40(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): CarrierAc40State | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, CARRIER_AC40_BITS,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, true, headerOptional,
  );
  if (!result) return null;
  return { data: result.data & MASK40 };
}
