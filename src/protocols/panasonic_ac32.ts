/**
 * Panasonic 32-bit A/C IR protocol encoder and decoder. (PANASONIC_AC32)
 *
 * Ported from IRremoteESP8266 `ir_Panasonic.cpp` / `ir_Panasonic.h`.
 * Models: Panasonic CS-E9CKP series, A75C2295 / A75C4762 remotes.
 *
 * Wire format (the "long" 32-bit form): two sections, each containing two
 * identical 32-bit data blocks plus a section footer. Within a block every
 * byte of the 16-bit section value is transmitted twice, so 32 transmitted
 * bits carry 16 unique bits per section (32 unique bits total).
 *
 * The on-wire framing relies on the same alternating mark/space accumulation
 * IRremoteESP8266's hardware uses — consecutive spaces merge and zero-length
 * gaps are absorbed — so we reproduce that accumulator here rather than
 * concatenating frame slices.
 *
 * Power is a TOGGLE: each message flips the unit's power rather than setting an
 * absolute state.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1307
 */

import { matchMark, matchSpace, matchAtLeast, matchData } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Panasonic.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3543;
const HDR_SPACE = 3450;
const BIT_MARK = 920;
const ONE_SPACE = 2575;
const ZERO_SPACE = 828;
const SECTION_GAP = 13946;
const TOLERANCE = 25;

export const PANASONIC_AC32_BITS = 32;
const SECTIONS = 2;
const BLOCKS_PER_SECTION = 2;

const MIN_TEMP = 16;
const MAX_TEMP = 30;
const TEMP_OFFSET = MIN_TEMP - 1;

const MASK64 = (1n << 64n) - 1n;
const MASK32 = (1n << 32n) - 1n;

/** Reset value from `IRPanasonicAc32::stateReset` (Cool, Auto fan, 16°C). */
export const PANASONIC_AC32_KNOWN_GOOD = 0x0af136fcn;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const PanasonicAc32Mode = {
  Fan: 1,
  Cool: 2,
  Dry: 3,
  Heat: 4,
  Auto: 6,
} as const;
export type PanasonicAc32ModeValue = (typeof PanasonicAc32Mode)[keyof typeof PanasonicAc32Mode];

export const PanasonicAc32Fan = {
  Min: 2,
  Low: 3,
  Med: 4,
  High: 5,
  Max: 6,
  Auto: 0xf,
} as const;
export type PanasonicAc32FanValue = (typeof PanasonicAc32Fan)[keyof typeof PanasonicAc32Fan];

export const PanasonicAc32SwingV = {
  Highest: 0x1,
  High: 0x2,
  Middle: 0x3,
  Low: 0x4,
  Lowest: 0x5,
  Auto: 0x7,
} as const;
export type PanasonicAc32SwingVValue = (typeof PanasonicAc32SwingV)[keyof typeof PanasonicAc32SwingV];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface PanasonicAc32State {
  /** Power toggle — sending the message flips the unit's power. */
  powerToggle?: boolean;
  /** Temperature in °C (16–30). */
  temp?: number;
  mode?: PanasonicAc32ModeValue;
  fan?: PanasonicAc32FanValue;
  swingV?: PanasonicAc32SwingVValue;
  swingH?: boolean;
}

// ---------------------------------------------------------------------------
// Build raw 32-bit value from state
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function setBits(raw: bigint, off: number, size: number, val: number): bigint {
  const mask = ((1n << BigInt(size)) - 1n) << BigInt(off);
  return (raw & ~mask) | ((BigInt(val) << BigInt(off)) & mask);
}

/**
 * Build the raw 32-bit Panasonic AC32 value from a state.
 *
 * Emulates `IRPanasonicAc32`'s setters over the known-good reset value, so
 * reserved bits (`0x36` marker byte, padding) are preserved.
 */
