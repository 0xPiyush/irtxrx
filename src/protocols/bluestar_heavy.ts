/**
 * Blue Star (BluestarHeavy) A/C IR protocol encoder and decoder. (BLUESTARHEAVY)
 *
 * Ported from IRremoteESP8266 `ir_BluestarHeavy.cpp`.
 * A 13-byte MSB-first message. Unusually, the footer mark is the same long
 * 4912µs pulse used for the header. IRremoteESP8266 provides no field-level
 * class or checksum, so it is modelled as a raw byte payload.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266 (BluestarHeavy)
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_BluestarHeavy.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 4912;
const HDR_SPACE = 5058;
const BIT_MARK = 465;
const ONE_SPACE = 572;
const ZERO_SPACE = 1548;
const GAP = 100000; // kDefaultMessageGap

export const BLUESTAR_HEAVY_STATE_LENGTH = 13;

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 13-byte BluestarHeavy payload into IR timings (MSB-first).
 *
 * Matches IRremoteESP8266 `IRsend::sendBluestarHeavy` — note the footer mark is
 * the header mark, not the bit mark.
 */
export function encodeBluestarHeavyRaw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: HDR_MARK, gap: GAP,
    data, msbFirst: true, repeat,
  });
}

/** Encode a BluestarHeavy raw payload into IR timings. */
export function sendBluestarHeavy(data: Uint8Array, repeat: number = 0): number[] {
  return encodeBluestarHeavyRaw(data, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a BluestarHeavy (13-byte) message.
 *
 * There is no checksum, so the match is structural/timing only.
 *
 * @returns The decoded 13-byte payload, or null on mismatch.
 */
export function decodeBluestarHeavy(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Uint8Array | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, BLUESTAR_HEAVY_STATE_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    HDR_MARK, GAP,
    true, undefined, undefined, true, headerOptional,
  );
  return frame ? frame.data : null;
}
