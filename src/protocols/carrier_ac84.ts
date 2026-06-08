/**
 * Carrier 84-bit HVAC IR protocol encoder and decoder. (CARRIER_AC84)
 *
 * Ported from IRremoteESP8266 `ir_Carrier.cpp`.
 * An 84-bit message (a leading 4-bit nibble followed by ten bytes) using a
 * constant-bit-time encoding: a `1` bit is a 1175µs mark + 430µs space, a `0`
 * bit is a 430µs mark + 1175µs space. IRremoteESP8266 provides no field-level
 * class, so it is modelled as a raw 11-byte payload (only the low nibble of
 * byte 0 is carried).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1943
 */

import { encodeData } from "../encode.js";
import { matchMark, matchSpace, matchData, matchAtLeast } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Carrier.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 5850;
const ZERO = 1175; // kCarrierAc84Zero — the "long" pulse
const ONE = 430; // kCarrierAc84One — the "short" pulse
const HDR_SPACE = ZERO;
const GAP = 100000; // kDefaultMessageGap
const EXTRA_BITS = 4; // low nibble of byte 0
const TOLERANCE = 30; // _tolerance (25) + kCarrierAc84ExtraTolerance (5)

// A "1" bit: mark ZERO + space ONE. A "0" bit: mark ONE + space ZERO.
const ONE_MARK = ZERO;
const ONE_SPACE = ONE;
const ZERO_MARK = ONE;
const ZERO_SPACE = ZERO;

export const CARRIER_AC84_STATE_LENGTH = 11;

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 11-byte Carrier AC84 payload into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendCarrierAC84` (LSB-first, 4-bit lead-in).
 */
export function encodeCarrierAc84Raw(data: Uint8Array, repeat: number = 0): number[] {
  const result: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    result.push(HDR_MARK, HDR_SPACE);
    // Leading 4 bits (low nibble of byte 0).
    for (const t of encodeData(ONE_MARK, ONE_SPACE, ZERO_MARK, ZERO_SPACE, BigInt(data[0]! & 0xf), EXTRA_BITS, false)) result.push(t);
    // The remaining whole bytes.
    for (let i = 1; i < data.length; i++) {
      for (const t of encodeData(ONE_MARK, ONE_SPACE, ZERO_MARK, ZERO_SPACE, BigInt(data[i]!), 8, false)) result.push(t);
    }
    result.push(ZERO); // footer mark (kCarrierAc84Zero)
    result.push(GAP);
  }
  return result;
}

/** Encode a Carrier AC84 raw payload into IR timings. */
export function sendCarrierAc84(data: Uint8Array, repeat: number = 0): number[] {
  return encodeCarrierAc84Raw(data, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Carrier AC84 (11-byte) message.
 *
 * Matches IRremoteESP8266 `IRrecv::decodeCarrierAC84`. There is no checksum.
 *
 * @returns The decoded 11-byte payload, or null on mismatch.
 */
export function decodeCarrierAc84(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Uint8Array | null {
  let pos = offset;

  let hasHeader = false;
  if (pos + 1 < timings.length &&
      matchMark(timings[pos]!, HDR_MARK, TOLERANCE) && matchSpace(timings[pos + 1]!, HDR_SPACE, TOLERANCE)) {
    pos += 2;
    hasHeader = true;
  }
  if (!hasHeader && !headerOptional) return null;

  const out = new Uint8Array(CARRIER_AC84_STATE_LENGTH);

  // Leading nibble. C++ decodeCarrierAC84 uses the global mark-excess (50µs).
  const nibble = matchData(timings, pos, EXTRA_BITS, ONE_MARK, ONE_SPACE, ZERO_MARK, ZERO_SPACE, TOLERANCE, undefined, false, true);
  if (!nibble.success) return null;
  out[0] = Number(nibble.data & 0xfn);
  pos += nibble.used;

  // The remaining whole bytes.
  for (let i = 1; i < CARRIER_AC84_STATE_LENGTH; i++) {
    const b = matchData(timings, pos, 8, ONE_MARK, ONE_SPACE, ZERO_MARK, ZERO_SPACE, TOLERANCE, undefined, false, true);
    if (!b.success) return null;
    out[i] = Number(b.data & 0xffn);
    pos += b.used;
  }

  // Footer mark (+ optional trailing gap).
  if (pos >= timings.length || !matchMark(timings[pos]!, ZERO, TOLERANCE)) return null;
  pos++;
  if (pos < timings.length && !matchAtLeast(timings[pos]!, GAP, TOLERANCE)) return null;

  return out;
}
