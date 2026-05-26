/**
 * Hitachi 424-bit (53-byte) A/C protocol encoder and decoder. (HITACHI_AC2)
 *
 * Ported from IRremoteESP8266 `ir_Hitachi.cpp`.
 *
 * HITACHI_AC2 is the base HITACHI_AC framing (3300/1700 header, MSB-first)
 * carrying a 53-byte payload. The library exposes no structured class for it
 * and performs **no integrity check** on decode, so this module operates on the
 * raw byte array directly. Because there is no checksum to reject false
 * matches, it is intentionally *not* part of the auto-detect registry in
 * `decode.ts` — decode it explicitly via {@link decodeHitachiAc2}.
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";
import {
  HITACHI_HDR_MARK,
  HITACHI_HDR_SPACE,
  HITACHI_BIT_MARK,
  HITACHI_ONE_SPACE,
  HITACHI_ZERO_SPACE,
  HITACHI_MIN_GAP,
  HITACHI_BASE_TOLERANCE,
} from "./hitachi_common.js";

const STATE_LENGTH = 53;

/**
 * Encode a raw 53-byte HITACHI_AC2 payload into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendHitachiAC2` (which delegates to
 * `sendHitachiAC` with MSB-first byte order).
 */
export function encodeHitachiAc2Raw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HITACHI_HDR_MARK,
    headerSpace: HITACHI_HDR_SPACE,
    oneMark: HITACHI_BIT_MARK,
    oneSpace: HITACHI_ONE_SPACE,
    zeroMark: HITACHI_BIT_MARK,
    zeroSpace: HITACHI_ZERO_SPACE,
    footerMark: HITACHI_BIT_MARK,
    gap: HITACHI_MIN_GAP,
    data,
    msbFirst: true,
    repeat,
  });
}

/** Alias of {@link encodeHitachiAc2Raw} — AC2 carries no structured state. */
export const sendHitachiAc2 = encodeHitachiAc2Raw;

/**
 * Decode raw IR timings as a HITACHI_AC2 message.
 *
 * Returns the raw 53-byte payload. No integrity check is performed (the
 * protocol has none), so only call this when the protocol is already known.
 *
 * @returns The decoded 53-byte array, or null if the framing doesn't match.
 */
export function decodeHitachiAc2(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Uint8Array | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    HITACHI_HDR_MARK, HITACHI_HDR_SPACE,
    HITACHI_BIT_MARK, HITACHI_ONE_SPACE,
    HITACHI_BIT_MARK, HITACHI_ZERO_SPACE,
    HITACHI_BIT_MARK, HITACHI_MIN_GAP,
    true, HITACHI_BASE_TOLERANCE, undefined, true,
    headerOptional,
  );
  return frame ? frame.data : null;
}
