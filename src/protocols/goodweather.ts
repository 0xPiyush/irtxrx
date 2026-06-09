/**
 * Goodweather A/C IR protocol encoder and decoder. (GOODWEATHER)
 *
 * Ported from IRremoteESP8266 `ir_Goodweather.cpp`.
 * A 48-bit value carrier. Bytes go out least-significant first, and each byte
 * is transmitted LSB-first as a normal byte immediately followed by its
 * bit-inverse (16 transmitted bits per byte). Note the unusual timing: a `1`
 * bit has the SHORT space (580µs) and a `0` bit the LONG space (1860µs).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266 (Goodweather)
 */

import { encodeData } from "../encode.js";
import { matchData, matchMark, matchSpace, matchAtLeast } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Goodweather.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 6820;
const HDR_SPACE = 6820;
const BIT_MARK = 580;
const ONE_SPACE = 580;
const ZERO_SPACE = 1860;
const GAP = 100000; // kDefaultMessageGap
const TOLERANCE = 37; // _tolerance(25) + kGoodweatherExtraTolerance(12)

export const GOODWEATHER_BITS = 48;
const MASK48 = (1n << 48n) - 1n;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface GoodweatherState {
  /** Full 48-bit message value (lossless; re-encoded verbatim). */
  data: bigint;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw Goodweather value into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendGoodweather`: header, then each byte
 * (LSB-first byte order) sent normal + inverted LSB-first, then a
 * `mark / HdrSpace / mark / gap` footer.
 */
export function encodeGoodweatherRaw(
  data: bigint,
  nbits: number = GOODWEATHER_BITS,
  repeat: number = 0,
): number[] {
  const result: number[] = [];
  const value = data & MASK48;
  for (let r = 0; r <= repeat; r++) {
    result.push(HDR_MARK, HDR_SPACE);
    // Bytes least-significant first; each byte normal then inverted, LSB-first.
    for (let i = 0; i < nbits; i += 8) {
      const chunk = Number((value >> BigInt(i)) & 0xffn);
      const normal = encodeData(BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, BigInt(chunk), 8, false);
      for (const t of normal) result.push(t);
      const inverted = encodeData(BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, BigInt(chunk ^ 0xff), 8, false);
      for (const t of inverted) result.push(t);
    }
    // Footer: mark, long space, mark, message gap.
    result.push(BIT_MARK, HDR_SPACE, BIT_MARK, GAP);
  }
  return result;
}

/** Encode a Goodweather state into raw IR timings. */
export function sendGoodweather(state: GoodweatherState, repeat: number = 0): number[] {
  return encodeGoodweatherRaw(state.data, GOODWEATHER_BITS, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Goodweather (48-bit) message.
 *
 * Reads each byte normal + inverted (LSB-first) and validates the inversion.
 *
 * @returns Decoded state, or null on mismatch / failed inversion check.
 */
export function decodeGoodweather(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): GoodweatherState | null {
  let pos = offset;
  const len = timings.length;
  if (len - pos < 2 * (2 * GOODWEATHER_BITS)) return null;

  // Header — optional (hardware captures may miss the leader).
  if (pos + 1 < len &&
      matchMark(timings[pos]!, HDR_MARK, TOLERANCE) && matchSpace(timings[pos + 1]!, HDR_SPACE, TOLERANCE)) {
    pos += 2;
  } else if (!headerOptional) {
    return null;
  }

  let value = 0n;
  let bitsSoFar = 0;
  while (bitsSoFar < GOODWEATHER_BITS) {
    // Normal byte (LSB-first).
    const normal = matchData(timings, pos, 8, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, TOLERANCE, undefined, false);
    if (!normal.success) return null;
    pos += normal.used;
    const byte = Number(normal.data & 0xffn);
    // Inverted byte (LSB-first).
    const inv = matchData(timings, pos, 8, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, TOLERANCE, undefined, false);
    if (!inv.success) return null;
    pos += inv.used;
    if (byte !== (Number(inv.data & 0xffn) ^ 0xff)) return null;
    value |= BigInt(byte) << BigInt(bitsSoFar);
    bitsSoFar += 8;
  }

  // Footer: mark, long space, mark, (optional) gap.
  if (pos >= len || !matchMark(timings[pos]!, BIT_MARK, TOLERANCE)) return null;
  pos++;
  if (pos >= len || !matchSpace(timings[pos]!, HDR_SPACE)) return null;
  pos++;
  if (pos >= len || !matchMark(timings[pos]!, BIT_MARK, TOLERANCE)) return null;
  pos++;
  if (pos < len && !matchAtLeast(timings[pos]!, HDR_SPACE)) return null;

  return { data: value & MASK48 };
}
