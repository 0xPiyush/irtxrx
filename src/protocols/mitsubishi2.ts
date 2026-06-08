/**
 * Mitsubishi2 16-bit (HC3000 projector) IR protocol encoder and decoder.
 *
 * Ported from IRremoteESP8266 `ir_Mitsubishi.cpp` (`sendMitsubishi2` /
 * `decodeMitsubishi2`). A 16-bit value sent MSB-first in two 8-bit halves
 * separated by a header-space gap. No checksum (timing match only).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Mitsubishi.cpp
 */

import { encodeData } from "../encode.js";
import { matchMark, matchSpace, matchAtLeast, matchData } from "../decode.js";

const M2_HDR_MARK = 8400;
const M2_HDR_SPACE = 8400 / 2; // 4200
const M2_BIT_MARK = 560;
const M2_ZERO_SPACE = 520;
const M2_ONE_SPACE = 520 * 3; // 1560
const M2_MIN_GAP = 28500;
const M2_TOLERANCE = 30;

export const MITSUBISHI2_BITS = 16;

/** A decoded Mitsubishi2 (projector) code. */
export interface Mitsubishi2State {
  /** 16-bit value (high byte = address, low byte = command). */
  value: number;
}

function pushByte(out: number[], value: number): void {
  const bits = encodeData(
    M2_BIT_MARK, M2_ONE_SPACE,
    M2_BIT_MARK, M2_ZERO_SPACE,
    BigInt(value & 0xff), 8, true, // MSB-first
  );
  for (let i = 0; i < bits.length; i++) out.push(bits[i]!);
}

/** Encode a raw 16-bit Mitsubishi2 value into IR timings. */
export function encodeMitsubishi2Raw(value: number, repeat: number = 1): number[] {
  const out: number[] = [];
  const hi = (value >> 8) & 0xff;
  const lo = value & 0xff;
  for (let r = 0; r <= repeat; r++) {
    out.push(M2_HDR_MARK, M2_HDR_SPACE);
    pushByte(out, hi);
    out.push(M2_BIT_MARK, M2_HDR_SPACE); // mid footer + gap
    pushByte(out, lo);
    out.push(M2_BIT_MARK, M2_MIN_GAP);
  }
  return out;
}

/** Encode a Mitsubishi2 state into IR timings. */
export function sendMitsubishi2(state: Mitsubishi2State, repeat: number = 1): number[] {
  return encodeMitsubishi2Raw(state.value, repeat);
}

/**
 * Decode raw IR timings as a Mitsubishi2 code.
 *
 * @returns The decoded 16-bit value, or null on mismatch.
 */
export function decodeMitsubishi2(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Mitsubishi2State | null {
  let pos = offset;
  const len = timings.length;
  if (len - offset < 2 + 16 + 2 + 16 + 1) return null;

  // Header
  if (
    pos + 1 < len &&
    matchMark(timings[pos]!, M2_HDR_MARK, M2_TOLERANCE) &&
    matchSpace(timings[pos + 1]!, M2_HDR_SPACE, M2_TOLERANCE)
  ) {
    pos += 2;
  } else if (!headerOptional) {
    return null;
  }

  let value = 0;
  for (let half = 0; half < 2; half++) {
    const r = matchData(
      timings, pos, 8,
      M2_BIT_MARK, M2_ONE_SPACE,
      M2_BIT_MARK, M2_ZERO_SPACE,
      // C++ decodeMitsubishi2 uses the global mark-excess (50µs).
      M2_TOLERANCE, undefined, true,
    );
    if (!r.success) return null;
    value = (value << 8) | Number(r.data & 0xffn);
    pos += r.used;
    // Footer mark
    if (pos >= len) return null;
    if (!matchMark(timings[pos]!, M2_BIT_MARK, M2_TOLERANCE)) return null;
    pos++;
    // Footer space: header-space between halves, larger gap after the last.
    if (half === 0) {
      if (pos >= len || !matchSpace(timings[pos]!, M2_HDR_SPACE, M2_TOLERANCE)) return null;
      pos++;
    } else if (pos < len) {
      if (!matchAtLeast(timings[pos]!, M2_HDR_SPACE, M2_TOLERANCE)) return null;
      pos++;
    }
  }

  return { value: value & 0xffff };
}
