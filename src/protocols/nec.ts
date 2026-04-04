/**
 * NEC (Renesas) IR protocol encoder.
 *
 * Ported from IRremoteESP8266 `ir_NEC.cpp` / `ir_NEC.h`.
 *
 * @see http://www.sbprojects.net/knowledge/ir/nec.php
 */

import { reverseBits, sendGeneric } from "../encode.js";
import {
  matchMark,
  matchSpace,
  matchAtLeast,
  matchGeneric,
} from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_NEC.h exactly
// ---------------------------------------------------------------------------

const NEC_TICK = 560;
const NEC_HDR_MARK = 16 * NEC_TICK; // 8960
const NEC_HDR_SPACE = 8 * NEC_TICK; // 4480
const NEC_BIT_MARK = 1 * NEC_TICK; // 560
const NEC_ONE_SPACE = 3 * NEC_TICK; // 1680
const NEC_ZERO_SPACE = 1 * NEC_TICK; // 560
const NEC_RPT_SPACE = 4 * NEC_TICK; // 2240
const NEC_BITS = 32;
const NEC_MIN_COMMAND_LENGTH_TICKS = 193;
const NEC_MIN_COMMAND_LENGTH = NEC_MIN_COMMAND_LENGTH_TICKS * NEC_TICK; // 108080
const NEC_MIN_GAP =
  NEC_MIN_COMMAND_LENGTH -
  (NEC_HDR_MARK +
    NEC_HDR_SPACE +
    NEC_BITS * (NEC_BIT_MARK + NEC_ONE_SPACE) +
    NEC_BIT_MARK); // 22400

// ---------------------------------------------------------------------------
// Encode API
// ---------------------------------------------------------------------------

/**
 * Encode a NEC address + command into a raw 32-bit data value suitable for
 * {@link sendNEC}.
 *
 * Supports both normal NEC (8-bit address) and extended NEC (16-bit address).
 *
 * Matches IRremoteESP8266 `IRsend::encodeNEC`.
 */
export function encodeNEC(address: number, command: number): number {
  command &= 0xff;
  // NEC is LSB-first on the wire but sendNEC transmits MSB-first,
  // so we pre-reverse the bits.
  command = reverseBits(command, 8);
  command = (command << 8) | (command ^ 0xff);

  if (address > 0xff) {
    // Extended NEC — 16-bit address, no inverted address byte.
    address = reverseBits(address, 16);
    return ((address << 16) + command) >>> 0;
  }
  // Normal NEC — 8-bit address + inverted address.
  address = reverseBits(address, 8);
  return (((address << 24) + ((address ^ 0xff) << 16) + command) >>> 0);
}

/**
 * Generate raw IR timings for a NEC message.
 *
 * @param data  Raw NEC data (use {@link encodeNEC} to build from address + command).
 * @param nbits Number of data bits (default 32).
 * @param repeat Number of repeat frames to append (default 0).
 * @returns Flat array of alternating mark/space durations in microseconds.
 *
 * Matches IRremoteESP8266 `IRsend::sendNEC`.
 */