export function buildPanasonicAc32Raw(state: PanasonicAc32State): bigint {
  let raw = PANASONIC_AC32_KNOWN_GOOD;

  // Mode (bits 24-26) — unknown values fall back to Auto.
  let mode: number = state.mode ?? PanasonicAc32Mode.Cool;
  switch (mode) {
    case PanasonicAc32Mode.Fan:
    case PanasonicAc32Mode.Cool:
    case PanasonicAc32Mode.Dry:
    case PanasonicAc32Mode.Heat:
    case PanasonicAc32Mode.Auto:
      break;
    default:
      mode = PanasonicAc32Mode.Auto;
  }
  raw = setBits(raw, 24, 3, mode);

  // Temp (bits 16-19) — clamped, stored offset by (MIN_TEMP - 1).
  raw = setBits(raw, 16, 4, clamp(state.temp ?? MIN_TEMP, MIN_TEMP, MAX_TEMP) - TEMP_OFFSET);

  // Fan (bits 20-23) — unknown values fall back to Auto.
  let fan: number = state.fan ?? PanasonicAc32Fan.Auto;
  switch (fan) {
    case PanasonicAc32Fan.Min:
    case PanasonicAc32Fan.Low:
    case PanasonicAc32Fan.Med:
    case PanasonicAc32Fan.High:
    case PanasonicAc32Fan.Max:
    case PanasonicAc32Fan.Auto:
      break;
    default:
      fan = PanasonicAc32Fan.Auto;
  }
  raw = setBits(raw, 20, 4, fan);

  // Vertical swing (bits 4-6) — clamped to [Highest, Lowest] unless Auto.
  let swingV: number = state.swingV ?? PanasonicAc32SwingV.Auto;
  if (swingV !== PanasonicAc32SwingV.Auto) {
    swingV = clamp(swingV, PanasonicAc32SwingV.Highest, PanasonicAc32SwingV.Lowest);
  }
  raw = setBits(raw, 4, 3, swingV);

  // Horizontal swing (bit 3).
  raw = setBits(raw, 3, 1, state.swingH ? 1 : 0);

  // Power toggle (bit 27) — stored inverted (PowerToggle field = !on).
  raw = setBits(raw, 27, 1, state.powerToggle ? 0 : 1);

  return raw & MASK32;
}

// ---------------------------------------------------------------------------
// Parse a raw 32-bit value into a state
// ---------------------------------------------------------------------------

