/**
 * LG / LG2 28-bit IR protocol encoder and decoder. (LG, LG2)
 *
 * Ported from IRremoteESP8266 `ir_LG.cpp` / `ir_LG.h`.
 * The LG remote protocol (TVs, A/Cs). Two wire variants share the bit timings
 * but differ in header (and bit-mark): the original **LG** (8500/4250 header,
 * 550µs mark) and **LG2** (3200/9900 header, 480µs mark). Both carry 28 bits:
 * `address(8) | command(16) | checksum(4)`, where the checksum is the 4-bit
 * nibble-sum of the command.
 *
 * Like NEC, LG sends a separate repeat frame after the command. The 32-bit LG
 * form (≈ Samsung) is out of scope.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1513
 */

import { sendGeneric, sumNibbles64 } from "../encode.js";
import { matchMark, matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_LG.cpp exactly
// ---------------------------------------------------------------------------

const ONE_SPACE = 1600;
const ZERO_SPACE = 550;
const RPT_SPACE = 2250;
const MIN_GAP = 39750;
const MIN_MESSAGE_LENGTH = 108050;

// LG (28-bit)
const LG_HDR_MARK = 8500;
const LG_HDR_SPACE = 4250;
const LG_BIT_MARK = 550;
// LG2 (28-bit)
const LG2_HDR_MARK = 3200;
const LG2_HDR_SPACE = 9900;
const LG2_BIT_MARK = 480;

export const LG_BITS = 28;
const CHECKSUM_SIZE = 4;

const MASK28 = (1n << 28n) - 1n;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface LgState {
  /** Full 28-bit message value (lossless; re-encoded verbatim). */
  data: bigint;
  /** 8-bit address (the bits above the command). */
  address: number;
  /** 16-bit command. */
  command: number;
  /** True for the LG2 wire variant (3200/9900 header), false for LG. */
  lg2: boolean;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** The 4-bit nibble-sum checksum of a 16-bit command. */
function lgChecksum(command: number): number {
  return sumNibbles64(BigInt(command & 0xffff), 16);
}

/**
 * Build a raw 28-bit LG value from an address + command.
 *
 * Matches IRremoteESP8266 `IRsend::encodeLG`.
 */
export function encodeLgData(address: number, command: number): bigint {
  return (
    (BigInt(address & 0xff) << 20n) |
    (BigInt(command & 0xffff) << BigInt(CHECKSUM_SIZE)) |
    BigInt(lgChecksum(command))
  );
}

/**
 * Encode a raw 28-bit LG/LG2 value into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendLG` / `IRsend::sendLG2`, including the
 * mandatory trailing repeat frame(s).
 */
export function encodeLgRaw(
  data: bigint,
  nbits: number = LG_BITS,
  lg2: boolean = false,
  repeat: number = 0,
): number[] {
  const hdrMark = lg2 ? LG2_HDR_MARK : LG_HDR_MARK;
  const hdrSpace = lg2 ? LG2_HDR_SPACE : LG_HDR_SPACE;
  const bitMark = lg2 ? LG2_BIT_MARK : LG_BIT_MARK;

  const result = sendGeneric({
    headerMark: hdrMark, headerSpace: hdrSpace,
    oneMark: bitMark, oneSpace: ONE_SPACE, zeroMark: bitMark, zeroSpace: ZERO_SPACE,
    footerMark: bitMark, gap: MIN_GAP, mesgTime: MIN_MESSAGE_LENGTH,
    data: data & ((1n << BigInt(nbits)) - 1n), nbits, msbFirst: true,
  });

  // Repeat frame(s): header mark + repeat space + footer mark, no data.
  // The repeat footer mark is the standard LG bit-mark even for LG2.
  if (repeat > 0) {
    const rpt = sendGeneric({
      headerMark: hdrMark, headerSpace: RPT_SPACE,
      oneMark: 0, oneSpace: 0, zeroMark: 0, zeroSpace: 0,
      footerMark: LG_BIT_MARK, gap: MIN_GAP, mesgTime: MIN_MESSAGE_LENGTH,
      data: 0n, nbits: 0, msbFirst: true, repeat: repeat - 1,
    });
    for (const t of rpt) result.push(t);
  }
  return result;
}

/** Encode an LG state into raw IR timings. */
export function sendLg(state: LgState, repeat: number = 0): number[] {
  return encodeLgRaw(state.data & MASK28, LG_BITS, state.lg2, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as an LG / LG2 28-bit message.
 *
 * Auto-detects the LG vs LG2 wire variant by the header mark, and validates the
 * 4-bit nibble-sum checksum.
 *
 * Matches IRremoteESP8266 `IRrecv::decodeLG` (28-bit forms).
 *
 * @returns Decoded state, or null on mismatch / failed checksum.
 */
export function decodeLg(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): LgState | null {
  let pos = offset;

  // Header mark selects the variant (and the data bit-mark).
  let lg2 = false;
  let hdrSpace = LG_HDR_SPACE;
  let bitMark = LG_BIT_MARK;
  let hasHeader = false;
  if (pos < timings.length) {
    if (matchMark(timings[pos]!, LG_HDR_MARK)) {
      hasHeader = true;
    } else if (matchMark(timings[pos]!, LG2_HDR_MARK)) {
      lg2 = true; hdrSpace = LG2_HDR_SPACE; bitMark = LG2_BIT_MARK; hasHeader = true;
    }
  }
  if (hasHeader) pos++;
  else if (!headerOptional) return null;

  const result = matchGeneric(
    timings, pos, timings.length - pos, LG_BITS,
    0, hdrSpace, // header mark already consumed
    bitMark, ONE_SPACE, bitMark, ZERO_SPACE,
    bitMark, MIN_GAP,
    true, undefined, undefined, true, false,
  );
  if (!result) return null;

  const data = result.data & MASK28;
  const command = Number((data >> BigInt(CHECKSUM_SIZE)) & 0xffffn);
  if (Number(data & 0xfn) !== lgChecksum(command)) return null;

  return {
    data,
    address: Number(data >> 20n),
    command,
    lg2,
  };
}
