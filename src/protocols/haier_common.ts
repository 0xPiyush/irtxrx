/**
 * Shared Haier A/C wire format.
 *
 * Ported from IRremoteESP8266 `ir_Haier.cpp`. Every Haier A/C variant
 * (HAIER_AC, HAIER_AC_YRW02, HAIER_AC160, HAIER_AC176) is transmitted by the
 * same `IRsend::sendHaierAC` routine: a `3000/3000` lead-in, a `3000/4300`
 * header, then MSB-first bytes with a 520µs bit-mark. Only the payload length
 * and the field/checksum layout differ between variants.
 */

import { sendGenericBytes, sumBytes } from "../encode.js";
import { matchMark, matchSpace, matchGenericBytes } from "../decode.js";

export const HAIER_HDR = 3000;
export const HAIER_HDR_GAP = 4300;
export const HAIER_BIT_MARK = 520;
export const HAIER_ONE_SPACE = 1650;
export const HAIER_ZERO_SPACE = 650;
export const HAIER_MIN_GAP = 150000;

/** Byte-sum of `state[0..len-1]`, the checksum used by every Haier variant. */
export function haierSum(state: Uint8Array, start: number, len: number): number {
  return sumBytes(state, start, start + len);
}

/** Encode a raw Haier byte payload into IR timings (shared by all variants). */
export function encodeHaier(data: Uint8Array, repeat: number = 0): number[] {
  const result: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    result.push(HAIER_HDR, HAIER_HDR); // lead-in mark + space
    const frame = sendGenericBytes({
      headerMark: HAIER_HDR, headerSpace: HAIER_HDR_GAP,
      oneMark: HAIER_BIT_MARK, oneSpace: HAIER_ONE_SPACE,
      zeroMark: HAIER_BIT_MARK, zeroSpace: HAIER_ZERO_SPACE,
      footerMark: HAIER_BIT_MARK, gap: HAIER_MIN_GAP,
      data, msbFirst: true,
    });
    for (const t of frame) result.push(t);
  }
  return result;
}

/**
 * Decode a Haier frame of `nbytes` bytes, or null on mismatch.
 *
 * Matches the shared lead-in + header, then the MSB-first byte payload.
 */
export function decodeHaierBytes(
  timings: number[],
  offset: number,
  nbytes: number,
  headerOptional: boolean = false,
): Uint8Array | null {
  let pos = offset;
  // Lead-in mark + space.
  let hasLeadIn = false;
  if (pos + 1 < timings.length &&
      matchMark(timings[pos]!, HAIER_HDR) && matchSpace(timings[pos + 1]!, HAIER_HDR)) {
    pos += 2;
    hasLeadIn = true;
  }
  if (!hasLeadIn && !headerOptional) return null;

  const frame = matchGenericBytes(
    timings, pos, timings.length - pos, nbytes,
    HAIER_HDR, HAIER_HDR_GAP,
    HAIER_BIT_MARK, HAIER_ONE_SPACE, HAIER_BIT_MARK, HAIER_ZERO_SPACE,
    HAIER_BIT_MARK, HAIER_MIN_GAP,
    true, undefined, undefined, true, !hasLeadIn && headerOptional,
  );
  return frame ? frame.data : null;
}
