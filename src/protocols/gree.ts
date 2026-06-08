/**
 * Gree A/C IR protocol encoder and decoder.
 *
 * Ported from IRremoteESP8266 `ir_Gree.cpp` / `ir_Gree.h`.
 *
 * Wire format: a 64-bit (8-byte) state sent LSB-first, split into two blocks:
 *
 *   HDR_MARK, HDR_SPACE,
 *   bytes 0-3 (32 bits),
 *   3-bit block footer (0b010),
 *   BIT_MARK, MSG_SPACE,                 ← mid-message gap
 *   bytes 4-7 (32 bits),
 *   BIT_MARK, MSG_SPACE                  ← trailing gap
 *
 * Integrity is a 4-bit Kelvinator-style block checksum stored in the high
 * nibble of the last byte.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1508
 */

import { encodeData } from "../encode.js";
import { matchMark, matchSpace, matchAtLeast, matchData } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Gree.cpp exactly
// ---------------------------------------------------------------------------

const GREE_HDR_MARK = 9000;
const GREE_HDR_SPACE = 4500;
const GREE_BIT_MARK = 620;
const GREE_ONE_SPACE = 1600;
const GREE_ZERO_SPACE = 540;
const GREE_MSG_SPACE = 19980;
/** Gree decodes at the default ±25% tolerance (no extra tolerance in C++). */
const GREE_TOLERANCE = 25;

const GREE_BLOCK_FOOTER = 0b010;
const GREE_BLOCK_FOOTER_BITS = 3;

/** State length in bytes / data bits. */
export const GREE_STATE_LENGTH = 8;
export const GREE_BITS = GREE_STATE_LENGTH * 8;

const GREE_TEMP_MIN_C = 16;
const GREE_TEMP_MAX_C = 30;
const GREE_TIMER_MAX = 24 * 60;
/** Kelvinator block-checksum seed (kKelvinatorChecksumStart). */
const GREE_CHECKSUM_START = 10;

// ---------------------------------------------------------------------------
// Enumerations (the integer values the encoder expects)
// ---------------------------------------------------------------------------

export const GreeMode = {
  Auto: 0,
  Cool: 1,
  Dry: 2,
  Fan: 3,
  Heat: 4,
  Econo: 5,
} as const;
export type GreeModeValue = (typeof GreeMode)[keyof typeof GreeMode];

export const GreeFan = {
  Auto: 0,
  Min: 1,
  Med: 2,
  Max: 3,
} as const;
export type GreeFanValue = (typeof GreeFan)[keyof typeof GreeFan];

export const GreeSwingV = {
  LastPos: 0,
  Auto: 1,
  Up: 2,
  MiddleUp: 3,
  Middle: 4,
  MiddleDown: 5,
  Down: 6,
  DownAuto: 7,
  MiddleAuto: 9,
  UpAuto: 11,
} as const;
export type GreeSwingVValue = (typeof GreeSwingV)[keyof typeof GreeSwingV];

export const GreeSwingH = {
  Off: 0,
  Auto: 1,
  MaxLeft: 2,
  Left: 3,
  Middle: 4,
  Right: 5,
  MaxRight: 6,
} as const;
export type GreeSwingHValue = (typeof GreeSwingH)[keyof typeof GreeSwingH];

