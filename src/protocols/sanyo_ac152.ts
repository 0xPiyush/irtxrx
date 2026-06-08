/**
 * Sanyo 152-bit A/C IR protocol encoder and decoder. (SANYO_AC152)
 *
 * Ported from IRremoteESP8266 `ir_Sanyo.cpp`.
 * A 19-byte LSB-first message. IRremoteESP8266 provides no field-level class
 * (and notes the bit order is unconfirmed), so it is modelled as a raw byte
 * payload with no checksum.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1503
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Sanyo.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3300;
const HDR_SPACE = 1725;
const BIT_MARK = 440;
const ONE_SPACE = 1290;
const ZERO_SPACE = 405;
const GAP = 100000; // kDefaultMessageGap

export const SANYO_AC152_STATE_LENGTH = 19;

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw 19-byte Sanyo AC152 payload into IR timings (LSB-first). */
export function encodeSanyoAc152Raw(data: Uint8Array, repeat: number = 0): number[] {
  const result = sendGenericBytes({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP,
    data, msbFirst: false, repeat,
  });
  // The sender appends a guessed post-message gap after the final frame.
  result[result.length - 1] = result[result.length - 1]! + GAP;
  return result;
}

/** Encode a Sanyo AC152 raw payload into IR timings. */
export function sendSanyoAc152(data: Uint8Array, repeat: number = 0): number[] {
  return encodeSanyoAc152Raw(data, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Sanyo AC152 (19-byte) message.
 *
 * There is no checksum, so the match is structural/timing only.
 *
 * @returns The decoded 19-byte payload, or null on mismatch.
 */
export function decodeSanyoAc152(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Uint8Array | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, SANYO_AC152_STATE_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false, headerOptional,
  );
  return frame ? frame.data : null;
}
