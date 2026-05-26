/**
 * Hitachi variable-length A/C protocol encoder and decoder. (HITACHI_AC3)
 *
 * Ported from IRremoteESP8266 `ir_Hitachi.cpp` / `ir_Hitachi.h`.
 * Models: PC-LH3B.
 *
 * Header 3400/1660, LSB-first, byte-pair-inversion integrity. The C++ class
 * exposes no field setters — it carries opaque, button-specific payloads of one
 * of five fixed lengths — so this module operates on the raw byte array:
 *
 *   - 15 bytes — Cancel Timer (minimum)
 *   - 17 bytes — Change Temp
 *   - 21 bytes — Change Mode
 *   - 23 bytes — Normal
 *   - 27 bytes — Set Timer (maximum)
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1060
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";
import {
  HITACHI_AC3_HDR_MARK,
  HITACHI_AC3_HDR_SPACE,
  HITACHI_AC3_BIT_MARK,
  HITACHI_AC3_ONE_SPACE,
  HITACHI_AC3_ZERO_SPACE,
  HITACHI_MIN_GAP,
  invertBytePairs,
  checkInvertedBytePairs,
} from "./hitachi_common.js";

/** Valid HITACHI_AC3 message lengths in bytes, longest first (decode order). */
export const HITACHI_AC3_LENGTHS: readonly number[] = [27, 23, 21, 17, 15];

/**
 * Apply HITACHI_AC3 integrity in place: set every second byte from offset 3
 * onward to the bitwise inverse of the byte before it. Returns `data`.
 *
 * Matches IRremoteESP8266 `IRHitachiAc3::setInvertedStates`.
 */
export function applyHitachiAc3Parity(data: Uint8Array): Uint8Array {
  if (data.length > 3) invertBytePairs(data, 3, data.length - 3);
  return data;
}

/**
 * Encode a raw HITACHI_AC3 payload (15/17/21/23/27 bytes) into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendHitachiAc3` (header 3400/1660,
 * LSB-first). The payload is sent as-is; call {@link applyHitachiAc3Parity}
 * first if you are constructing a frame by hand.
 */
export function encodeHitachiAc3Raw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HITACHI_AC3_HDR_MARK,
    headerSpace: HITACHI_AC3_HDR_SPACE,
    oneMark: HITACHI_AC3_BIT_MARK,
    oneSpace: HITACHI_AC3_ONE_SPACE,
    zeroMark: HITACHI_AC3_BIT_MARK,
    zeroSpace: HITACHI_AC3_ZERO_SPACE,
    footerMark: HITACHI_AC3_BIT_MARK,
    gap: HITACHI_MIN_GAP,
    data,
    msbFirst: false,
    repeat,
  });
}

/** Alias of {@link encodeHitachiAc3Raw} — AC3 carries no structured state. */
export const sendHitachiAc3 = encodeHitachiAc3Raw;

/**
 * Decode raw IR timings as a HITACHI_AC3 message.
 *
 * Tries each valid length (longest first) and returns the first that frames
 * cleanly and passes the byte-pair-inversion integrity check.
 *
 * @returns The decoded payload bytes, or null on mismatch.
 */
export function decodeHitachiAc3(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Uint8Array | null {
  for (const nbytes of HITACHI_AC3_LENGTHS) {
    const frame = matchGenericBytes(
      timings, offset, timings.length - offset, nbytes,
      HITACHI_AC3_HDR_MARK, HITACHI_AC3_HDR_SPACE,
      HITACHI_AC3_BIT_MARK, HITACHI_AC3_ONE_SPACE,
      HITACHI_AC3_BIT_MARK, HITACHI_AC3_ZERO_SPACE,
      HITACHI_AC3_BIT_MARK, HITACHI_MIN_GAP,
      true, undefined, undefined, false,
      headerOptional,
    );
    if (frame && checkInvertedBytePairs(frame.data, 3, nbytes - 3)) {
      return frame.data;
    }
  }
  return null;
}
