/**
 * Samsung 32-bit IR protocol encoder and decoder. (SAMSUNG)
 *
 * Ported from IRremoteESP8266 `ir_Samsung.cpp` / `ir_Samsung.h`.
 * The classic Samsung remote protocol (TVs etc.) — a simple value carrier.
 *
 * Wire format: 4480/4480 header + 32 bits (MSB-first) + footer. Although 32
 * bits are sent, only 16 are distinct: `customer | customer | command |
 * ~command`. We validate the repeated customer byte and the inverted command.
 *
 * @see http://elektrolab.wz.cz/katalog/samsung_protocol.pdf
 */

import { reverseBits, sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Samsung.cpp exactly
// ---------------------------------------------------------------------------

const TICK = 560;
const HDR_MARK = 8 * TICK; // 4480
const HDR_SPACE = 8 * TICK; // 4480
const BIT_MARK = 1 * TICK; // 560
const ONE_SPACE = 3 * TICK; // 1680
const ZERO_SPACE = 1 * TICK; // 560
const MIN_MESSAGE_LENGTH = 193 * TICK; // 108080
const MIN_GAP = (193 - (8 + 8 + 32 * (1 + 3) + 1)) * TICK; // 26880

export const SAMSUNG_BITS = 32;

const MASK32 = (1n << 32n) - 1n;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface SamsungState {
  /** Full 32-bit message value (lossless; re-encoded verbatim). */
  data: bigint;
  /** Decoded device/customer address. */
  address: number;
  /** Decoded command. */
  command: number;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Build a raw 32-bit Samsung value from a customer (address) + command.
 *
 * Matches IRremoteESP8266 `IRsend::encodeSAMSUNG`.
 */
export function encodeSamsungData(customer: number, command: number): bigint {
  const revcustomer = reverseBits(customer & 0xff, 8);
  const revcommand = reverseBits(command & 0xff, 8);
  return BigInt(
    (((revcommand ^ 0xff) | (revcommand << 8) | (revcustomer << 16) | (revcustomer << 24)) >>> 0),
  );
}

/**
 * Encode a raw 32-bit Samsung value into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendSAMSUNG`.
 */
export function encodeSamsungRaw(
  data: bigint,
  nbits: number = SAMSUNG_BITS,
  repeat: number = 0,
): number[] {
  return sendGeneric({
    headerMark: HDR_MARK,
    headerSpace: HDR_SPACE,
    oneMark: BIT_MARK,
    oneSpace: ONE_SPACE,
    zeroMark: BIT_MARK,
    zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK,
    gap: MIN_GAP,
    mesgTime: MIN_MESSAGE_LENGTH,
    data: data & MASK32,
    nbits,
    msbFirst: true,
    repeat,
  });
}

/** Encode a Samsung state into raw IR timings. */
export function sendSamsung(state: SamsungState, repeat: number = 0): number[] {
  return encodeSamsungRaw(state.data & MASK32, SAMSUNG_BITS, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Samsung 32-bit message.
 *
 * Validates the repeated customer byte and the inverted command byte.
 *
 * Matches IRremoteESP8266 `IRrecv::decodeSAMSUNG`.
 *
 * @returns Decoded state, or null on mismatch / failed compliance.
 */
export function decodeSamsung(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): SamsungState | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, SAMSUNG_BITS,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, MIN_GAP,
    true, undefined, undefined, true, headerOptional,
  );
  if (!result) return null;

  const data = Number(result.data & MASK32);
  const address = (data >>> 24) & 0xff;
  if (address !== ((data >>> 16) & 0xff)) return null; // customer repeated
  const command = (data >>> 8) & 0xff;
  if (command !== ((data & 0xff) ^ 0xff)) return null; // inverted command

  return {
    data: result.data & MASK32,
    address: reverseBits(address, 8),
    command: reverseBits(command, 8),
  };
}
