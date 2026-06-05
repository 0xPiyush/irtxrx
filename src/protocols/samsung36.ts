/**
 * Samsung 36-bit IR protocol encoder and decoder. (SAMSUNG36)
 *
 * Ported from IRremoteESP8266 `ir_Samsung.cpp` / `ir_Samsung.h`.
 * Used by Samsung Bluray/soundbar remotes (AK59-00167A, AH59-02692E, HW-J551).
 *
 * Wire format: two blocks, MSB-first. Block #1 is a 16-bit section with its own
 * header and a 4438µs inter-block gap; block #2 carries the remaining 20 bits
 * with no header. The 36-bit value is `address(16) | command(20)`.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/621
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Samsung.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 4515;
const HDR_SPACE = 4438;
const BIT_MARK = 512;
const ONE_SPACE = 1468;
const ZERO_SPACE = 490;
/** Inter-block gap closing block #1 — equal to the header space. */
const BLOCK_GAP = HDR_SPACE;
/** Trailing gap (shared with the 32-bit Samsung min-gap). */
const MIN_GAP = (193 - (8 + 8 + 32 * (1 + 3) + 1)) * 560; // 26880

export const SAMSUNG36_BITS = 36;
const BLOCK1_BITS = 16;

const MASK36 = (1n << 36n) - 1n;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Samsung36State {
  /** Full 36-bit message value (lossless; re-encoded verbatim). */
  data: bigint;
  /** Decoded 16-bit address. */
  address: number;
  /** Decoded 20-bit command. */
  command: number;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 36-bit Samsung36 value into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendSamsung36`.
 */
export function encodeSamsung36Raw(
  data: bigint,
  nbits: number = SAMSUNG36_BITS,
  repeat: number = 0,
): number[] {
  const v = data & ((1n << BigInt(nbits)) - 1n);
  const result: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    // Block #1 — 16-bit section with header + inter-block gap.
    const block1 = sendGeneric({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: BLOCK_GAP,
      data: v >> BigInt(nbits - BLOCK1_BITS), nbits: BLOCK1_BITS, msbFirst: true,
    });
    // Block #2 — the remaining bits, no header.
    const block2 = sendGeneric({
      headerMark: 0, headerSpace: 0,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: MIN_GAP,
      data: v & ((1n << BigInt(nbits - BLOCK1_BITS)) - 1n), nbits: nbits - BLOCK1_BITS, msbFirst: true,
    });
    for (const t of block1) result.push(t);
    for (const t of block2) result.push(t);
  }
  return result;
}

/** Encode a Samsung36 state into raw IR timings. */
export function sendSamsung36(state: Samsung36State, repeat: number = 0): number[] {
  return encodeSamsung36Raw(state.data & MASK36, SAMSUNG36_BITS, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Samsung36 message.
 *
 * Matches IRremoteESP8266 `IRrecv::decodeSamsung36`.
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeSamsung36(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Samsung36State | null {
  // Block #1 — header + 16 bits + inter-block gap (exact match).
  const b1 = matchGeneric(
    timings, offset, timings.length - offset, BLOCK1_BITS,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, BLOCK_GAP,
    false, undefined, undefined, true, headerOptional,
  );
  if (!b1) return null;

  // Block #2 — remaining 20 bits, no header, trailing gap (atLeast).
  const rest = SAMSUNG36_BITS - BLOCK1_BITS;
  const b2 = matchGeneric(
    timings, offset + b1.used, timings.length - offset - b1.used, rest,
    0, 0,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MIN_GAP,
    true, undefined, undefined, true, false,
  );
  if (!b2) return null;

  const data = ((b1.data << BigInt(rest)) + b2.data) & MASK36;
  return {
    data,
    address: Number(data >> BigInt(rest)),
    command: Number(data & ((1n << BigInt(rest)) - 1n)),
  };
}
