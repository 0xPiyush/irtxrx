/**
 * Shared Mitsubishi Heavy Industries A/C wire format.
 *
 * Ported from IRremoteESP8266 `ir_MitsubishiHeavy.cpp`. Both the 152-bit and
 * 88-bit messages use the same 3140/1630 header and MSB... actually LSB-first
 * byte encoding, and the same integrity scheme: starting at byte 3, the message
 * is stored as inverted byte pairs (`byte[k+1] = ~byte[k]`), so the odd-indexed
 * bytes carry data and the following even-indexed bytes carry their complement.
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes, kTolerance, kHardwareMarkExcess } from "../decode.js";

export const MH_HDR_MARK = 3140;
export const MH_HDR_SPACE = 1630;
export const MH_BIT_MARK = 370;
export const MH_ONE_SPACE = 420;
export const MH_ZERO_SPACE = 1220;
export const MH_GAP = 100000; // kDefaultMessageGap
/** Inverted-pair checksum starts at byte (signature length − 2) = 3. */
export const MH_CHECKSUM_OFFSET = 3;

/** Apply the inverted-byte-pair checksum in place, starting at `offset`. */
export function applyInvertedPairs(raw: Uint8Array, offset: number): void {
  for (let k = offset; k + 1 < raw.length; k += 2) raw[k + 1] = ~raw[k]! & 0xff;
}

/** Verify the inverted-byte-pair checksum from `offset`. */
export function checkInvertedPairs(raw: Uint8Array, offset: number): boolean {
  for (let k = offset; k + 1 < raw.length; k += 2)
    if (raw[k + 1] !== (~raw[k]! & 0xff)) return false;
  return true;
}

/** Encode a raw Mitsubishi Heavy payload into IR timings (LSB-first). */
export function encodeMitsubishiHeavy(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: MH_HDR_MARK, headerSpace: MH_HDR_SPACE,
    oneMark: MH_BIT_MARK, oneSpace: MH_ONE_SPACE, zeroMark: MH_BIT_MARK, zeroSpace: MH_ZERO_SPACE,
    footerMark: MH_BIT_MARK, gap: MH_GAP,
    data, msbFirst: false, repeat,
  });
}

/** Decode a Mitsubishi Heavy frame of `nbytes` bytes, or null on mismatch. */
export function decodeMitsubishiHeavyBytes(
  timings: number[],
  offset: number,
  nbytes: number,
  headerOptional: boolean = false,
): Uint8Array | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, nbytes,
    MH_HDR_MARK, MH_HDR_SPACE,
    MH_BIT_MARK, MH_ONE_SPACE, MH_BIT_MARK, MH_ZERO_SPACE,
    MH_BIT_MARK, MH_GAP,
    // Match the C++ reference's global 50µs mark-excess so real-hardware
    // captures (marks read long, spaces short) decode identically.
    true, kTolerance, kHardwareMarkExcess, false, headerOptional,
  );
  return frame ? frame.data : null;
}
