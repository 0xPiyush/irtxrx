/**
 * Sanyo LC7461 42-bit IR remote protocol encoder and decoder. (SANYO_LC7461)
 *
 * Ported from IRremoteESP8266 `ir_Sanyo.cpp` / `ir_Sanyo.h`.
 * A 42-bit NEC variant: `address(13) | ~address(13) | command(8) | ~command(8)`,
 * transmitted with NEC framing.
 *
 * @see http://pdf.datasheetcatalog.com/datasheet/sanyo/LC7461.pdf
 */

import { sendNEC } from "./nec.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Sanyo.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 9000;
const HDR_SPACE = 4500;
const BIT_MARK = 560;
const ONE_SPACE = 1690;
const ZERO_SPACE = 560;
const MIN_COMMAND_LENGTH = 108000;
const MIN_GAP =
  MIN_COMMAND_LENGTH -
  (HDR_MARK + HDR_SPACE + 42 * (BIT_MARK + ONE_SPACE) + BIT_MARK);

export const SANYO_LC7461_BITS = 42;
const ADDRESS_BITS = 13;
const COMMAND_BITS = 8;
const ADDRESS_MASK = (1 << ADDRESS_BITS) - 1;
const COMMAND_MASK = (1 << COMMAND_BITS) - 1;
const MASK42 = (1n << 42n) - 1n;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface SanyoLc7461State {
  /** Full 42-bit message value (lossless; re-encoded verbatim). */
  data: bigint;
  /** 13-bit device address. */
  address: number;
  /** 8-bit command. */
  command: number;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Build a raw 42-bit Sanyo LC7461 value from an address + command.
 *
 * Matches IRremoteESP8266 `IRsend::encodeSanyoLC7461`.
 */
export function encodeSanyoLc7461Data(address: number, command: number): bigint {
  const a = address & ADDRESS_MASK;
  const c = command & COMMAND_MASK;
  let data = BigInt(a);
  data = (data << BigInt(ADDRESS_BITS)) | BigInt(a ^ ADDRESS_MASK);
  data = (data << BigInt(COMMAND_BITS)) | BigInt(c);
  data = (data << BigInt(COMMAND_BITS)) | BigInt(c ^ COMMAND_MASK);
  return data;
}

/**
 * Encode a raw 42-bit Sanyo LC7461 value into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendSanyoLC7461` (delegates to `sendNEC`).
 */
export function encodeSanyoLc7461Raw(
  data: bigint,
  nbits: number = SANYO_LC7461_BITS,
  repeat: number = 0,
): number[] {
  return sendNEC(data & MASK42, nbits, repeat);
}

/** Encode a Sanyo LC7461 state into raw IR timings. */
export function sendSanyoLc7461(state: SanyoLc7461State, repeat: number = 0): number[] {
  return encodeSanyoLc7461Raw(state.data & MASK42, SANYO_LC7461_BITS, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Sanyo LC7461 message.
 *
 * Validates the inverted address and command halves.
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeSanyoLc7461(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): SanyoLc7461State | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, SANYO_LC7461_BITS,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MIN_GAP,
    true, undefined, undefined, true, headerOptional,
  );
  if (!result) return null;

  const data = result.data & MASK42;
  const address = Number((data >> 29n) & BigInt(ADDRESS_MASK));
  const invAddress = Number((data >> 16n) & BigInt(ADDRESS_MASK));
  const command = Number((data >> 8n) & BigInt(COMMAND_MASK));
  const invCommand = Number(data & BigInt(COMMAND_MASK));
  if ((address ^ ADDRESS_MASK) !== invAddress) return null;
  if ((command ^ COMMAND_MASK) !== invCommand) return null;

  return { data, address, command };
}
