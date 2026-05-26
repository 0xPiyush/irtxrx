/**
 * TCL 96-bit (12-byte) A/C protocol encoder and decoder. (TCL96AC)
 *
 * Ported from IRremoteESP8266 `ir_Tcl.cpp`.
 * Models: TCL GYKQ-58(XM) remote, Daewoo DSB-F0934ELH-V / GYKQ-52E, Electrolux
 * EACM CL/N3 series remote.
 *
 * Unlike most protocols this encodes **two bits per symbol**: each symbol is a
 * fixed 600µs mark followed by one of four distinct space durations selecting
 * the 2-bit value (MSB-first within each byte). There is no checksum — decode
 * relies purely on the timing structure, so it is reported with `timing_match`
 * confidence. The library exposes no structured fields, so this module operates
 * on the raw 12-byte array.
 */

import { matchMark, matchSpace, matchAtLeast } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Tcl.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 1056;
const HDR_SPACE = 550;
const BIT_MARK = 600;
const GAP = 100000;
const STATE_LENGTH = 12;

/** Space duration per 2-bit symbol value: index 0b00..0b11. */
const BIT_SPACES: readonly number[] = [360, 838, 2182, 1444];

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 12-byte TCL96AC payload into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendTcl96Ac`: header, then each byte as four
 * 2-bit symbols (most-significant pair first), then a footer mark + gap.
 */
export function encodeTcl96Raw(data: Uint8Array, repeat: number = 0): number[] {
  const result: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    result.push(HDR_MARK, HDR_SPACE);
    for (let i = 0; i < data.length; i++) {
      let b = data[i]!;
      for (let group = 0; group < 4; group++) {
        const two = (b >> 6) & 0x03; // top 2 bits
        result.push(BIT_MARK, BIT_SPACES[two]!);
        b = (b << 2) & 0xFF;
      }
    }
    result.push(BIT_MARK, GAP);
  }
  return result;
}

/** Alias of {@link encodeTcl96Raw} — TCL96AC carries no structured state. */
export const sendTcl96 = encodeTcl96Raw;

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a TCL96AC message.
 *
 * Returns the raw 12-byte payload, or null if the framing doesn't match. No
 * integrity check exists for this protocol, so a match is timing-based only.
 *
 * @returns The decoded 12-byte array, or null on mismatch.
 */
export function decodeTcl96(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Uint8Array | null {
  const len = timings.length;
  let pos = offset;

  // Header.
  if (pos + 1 < len &&
      matchMark(timings[pos]!, HDR_MARK) &&
      matchSpace(timings[pos + 1]!, HDR_SPACE)) {
    pos += 2;
  } else if (!headerOptional) {
    return null;
  }

  const data = new Uint8Array(STATE_LENGTH);
  for (let i = 0; i < STATE_LENGTH; i++) {
    let b = 0;
    for (let group = 0; group < 4; group++) {
      if (pos + 1 >= len) return null;
      if (!matchMark(timings[pos]!, BIT_MARK)) return null;
      pos++;
      // Find which 2-bit symbol the space matches (first match wins, as in C++).
      let value = -1;
      for (let v = 0; v < BIT_SPACES.length; v++) {
        if (matchSpace(timings[pos]!, BIT_SPACES[v]!)) { value = v; break; }
      }
      if (value < 0) return null;
      b = (b << 2) | value;
      pos++;
    }
    data[i] = b;
  }

  // Footer mark.
  if (pos >= len || !matchMark(timings[pos]!, BIT_MARK)) return null;
  pos++;
  // Footer gap (optional — may be the last frame).
  if (pos < len && !matchAtLeast(timings[pos]!, GAP)) return null;

  return data;
}
