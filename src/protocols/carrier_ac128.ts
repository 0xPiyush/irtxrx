/**
 * Carrier 128-bit HVAC IR protocol encoder and decoder. (CARRIER_AC128)
 *
 * Ported from IRremoteESP8266 `ir_Carrier.cpp`.
 * A 16-byte message sent in two 8-byte sections with distinct section headers,
 * an inter-section marker pair, and a trailing footer mark. IRremoteESP8266
 * provides no field-level class for this protocol, so it is modelled as a raw
 * byte payload.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1797
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes, matchMark, matchSpace, matchAtLeast } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Carrier.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 4600;
const HDR_SPACE = 2600;
const HDR2_MARK = 9300;
const HDR2_SPACE = 5000;
const BIT_MARK = 340;
const ONE_SPACE = 1000;
const ZERO_SPACE = 400;
const SECTION_GAP = 20600;
const INTER_SPACE = 6700;
const MESSAGE_GAP = 100000;

export const CARRIER_AC128_STATE_LENGTH = 16;
const SECTION_LENGTH = CARRIER_AC128_STATE_LENGTH / 2;

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 16-byte Carrier AC128 payload into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendCarrierAC128` (LSB-first, two sections).
 */
export function encodeCarrierAc128Raw(data: Uint8Array, repeat: number = 0): number[] {
  const result: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    const s1 = sendGenericBytes({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: SECTION_GAP,
      data: data.subarray(0, SECTION_LENGTH), msbFirst: false,
    });
    for (const t of s1) result.push(t);
    // Inter-section markers.
    result.push(HDR_MARK, INTER_SPACE);
    const s2 = sendGenericBytes({
      headerMark: HDR2_MARK, headerSpace: HDR2_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: SECTION_GAP,
      data: data.subarray(SECTION_LENGTH), msbFirst: false,
    });
    for (const t of s2) result.push(t);
    // Footer.
    result.push(HDR_MARK, MESSAGE_GAP);
  }
  return result;
}

/** Encode a Carrier AC128 raw payload into IR timings. */
export function sendCarrierAc128(data: Uint8Array, repeat: number = 0): number[] {
  return encodeCarrierAc128Raw(data, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Carrier AC128 (16-byte) message.
 *
 * Matches IRremoteESP8266 `IRrecv::decodeCarrierAC128`. There is no checksum,
 * so the match relies on the two-section structure.
 *
 * @returns The decoded 16-byte payload, or null on mismatch.
 */
export function decodeCarrierAc128(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Uint8Array | null {
  let pos = offset;

  const s1 = matchGenericBytes(
    timings, pos, timings.length - pos, SECTION_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, SECTION_GAP,
    true, undefined, undefined, false, headerOptional,
  );
  if (!s1) return null;
  pos += s1.used;

  // Inter-section markers.
  if (pos + 1 >= timings.length) return null;
  if (!matchMark(timings[pos]!, HDR_MARK)) return null;
  pos++;
  if (!matchSpace(timings[pos]!, INTER_SPACE)) return null;
  pos++;

  const s2 = matchGenericBytes(
    timings, pos, timings.length - pos, SECTION_LENGTH,
    HDR2_MARK, HDR2_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, SECTION_GAP,
    true, undefined, undefined, false, false,
  );
  if (!s2) return null;
  pos += s2.used;

  // Footer mark (+ optional trailing gap).
  if (pos >= timings.length || !matchMark(timings[pos]!, HDR_MARK)) return null;
  pos++;
  if (pos < timings.length && !matchAtLeast(timings[pos]!, MESSAGE_GAP)) return null;

  const out = new Uint8Array(CARRIER_AC128_STATE_LENGTH);
  out.set(s1.data, 0);
  out.set(s2.data, SECTION_LENGTH);
  return out;
}