export const GreeDisplayTemp = {
  Off: 0,
  Set: 1,
  Inside: 2,
  Outside: 3,
} as const;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface GreeState {
  power?: boolean;
  mode?: number;
  /** Temperature in °C (16–30). Locked to 25 in Auto mode. */
  temp?: number;
  fan?: number;
  /** Vertical swing automatic flag (byte 0). */
  swingAuto?: boolean;
  /** Vertical swing position (see {@link GreeSwingV}). */
  swingV?: number;
  /** Horizontal swing position (see {@link GreeSwingH}). */
  swingH?: number;
  turbo?: boolean;
  /** LED display on the unit. Defaults to true (matches the remote's reset state). */
  light?: boolean;
  sleep?: boolean;
  xfan?: boolean;
  econo?: boolean;
  iFeel?: boolean;
  wifi?: boolean;
  /** Temperature-display source (see {@link GreeDisplayTemp}). */
  displayTemp?: number;
  /** Timer in minutes (0–1440, 30-minute granularity). */
  timerMinutes?: number;
  /** YAW1F model indicator bit. */
  modelA?: boolean;
  /** Use-Fahrenheit flag (preserves the wire bit; temp is always stored in °C). */
  fahrenheit?: boolean;
  /** Extra-degree-Fahrenheit flag (preserves the wire bit). */
  tempExtraDegreeF?: boolean;
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

/** Kelvinator block checksum (low nibbles of bytes 0–3 + high nibbles of 4–6). */
function calcGreeChecksum(state: Uint8Array): number {
  let sum = GREE_CHECKSUM_START;
  for (let i = 0; i < 4; i++) sum += state[i]! & 0x0f;
  for (let i = 4; i < GREE_STATE_LENGTH - 1; i++) sum += state[i]! >> 4;
  return sum & 0x0f;
}

/** Validate the checksum in the high nibble of the last byte. */
export function validGreeChecksum(state: Uint8Array): boolean {
  if (state.length < GREE_STATE_LENGTH) return false;
  return (state[GREE_STATE_LENGTH - 1]! >> 4) === calcGreeChecksum(state);
}

// ---------------------------------------------------------------------------
// Build raw bytes from state
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Build a raw 8-byte Gree code (with checksum) from a state object.
 *
 * Replicates the C++ class's mode-dependent locks: Auto forces 25 °C, Dry
 * forces fan speed 1.
 */
export function buildGreeRaw(state: GreeState): Uint8Array {
  const data = new Uint8Array(GREE_STATE_LENGTH);

  let mode = state.mode ?? GreeMode.Auto;
  if (mode < GreeMode.Auto || mode > GreeMode.Econo) mode = GreeMode.Auto;

  let fan = clamp(state.fan ?? GreeFan.Auto, GreeFan.Auto, GreeFan.Max);
  if (mode === GreeMode.Dry) fan = 1;

  let tempC = clamp(state.temp ?? 25, GREE_TEMP_MIN_C, GREE_TEMP_MAX_C);
  if (mode === GreeMode.Auto) tempC = 25;
  const tempField = tempC - GREE_TEMP_MIN_C;

  const power = state.power ?? false;
  const light = state.light ?? true;

  // Timer (minutes → enabled + half-hour + tens/units of hours).
  const timer = clamp(state.timerMinutes ?? 0, 0, GREE_TIMER_MAX);
  const timerEnabled = timer >= 30;
  const hours = Math.floor(timer / 60);
  const halfHr = timer % 60 >= 30;
  const tensHr = Math.floor(hours / 10);
  const unitHr = hours % 10;

  const swingV = (state.swingV ?? GreeSwingV.LastPos) & 0x0f;
  const swingH = (state.swingH ?? GreeSwingH.Off) & 0x07;
  const displayTemp = (state.displayTemp ?? GreeDisplayTemp.Off) & 0x03;

  // Byte 0
  data[0] =
    (mode & 0x7) |
    ((power ? 1 : 0) << 3) |
    ((fan & 0x3) << 4) |
    ((state.swingAuto ? 1 : 0) << 6) |
    ((state.sleep ? 1 : 0) << 7);
  // Byte 1
  data[1] =
    (tempField & 0xf) |
    ((halfHr ? 1 : 0) << 4) |
    ((tensHr & 0x3) << 5) |
    ((timerEnabled ? 1 : 0) << 7);
  // Byte 2
  data[2] =
    (unitHr & 0xf) |
    ((state.turbo ? 1 : 0) << 4) |
    ((light ? 1 : 0) << 5) |
    ((state.modelA ? 1 : 0) << 6) |
    ((state.xfan ? 1 : 0) << 7);
  // Byte 3 — unknown1 (bits 4-7) is a fixed 0b0101.
  data[3] =
    ((state.tempExtraDegreeF ? 1 : 0) << 2) |
    ((state.fahrenheit ? 1 : 0) << 3) |
    (0b0101 << 4);
  // Byte 4
  data[4] = swingV | (swingH << 4);
  // Byte 5 — unknown2 (bits 3-5) is a fixed 0b100.
  data[5] =
    displayTemp |
    ((state.iFeel ? 1 : 0) << 2) |
    (0b100 << 3) |
    ((state.wifi ? 1 : 0) << 6);
  // Byte 6 — reserved.
  data[6] = 0;
  // Byte 7 — Econo (bit 2) + checksum (high nibble).
  data[7] = (state.econo ? 1 : 0) << 2;
  data[7] = (data[7] & 0x0f) | (calcGreeChecksum(data) << 4);

  return data;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

function pushBits(out: number[], value: number, nbits: number): void {
  const bits = encodeData(
    GREE_BIT_MARK, GREE_ONE_SPACE,
    GREE_BIT_MARK, GREE_ZERO_SPACE,
    BigInt(value), nbits, false, // LSB-first
  );
  for (let i = 0; i < bits.length; i++) out.push(bits[i]!);
}

/**
 * Encode a raw 8-byte Gree code into IR timings.
 * Matches IRremoteESP8266 `IRsend::sendGree`.
 */
export function encodeGreeRaw(data: Uint8Array, repeat: number = 0): number[] {
  const out: number[] = [];

  for (let r = 0; r <= repeat; r++) {
    // Header
    out.push(GREE_HDR_MARK, GREE_HDR_SPACE);
    // Block #1: bytes 0-3 (no footer)
    for (let i = 0; i < 4; i++) pushBits(out, data[i]!, 8);
    // Block #1 footer (3 bits) + mid-message gap
    pushBits(out, GREE_BLOCK_FOOTER, GREE_BLOCK_FOOTER_BITS);
    out.push(GREE_BIT_MARK, GREE_MSG_SPACE);
    // Block #2: bytes 4-7
    for (let i = 4; i < GREE_STATE_LENGTH; i++) pushBits(out, data[i]!, 8);
    // Trailing footer
    out.push(GREE_BIT_MARK, GREE_MSG_SPACE);
  }

  return out;
}

/** Encode a Gree A/C state into raw IR timings. */
export function sendGree(state: GreeState, repeat: number = 0): number[] {
  return encodeGreeRaw(buildGreeRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

export interface GreeRawResult {
  data: Uint8Array;
  used: number;
}

function matchByteLSB(timings: number[], pos: number): { value: number; used: number } | null {
  const r = matchData(
    timings, pos, 8,
    GREE_BIT_MARK, GREE_ONE_SPACE,
    GREE_BIT_MARK, GREE_ZERO_SPACE,
    GREE_TOLERANCE, undefined, false, // LSB-first; C++ decodeGree uses global mark-excess (50µs)
  );
  if (!r.success) return null;
  return { value: Number(r.data & 0xffn), used: r.used };
}

/**
 * Decode raw IR timings into a raw 8-byte Gree code.
 *
 * Validates the block footer and the Kelvinator checksum.
 *
 * @returns Raw bytes and entries consumed, or null on mismatch.
 */
export function decodeGreeRaw(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): GreeRawResult | null {
  let pos = offset;
  const len = timings.length;

  // Minimum: 64 data bits(128) + 3 footer bits(6) + 2 gaps(4) - last gap = ~137.
  if (len - offset < 137) return null;

  // Header
  if (
    pos + 1 < len &&
    matchMark(timings[pos]!, GREE_HDR_MARK, GREE_TOLERANCE) &&
    matchSpace(timings[pos + 1]!, GREE_HDR_SPACE, GREE_TOLERANCE)
  ) {
    pos += 2;
  } else if (!headerOptional) {
    return null;
  }

  const data = new Uint8Array(GREE_STATE_LENGTH);

  // Block #1: bytes 0-3
  for (let i = 0; i < 4; i++) {
    const b = matchByteLSB(timings, pos);
    if (!b) return null;
    data[i] = b.value;
    pos += b.used;
  }

  // Block footer: 3 bits, must be 0b010
  const footer = matchData(
    timings, pos, GREE_BLOCK_FOOTER_BITS,
    GREE_BIT_MARK, GREE_ONE_SPACE,
    GREE_BIT_MARK, GREE_ZERO_SPACE,
    GREE_TOLERANCE, undefined, false,
  );
  if (!footer.success || Number(footer.data) !== GREE_BLOCK_FOOTER) return null;
  pos += footer.used;

  // Mid-message gap: bit mark + msg space
  if (pos + 1 >= len) return null;
  if (!matchMark(timings[pos]!, GREE_BIT_MARK, GREE_TOLERANCE)) return null;
  if (!matchSpace(timings[pos + 1]!, GREE_MSG_SPACE, GREE_TOLERANCE)) return null;
  pos += 2;

  // Block #2: bytes 4-7
  for (let i = 4; i < GREE_STATE_LENGTH; i++) {
    const b = matchByteLSB(timings, pos);
    if (!b) return null;
    data[i] = b.value;
    pos += b.used;
  }

  // Trailing footer mark
  if (pos >= len) return null;
  if (!matchMark(timings[pos]!, GREE_BIT_MARK, GREE_TOLERANCE)) return null;
  pos++;
  // Trailing gap (optional — may be the last frame)
  if (pos < len) {
    if (!matchAtLeast(timings[pos]!, GREE_MSG_SPACE, GREE_TOLERANCE)) return null;
    pos++;
  }

  if (!validGreeChecksum(data)) return null;

  return { data, used: pos - offset };
}

/** Parse a raw 8-byte Gree code into a state object. */
export function parseGreeState(data: Uint8Array): GreeState {
  const b0 = data[0]!, b1 = data[1]!, b2 = data[2]!,
    b3 = data[3]!, b4 = data[4]!, b5 = data[5]!, b7 = data[7]!;

  const halfHr = (b1 >> 4) & 1;
  const tensHr = (b1 >> 5) & 0x3;
  const unitHr = b2 & 0xf;
  const timerMinutes = (tensHr * 10 + unitHr) * 60 + (halfHr ? 30 : 0);

  return {
    power: !!((b0 >> 3) & 1),
    mode: b0 & 0x7,
    fan: (b0 >> 4) & 0x3,
    swingAuto: !!((b0 >> 6) & 1),
    sleep: !!((b0 >> 7) & 1),
    temp: GREE_TEMP_MIN_C + (b1 & 0xf),
    timerMinutes,
    turbo: !!((b2 >> 4) & 1),
    light: !!((b2 >> 5) & 1),
    modelA: !!((b2 >> 6) & 1),
    xfan: !!((b2 >> 7) & 1),
    tempExtraDegreeF: !!((b3 >> 2) & 1),
    fahrenheit: !!((b3 >> 3) & 1),
    swingV: b4 & 0xf,
    swingH: (b4 >> 4) & 0x7,
    displayTemp: b5 & 0x3,
    iFeel: !!((b5 >> 2) & 1),
    wifi: !!((b5 >> 6) & 1),
    econo: !!((b7 >> 2) & 1),
  };
}

/**
 * Decode raw IR timings as a Gree A/C state.
 *
 * @param timings        Raw mark/space timing array in microseconds.
 * @param offset         Starting index in the timings array (default 0).
 * @param headerOptional Allow a missing header (default false).
 * @returns Decoded state (same shape as encode input), or null.
 */
export function decodeGree(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): GreeState | null {
  const raw = decodeGreeRaw(timings, offset, headerOptional);
  if (!raw) return null;
  return parseGreeState(raw.data);
}