export function sendNEC(
  data: number | bigint,
  nbits: number = NEC_BITS,
  repeat: number = 0,
): number[] {
  const d = typeof data === "number" ? BigInt(data) : data;

  // Initial command frame (no internal repeats).
  const result = sendGeneric({
    headerMark: NEC_HDR_MARK,
    headerSpace: NEC_HDR_SPACE,
    oneMark: NEC_BIT_MARK,
    oneSpace: NEC_ONE_SPACE,
    zeroMark: NEC_BIT_MARK,
    zeroSpace: NEC_ZERO_SPACE,
    footerMark: NEC_BIT_MARK,
    gap: NEC_MIN_GAP,
    mesgTime: NEC_MIN_COMMAND_LENGTH,
    data: d,
    nbits,
    msbFirst: true,
  });

  // Optional repeat sequence — header mark + short repeat space + footer mark.
  if (repeat > 0) {
    const rpt = sendGeneric({
      headerMark: NEC_HDR_MARK,
      headerSpace: NEC_RPT_SPACE,
      oneMark: 0,
      oneSpace: 0,
      zeroMark: 0,
      zeroSpace: 0,
      footerMark: NEC_BIT_MARK,
      gap: NEC_MIN_GAP,
      mesgTime: NEC_MIN_COMMAND_LENGTH,
      data: 0n,
      nbits: 0,
      msbFirst: true,
      repeat: repeat - 1,
    });
    for (let i = 0; i < rpt.length; i++) result.push(rpt[i]!);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Decode API
// ---------------------------------------------------------------------------

export interface NECDecodeResult {
  /** Raw 32-bit NEC data (MSB-first). */
  data: number;
  /** Decoded device address. */
  address: number;
  /** Decoded command. */
  command: number;
  /** Whether this is a repeat frame. */
  repeat: boolean;
}

/**
 * Decode raw IR timings as a NEC message.
 *
 * Matches IRremoteESP8266 `IRrecv::decodeNEC`.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @param nbits   Expected number of data bits (default 32).
 * @param strict  If true, enforce NEC constraints (default true).
 * @returns Decoded NEC result, or null if timings don't match.
 */
export function decodeNEC(
  timings: number[],
  offset: number = 0,
  nbits: number = NEC_BITS,
  strict: boolean = true,
): NECDecodeResult | null {
  const remaining = timings.length - offset;

  // Need at least 4 entries for a repeat frame.
  if (remaining < 4) return null;
  if (strict && nbits !== NEC_BITS) return null;

  let pos = offset;

  // 1. Match header mark.
  if (!matchMark(timings[pos]!, NEC_HDR_MARK)) return null;
  pos++;

  // 2. Check for repeat: rptSpace + footerMark (+ optional gap).
  if (pos + 1 < timings.length &&
      matchSpace(timings[pos]!, NEC_RPT_SPACE) &&
      matchMark(timings[pos + 1]!, NEC_BIT_MARK)) {
    if (pos + 2 < timings.length &&
        !matchAtLeast(timings[pos + 2]!, NEC_MIN_GAP)) {
      return null;
    }
    return { data: 0xFFFFFFFF, address: 0, command: 0, repeat: true };
  }

  // 3. Decode header space + data bits + footer via matchGeneric.
  //    Header mark already consumed, so pass headerMark = 0.
  const result = matchGeneric(
    timings, pos, remaining - (pos - offset), nbits,
    0,              // headerMark (already matched)
    NEC_HDR_SPACE,  // headerSpace
    NEC_BIT_MARK,   // oneMark
    NEC_ONE_SPACE,  // oneSpace
    NEC_BIT_MARK,   // zeroMark
    NEC_ZERO_SPACE, // zeroSpace
    NEC_BIT_MARK,   // footerMark
    NEC_MIN_GAP,    // footerSpace (gap)
    true,           // atLeast
  );
  if (!result) return null;

  const data = Number(result.data & 0xFFFFFFFFn);

  // 4. Validate command (inverted complement in bits 7:0).
  let command = (data >> 8) & 0xFF;
  const commandInv = data & 0xFF;
  if ((command ^ 0xFF) !== commandInv) {
    if (strict) return null;
    command = 0;
  }

  // 5. Extract address — normal (8-bit) vs extended (16-bit).
  const addrHi = (data >> 24) & 0xFF;
  const addrLo = (data >> 16) & 0xFF;

  let address: number;
  if (addrHi === (addrLo ^ 0xFF)) {
    address = reverseBits(addrHi, 8);
  } else {
    address = reverseBits((data >> 16) & 0xFFFF, 16);
  }

  return {
    data,
    address,
    command: reverseBits(command, 8),
    repeat: false,
  };
}
