/**
 * Panasonic 48-bit IR protocol encoder and decoder. (PANASONIC)
 *
 * Ported from IRremoteESP8266 `ir_Panasonic.cpp` / `ir_Panasonic.h`.
 * This is the classic Panasonic remote protocol (TVs etc.) — a modified
 * Kaseikyo. It is a simple value-carrying protocol, not an A/C state protocol.
 *
 * Wire format: 3456/1728 header + 48 bits (MSB-first) + footer. The 48 bits are
 * `manufacturer(16) | device(8) | subdevice(8) | function(8) | checksum(8)`,
 * where `checksum = device ^ subdevice ^ function`. The manufacturer code is
 * `0x4004` for genuine Panasonic devices.
 *
 * @see http://www.remotecentral.com/cgi-bin/mboard/rc-pronto/thread.cgi?2615
 * @see http://www.hifi-remote.com/wiki/index.php?title=Panasonic
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Panasonic.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3456;
const HDR_SPACE = 1728;
const BIT_MARK = 432;
const ONE_SPACE = 1296;
const ZERO_SPACE = 432;
const MIN_COMMAND_LENGTH = 163296;
const MIN_GAP = 74736;
const END_GAP = 5000;

export const PANASONIC_BITS = 48;
/** Default Panasonic manufacturer code. */
export const PANASONIC_MANUFACTURER = 0x4004;

const MASK48 = (1n << 48n) - 1n;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface PanasonicState {
  /** Full 48-bit message value (lossless; re-encoded verbatim). */
  data: bigint;
  /** 16-bit manufacturer code (0x4004 for genuine Panasonic). */
  manufacturer: number;
  /** 8-bit device code. */
  device: number;
  /** 8-bit subdevice code. */
  subdevice: number;
  /** 8-bit function/command code. */
  function: number;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Compute the raw 48-bit Panasonic value from its component codes.
 *
 * Matches IRremoteESP8266 `IRsend::encodePanasonic`.
 */
export function encodePanasonicData(
  manufacturer: number,
  device: number,
  subdevice: number,
  fn: number,
): bigint {
  const checksum = (device ^ subdevice ^ fn) & 0xff;
  return (
    (BigInt(manufacturer & 0xffff) << 32n) |
    (BigInt(device & 0xff) << 24n) |
    (BigInt(subdevice & 0xff) << 16n) |
    (BigInt(fn & 0xff) << 8n) |
    BigInt(checksum)
  );
}

/**
 * Encode a raw 48-bit Panasonic value into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendPanasonic64`.
 */
export function encodePanasonicRaw(
  data: bigint,
  nbits: number = PANASONIC_BITS,
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
    mesgTime: MIN_COMMAND_LENGTH,
    data: data & MASK48,
    nbits,
    msbFirst: true,
    repeat,
  });
}

/** Encode a Panasonic state into raw IR timings. */
export function sendPanasonic(state: PanasonicState, repeat: number = 0): number[] {
  return encodePanasonicRaw(state.data & MASK48, PANASONIC_BITS, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Panasonic 48-bit message.
 *
 * Validates the manufacturer code and the XOR checksum.
 *
 * Matches IRremoteESP8266 `IRrecv::decodePanasonic`.
 *
 * @returns Decoded state, or null on mismatch / failed compliance.
 */
export function decodePanasonic(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): PanasonicState | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, PANASONIC_BITS,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, END_GAP,
    true, undefined, undefined, true, headerOptional,
  );
  if (!result) return null;

  const data = result.data & MASK48;
  const manufacturer = Number(data >> 32n);
  if (manufacturer !== PANASONIC_MANUFACTURER) return null;

  const device = Number((data >> 24n) & 0xffn);
  const subdevice = Number((data >> 16n) & 0xffn);
  const fn = Number((data >> 8n) & 0xffn);
  const checksum = Number(data & 0xffn);
  if (((device ^ subdevice ^ fn) & 0xff) !== checksum) return null;

  return { data, manufacturer, device, subdevice, function: fn };
}
