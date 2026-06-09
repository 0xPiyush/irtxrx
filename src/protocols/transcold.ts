/**
 * Transcold A/C IR protocol encoder and decoder. (TRANSCOLD)
 *
 * Ported from IRremoteESP8266 `ir_Transcold.cpp`.
 * A 24-bit value carrier. Each byte is transmitted MSB-first as a normal byte
 * immediately followed by its bit-inverse (16 transmitted bits per byte), the
 * same integrity scheme as Coolix. Bytes go out most-significant first.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266 (Transcold)
 */

import { encodeData } from "../encode.js";
import { matchMark, matchSpace, matchAtLeast } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Transcold.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 5944;
const HDR_SPACE = 7563;
const BIT_MARK = 555;
const ONE_SPACE = 3556;
const ZERO_SPACE = 1526;
const GAP = 100000; // kDefaultMessageGap

export const TRANSCOLD_BITS = 24;
const MASK24 = (1n << 24n) - 1n;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface TranscoldState {
  /** Full 24-bit message value (lossless; re-encoded verbatim). */
  data: number;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw Transcold value into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendTranscold`: header, then each byte
 * (MSB-first) sent normal + inverted, then a `mark / HdrSpace / mark / gap`
 * footer.
 */
export function encodeTranscoldRaw(
  data: number,
  nbits: number = TRANSCOLD_BITS,
  repeat: number = 0,
): number[] {
  const result: number[] = [];
  const value = BigInt(data) & MASK24;
  for (let r = 0; r <= repeat; r++) {
    result.push(HDR_MARK, HDR_SPACE);
    // Bytes most-significant first.
    for (let i = 8; i <= nbits; i += 8) {
      const segment = Number((value >> BigInt(nbits - i)) & 0xffn);
      const normal = encodeData(BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, BigInt(segment), 8, true);
      for (const t of normal) result.push(t);
      const inverted = encodeData(BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, BigInt(segment ^ 0xff), 8, true);
      for (const t of inverted) result.push(t);
    }
    // Footer: mark, long space, mark, message gap.
    result.push(BIT_MARK, HDR_SPACE, BIT_MARK, GAP);
  }
  return result;
}

/** Encode a Transcold state into raw IR timings. */
export function sendTranscold(state: TranscoldState, repeat: number = 0): number[] {
  return encodeTranscoldRaw(state.data, TRANSCOLD_BITS, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Transcold (24-bit) message.
 *
 * Reads each byte normal + inverted and validates the inversion.
 *
 * @returns Decoded state, or null on mismatch / failed inversion check.
 */
export function decodeTranscold(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): TranscoldState | null {
  let pos = offset;
  const len = timings.length;
  if (len - pos < 2 * 2 * TRANSCOLD_BITS) return null;

  // Header — optional (hardware captures may miss the leader).
  if (pos + 1 < len &&
      matchMark(timings[pos]!, HDR_MARK) && matchSpace(timings[pos + 1]!, HDR_SPACE)) {
    pos += 2;
  } else if (!headerOptional) {
    return null;
  }

  // Data: 2× the data bits (normal then inverted, alternating per byte).
  let data = 0;
  let inverted = 0;
  for (let i = 0; i < TRANSCOLD_BITS * 2; i++) {
    const flip = Math.floor(i / 8) % 2 === 1;
    if (pos >= len || !matchMark(timings[pos]!, BIT_MARK)) return null;
    pos++;
    if (pos >= len) return null;
    if (matchSpace(timings[pos]!, ONE_SPACE)) {
      if (flip) inverted = (inverted << 1) | 1; else data = (data << 1) | 1;
    } else if (matchSpace(timings[pos]!, ZERO_SPACE)) {
      if (flip) inverted = inverted << 1; else data = data << 1;
    } else {
      return null;
    }
    pos++;
  }

  // Footer: mark, long space, mark, (optional) gap.
  if (pos >= len || !matchMark(timings[pos]!, BIT_MARK)) return null;
  pos++;
  if (pos >= len || !matchSpace(timings[pos]!, HDR_SPACE)) return null;
  pos++;
  if (pos >= len || !matchMark(timings[pos]!, BIT_MARK)) return null;
  pos++;
  if (pos < len && !matchAtLeast(timings[pos]!, GAP)) return null;

  // Validate the normal/inverted integrity.
  const mask = Number(MASK24);
  if ((inverted & mask) !== ((~data) & mask)) return null;

  return { data: data & mask };
}
