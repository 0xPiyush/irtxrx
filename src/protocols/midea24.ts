/**
 * Midea24 IR protocol encoder and decoder. (MIDEA24)
 *
 * Ported from IRremoteESP8266 `ir_Midea.cpp` (`sendMidea24` / `decodeMidea24`).
 *
 * Midea24 is the fan-remote sibling of the 48-bit Midea A/C protocol. It is
 * "basically a 48-bit version of the NEC protocol with alternate bytes
 * inverted, thus only 24 bits of real data": each of the 3 data bytes is sent
 * MSB-first immediately followed by its bitwise complement, and the whole
 * 48-bit payload is transmitted with NEC timings (8960/4480 header, 560/1680/
 * 560 bits). It carries no decodable appliance state — the value is an opaque
 * 24-bit code, validated only by the byte/inverse-byte parity.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1170
 */

import { sendNEC } from "./nec.js";
import { matchGeneric, kMarkExcess, kTolerance } from "../decode.js";

// NEC timing constants (shared with the NEC protocol; tick = 560µs).
const NEC_TICK = 560;
const NEC_HDR_MARK = 16 * NEC_TICK; // 8960
const NEC_HDR_SPACE = 8 * NEC_TICK; // 4480
const NEC_BIT_MARK = 1 * NEC_TICK; // 560
const NEC_ONE_SPACE = 3 * NEC_TICK; // 1680
const NEC_ZERO_SPACE = 1 * NEC_TICK; // 560
/** kMidea24MinGap — the footer gap the decoder matches "at least". */
const MIN_GAP = 13000;

/** Number of real data bits in a Midea24 frame. */
export const MIDEA24_BITS = 24;
const WIRE_BITS = MIDEA24_BITS * 2; // 48 bits on the wire (byte + inverse pairs)
const DATA_MASK = (1n << BigInt(MIDEA24_BITS)) - 1n;

/**
 * Interleave a 24-bit value into the 48-bit wire payload: each byte (MSB-first)
 * followed by its complement. Matches the shuffle in `IRsend::sendMidea24`.
 */
function interleave(data: bigint): bigint {
  let wire = 0n;
  for (let i = MIDEA24_BITS - 8; i >= 0; i -= 8) {
    wire <<= 16n;
    const next = (data >> BigInt(i)) & 0xffn;
    wire |= (next << 8n) | (next ^ 0xffn);
  }
  return wire;
}

/**
 * Encode a 24-bit Midea24 code into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendMidea24`: build the byte/inverse-byte
 * payload and transmit it as a 48-bit NEC frame.
 *
 * @param data   24-bit code (only the low 24 bits are used).
 * @param repeat Number of NEC repeat frames to append (default 0).
 */
export function encodeMidea24(data: bigint, repeat: number = 0): number[] {
  return sendNEC(interleave(data & DATA_MASK), WIRE_BITS, repeat);
}

/**
 * Decode raw IR timings into a 24-bit Midea24 code.
 *
 * Matches `IRrecv::decodeMidea24`: match a 48-bit NEC frame, verify every
 * second byte is the complement of the previous one, and collapse to the
 * 24-bit data value.
 *
 * @returns The 24-bit code, or null on mismatch / failed parity.
 */
export function decodeMidea24(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): bigint | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, WIRE_BITS,
    NEC_HDR_MARK, NEC_HDR_SPACE,
    NEC_BIT_MARK, NEC_ONE_SPACE, NEC_BIT_MARK, NEC_ZERO_SPACE,
    NEC_BIT_MARK, MIN_GAP,
    true, kTolerance, kMarkExcess, true, headerOptional,
  );
  if (!result) return null;

  const wire = result.data;
  let data = 0n;
  for (let i = WIRE_BITS; i >= 16; ) {
    data <<= 8n;
    i -= 8;
    const current = Number((wire >> BigInt(i)) & 0xffn);
    i -= 8;
    const next = Number((wire >> BigInt(i)) & 0xffn);
    if (current !== (next ^ 0xff)) return null; // not an inverted pair → abort
    data |= BigInt(current);
  }
  return data & DATA_MASK;
}
