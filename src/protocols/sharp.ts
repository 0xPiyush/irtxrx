/**
 * Sharp 15-bit IR remote protocol encoder and decoder. (SHARP)
 *
 * Ported from IRremoteESP8266 `ir_Sharp.cpp` / `ir_Sharp.h`.
 * The classic Sharp remote protocol (TVs etc.). Each command is sent twice:
 * once normally, then with all but the 5 address bits inverted. The 15 bits are
 * `address(5) | command(8) | expansion(1) | check(1)`.
 *
 * @see http://www.sbprojects.net/knowledge/ir/sharp.htm
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Sharp.cpp exactly
// ---------------------------------------------------------------------------

const TICK = 26;
const BIT_MARK = 10 * TICK; // 260
const ONE_SPACE = 70 * TICK; // 1820
const ZERO_SPACE = 30 * TICK; // 780
const GAP = 1677 * TICK; // 43602

export const SHARP_BITS = 15;
const ADDRESS_BITS = 5;
const COMMAND_BITS = 8;
/** Lower (15 − 5) = 10 bits are inverted on the second transmission. */
const TOGGLE_MASK = (1n << BigInt(SHARP_BITS - ADDRESS_BITS)) - 1n;
const MASK15 = (1n << 15n) - 1n;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface SharpState {
  /** Full 15-bit message value (lossless; re-encoded verbatim). */
  data: bigint;
  /** 5-bit device address. */
  address: number;
  /** 8-bit command. */
  command: number;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Build a raw 15-bit Sharp value from address + command (expansion=1, check=0).
 *
 * Matches IRremoteESP8266 `IRsend::encodeSharp` (MSB-first inputs).
 */
export function encodeSharpData(address: number, command: number): bigint {
  return (
    (BigInt(address & 0x1f) << BigInt(COMMAND_BITS + 2)) |
    (BigInt(command & 0xff) << 2n) |
    (1n << 1n) // expansion
  );
}

/**
 * Encode a raw 15-bit Sharp value into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendSharpRaw`: sent twice (normal, then with
 * the low 10 bits inverted) per repeat.
 */
export function encodeSharpRaw(
  data: bigint,
  nbits: number = SHARP_BITS,
  repeat: number = 0,
): number[] {
  const result: number[] = [];
  const v = data & MASK15;
  for (let r = 0; r <= repeat; r++) {
    let temp = v;
    for (let n = 0; n < 2; n++) {
      const frame = sendGeneric({
        headerMark: 0, headerSpace: 0,
        oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
        footerMark: BIT_MARK, gap: GAP,
        data: temp, nbits, msbFirst: true,
      });
      for (const t of frame) result.push(t);
      temp ^= TOGGLE_MASK;
    }
  }
  return result;
}

/** Encode a Sharp remote state into raw IR timings. */
export function sendSharp(state: SharpState, repeat: number = 0): number[] {
  return encodeSharpRaw(state.data & MASK15, SHARP_BITS, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Sharp 15-bit message.
 *
 * Matches the normal block followed by the low-10-bits-inverted block.
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeSharp(
  timings: number[],
  offset: number = 0,
  _headerOptional: boolean = false,
): SharpState | null {
  void _headerOptional;
  const b1 = matchGeneric(
    timings, offset, timings.length - offset, SHARP_BITS,
    0, 0,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    false, undefined, undefined, true, false,
  );
  if (!b1) return null;

  const b2 = matchGeneric(
    timings, offset + b1.used, timings.length - offset - b1.used, SHARP_BITS,
    0, 0,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, true, false,
  );
  if (!b2) return null;

  const data = b1.data & MASK15;
  if ((b2.data & MASK15) !== (data ^ TOGGLE_MASK)) return null;

  return {
    data,
    address: Number(data >> BigInt(COMMAND_BITS + 2)),
    command: Number((data >> 2n) & 0xffn),
  };
}