/** Parse a raw 32-bit Panasonic AC32 value into a state object. */
export function parsePanasonicAc32(raw: bigint): PanasonicAc32State {
  const v = raw & MASK32;
  return {
    powerToggle: ((v >> 27n) & 1n) === 0n,
    temp: Number((v >> 16n) & 0xfn) + TEMP_OFFSET,
    mode: Number((v >> 24n) & 0x7n) as PanasonicAc32ModeValue,
    fan: Number((v >> 20n) & 0xfn) as PanasonicAc32FanValue,
    swingV: Number((v >> 4n) & 0x7n) as PanasonicAc32SwingVValue,
    swingH: ((v >> 3n) & 1n) === 1n,
  };
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Mark/space accumulator mirroring IRremoteESP8266's `IRsendTest`: consecutive
 * marks (or spaces) merge into one entry, and zero-length pulses are absorbed.
 */
function makeAccumulator() {
  const output: number[] = [0];
  let last = 0; // even index = mark slot, odd = space slot
  return {
    mark(usec: number): void {
      if (last & 1) output[++last] = usec;
      else output[last] = output[last]! + usec;
    },
    space(time: number): void {
      if (last & 1) output[last] = output[last]! + time;
      else output[++last] = time;
    },
    result(): number[] {
      return output.slice(0, last + 1);
    },
  };
}

type Acc = ReturnType<typeof makeAccumulator>;

/** Mirror of `IRsend::sendData` — emit `nbits` of `data` as mark/space pairs. */
function sendDataInto(
  acc: Acc, oneMark: number, oneSpace: number, zeroMark: number, zeroSpace: number,
  data: bigint, nbits: number, msbFirst: boolean,
): void {
  if (nbits === 0) return;
  if (msbFirst) {
    for (let mask = 1n << BigInt(nbits - 1); mask; mask >>= 1n) {
      if (data & mask) { acc.mark(oneMark); acc.space(oneSpace); }
      else { acc.mark(zeroMark); acc.space(zeroSpace); }
    }
  } else {
    let d = data;
    for (let i = 0; i < nbits; i++, d >>= 1n) {
      if (d & 1n) { acc.mark(oneMark); acc.space(oneSpace); }
      else { acc.mark(zeroMark); acc.space(zeroSpace); }
    }
  }
}

interface GenericInto {
  headerMark: number; headerSpace: number;
  oneMark: number; oneSpace: number; zeroMark: number; zeroSpace: number;
  footerMark: number; gap: number;
  data: bigint; nbits: number; msbFirst: boolean; repeat: number;
}

/** Mirror of `IRsend::sendGeneric` (no mesgtime) driving the accumulator. */
function sendGenericInto(acc: Acc, o: GenericInto): void {
  for (let r = 0; r <= o.repeat; r++) {
    if (o.headerMark) acc.mark(o.headerMark);
    if (o.headerSpace) acc.space(o.headerSpace);
    sendDataInto(acc, o.oneMark, o.oneSpace, o.zeroMark, o.zeroSpace, o.data, o.nbits, o.msbFirst);
    if (o.footerMark) acc.mark(o.footerMark);
    acc.space(o.gap);
  }
}

/**
 * Encode a raw 32-bit Panasonic AC32 value into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendPanasonicAC32`.
 */
export function encodePanasonicAc32Raw(
  data: bigint,
  nbits: number = PANASONIC_AC32_BITS,
  repeat: number = 0,
): number[] {
  let sectionBits: number;
  let sections: number;
  let blocks: number;
  if (nbits > PANASONIC_AC32_BITS / 2) {
    sectionBits = Math.trunc(nbits / SECTIONS);
    sections = SECTIONS;
    blocks = BLOCKS_PER_SECTION;
  } else {
    sectionBits = nbits;
    sections = SECTIONS - 1;
    blocks = BLOCKS_PER_SECTION + 1;
  }

  const acc = makeAccumulator();
  for (let r = 0; r <= repeat; r++) {
    for (let section = 0; section < sections; section++) {
      let sectionData =
        (data >> BigInt(sectionBits * (sections - section - 1))) &
        ((1n << BigInt(sectionBits)) - 1n);

      // Duplicate every byte of the section data.
      let expanded = 0n;
      for (let i = 0; i < 8; i++) {
        const firstByte = (sectionData >> 56n) & 0xffn;
        for (let j = 0; j < 2; j++) expanded = ((expanded << 8n) | firstByte) & MASK64;
        sectionData = (sectionData << 8n) & MASK64;
      }

      // Two data blocks per section (1 + repeat), no footer, zero gap.
      sendGenericInto(acc, {
        headerMark: HDR_MARK, headerSpace: HDR_SPACE,
        oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
        footerMark: 0, gap: 0,
        data: expanded & MASK64, nbits: sectionBits * 2, msbFirst: false, repeat: blocks - 1,
      });
      // Section footer: header + footer mark + section gap, no data.
      sendGenericInto(acc, {
        headerMark: HDR_MARK, headerSpace: HDR_SPACE,
        oneMark: 0, oneSpace: 0, zeroMark: 0, zeroSpace: 0,
        footerMark: BIT_MARK, gap: SECTION_GAP,
        data: 0n, nbits: 0, msbFirst: true, repeat: 0,
      });
    }
  }
  return acc.result();
}

/** Encode a Panasonic AC32 state into raw IR timings. */
export function sendPanasonicAc32(state: PanasonicAc32State, repeat: number = 0): number[] {
  return encodePanasonicAc32Raw(buildPanasonicAc32Raw(state), PANASONIC_AC32_BITS, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Panasonic AC32 (long, 32-bit) message.
 *
 * Validates the two-section / two-block structure and the per-byte duplication
 * that the protocol uses in place of a checksum.
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodePanasonicAc32(
  timings: number[],
  offset: number = 0,
  _headerOptional: boolean = false,
): PanasonicAc32State | null {
  void _headerOptional; // header is structural here; cannot be skipped.
  let pos = offset;
  const sectionValues: number[] = [];
  let prevBlock = 0;

  for (let block = 0; block < SECTIONS * BLOCKS_PER_SECTION; block++) {
    // Block header.
    if (pos + 1 >= timings.length) return null;
    if (!matchMark(timings[pos]!, HDR_MARK, TOLERANCE)) return null;
    pos++;
    if (!matchSpace(timings[pos]!, HDR_SPACE, TOLERANCE)) return null;
    pos++;

    // 32 transmitted (= 16 unique) bits, LSB-first, no footer.
    const dr = matchData(
      timings, pos, PANASONIC_AC32_BITS,
      BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
      // C++ decodePanasonicAC32 uses the global mark-excess (50µs).
      TOLERANCE, undefined, false, true,
    );
    if (!dr.success) return null;
    pos += dr.used;

    const expanded = Number(dr.data & MASK32);
    if (block % BLOCKS_PER_SECTION === 0) {
      // First block of a section: undo the byte duplication.
      const b3 = (expanded >>> 24) & 0xff;
      const b2 = (expanded >>> 16) & 0xff;
      const b1 = (expanded >>> 8) & 0xff;
      const b0 = expanded & 0xff;
      if (b3 !== b2 || b1 !== b0) return null;
      sectionValues.push((b3 << 8) | b1);
      prevBlock = expanded;
    } else {
      // Subsequent block must repeat the first block of the section.
      if (expanded !== prevBlock) return null;
    }

    // Section footer after the last block of the section.
    if ((block + 1) % BLOCKS_PER_SECTION === 0) {
      if (pos + 2 >= timings.length) return null;
      if (!matchMark(timings[pos]!, HDR_MARK, TOLERANCE)) return null;
      pos++;
      if (!matchSpace(timings[pos]!, HDR_SPACE, TOLERANCE)) return null;
      pos++;
      if (!matchMark(timings[pos]!, BIT_MARK, TOLERANCE)) return null;
      pos++;
      // Section gap — present except possibly on a truncated final frame.
      if (pos < timings.length && !matchAtLeast(timings[pos]!, SECTION_GAP, TOLERANCE)) return null;
      pos++;
    }
  }

  const value = ((sectionValues[0]! << 16) | sectionValues[1]!) >>> 0;
  return parsePanasonicAc32(BigInt(value));
}
