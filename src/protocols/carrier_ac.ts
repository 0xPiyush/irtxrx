/**
 * Carrier 32-bit HVAC IR protocol encoder and decoder. (CARRIER_AC)
 *
 * Ported from IRremoteESP8266 `ir_Carrier.cpp` / `ir_Carrier.h`.
 * A 32-bit value carrier. Each message transmits the 32-bit block three times —
 * normal, bit-inverted, then normal again — which the decoder validates in
 * place of a checksum.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/385
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Carrier.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 8532;
const HDR_SPACE = 4228;
const BIT_MARK = 628;
const ONE_SPACE = 1320;
const ZERO_SPACE = 532;
const GAP = 20000;

export const CARRIER_AC_BITS = 32;
const MASK32 = (1n << 32n) - 1n;

function invert(data: bigint): bigint {
  return ~data & MASK32;
}

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface CarrierAcState {
  /** Full 32-bit message value (lossless; re-encoded verbatim). */
  data: bigint;
  /** Decoded address (high 16 bits). */
  address: number;
  /** Decoded command (low 16 bits). */
  command: number;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 32-bit Carrier value into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendCarrierAC`: the block is sent three
 * times (normal, inverted, normal) per repeat.
 */
export function encodeCarrierAcRaw(
  data: bigint,
  nbits: number = CARRIER_AC_BITS,
  repeat: number = 0,
): number[] {
  const result: number[] = [];
  const block = (value: bigint): void => {
    const frame = sendGeneric({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: GAP,
      data: value & MASK32, nbits, msbFirst: true,
    });
    for (const t of frame) result.push(t);
  };
  for (let r = 0; r <= repeat; r++) {
    let temp = data & MASK32;
    for (let i = 0; i < 3; i++) {
      block(temp);
      temp = invert(temp);
    }
  }
  return result;
}

/** Encode a Carrier 32-bit state into raw IR timings. */
export function sendCarrierAc(state: CarrierAcState, repeat: number = 0): number[] {
  return encodeCarrierAcRaw(state.data & MASK32, CARRIER_AC_BITS, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Carrier 32-bit message.
 *
 * Reads the three repeated blocks and validates the inverted middle block.
 *
 * Matches IRremoteESP8266 `IRrecv::decodeCarrierAC`.
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeCarrierAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): CarrierAcState | null {
  let pos = offset;
  let data = 0n;
  let prev = 0n;

  for (let i = 0; i < 3; i++) {
    prev = data;
    const result = matchGeneric(
      timings, pos, timings.length - pos, CARRIER_AC_BITS,
      HDR_MARK, HDR_SPACE,
      BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
      BIT_MARK, GAP,
      true, undefined, undefined, true, i === 0 ? headerOptional : false,
    );
    if (!result) return null;
    data = result.data & MASK32;
    pos += result.used;
    if (i > 0 && prev !== invert(data)) return null;
  }

  return {
    data,
    address: Number(data >> 16n),
    command: Number(data & 0xffffn),
  };
}
