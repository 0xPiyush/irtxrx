/**
 * Lloyd A/C IR protocol encoder and decoder. (LLOYD)
 *
 * Reverse-engineered from real hardware captures (a Lloyd remote); this
 * protocol is NOT present in IRremoteESP8266, so there is no C++ reference and
 * no cross-validation runner — it is validated against captured frames and
 * encode↔decode roundtrips.
 *
 * Wire format: a 15-byte (120-bit) MSB-first message using constant-mark
 * pulse-distance encoding with NO header — a `1` bit is the long space
 * (~2540µs) and a `0` bit the short space (~580µs). The frame ends with a
 * single bit-mark and an inter-message gap. The last byte is a one's-complement
 * byte-sum checksum.
 *
 * STATUS: PARTIAL. Power/mode/fan/temp/turbo/sleep/eco/swing/display are
 * decoded; timer/clock (bytes 5–8) and a few reserved bits are not yet mapped.
 * See docs/superpowers/specs/2026-06-11-lloyd-protocol-design.md.
 */

import { sendGenericBytes, sumBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — measured from captures (no C++ reference exists)
// ---------------------------------------------------------------------------

const BIT_MARK = 1020; // constant mark (observed 1007–1068)
const ONE_SPACE = 2540; // bit 1 (observed 2532–2563)
const ZERO_SPACE = 580; // bit 0 (observed 549–610)
const GAP = 100000; // kDefaultMessageGap
/** Generous tolerance to absorb the observed hardware timing spread. */
const TOLERANCE = 35;

export const LLOYD_STATE_LENGTH = 15;

const LLOYD_TEMP_MIN = 16;
const LLOYD_TEMP_MAX = 30;

/** Constant signature bytes that prefix every frame. */
const LLOYD_SIG0 = 0x36;
const LLOYD_SIG1 = 0x0f;
/** Constant base value of byte 10 (eco bits OR'd in on top). */
const LLOYD_B10_BASE = 0x80;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Operating mode — one-hot in the low 5 bits of byte 2. */
export const LloydMode = {
  Fan: 0x01,
  Heat: 0x02,
  Dry: 0x04,
  Cool: 0x08,
  Auto: 0x10,
} as const;
export type LloydModeValue = (typeof LloydMode)[keyof typeof LloydMode];

/** Fan speed — high 3 bits of byte 2 (Auto = all three set). */
export const LloydFan = {
  High: 0x20,
  Med: 0x40,
  Low: 0x80,
  Auto: 0xe0,
} as const;
export type LloydFanValue = (typeof LloydFan)[keyof typeof LloydFan];

/** Vertical-swing codes (low nibble of byte 3). 0=off, 1–5 increasing angle,
 *  7=full swing. NOTE: exact angle↔code labels are unconfirmed (code 6 unseen). */
export const LloydSwingV = {
  Off: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
  P5: 5,
  Swing: 7,
} as const;
export type LloydSwingVValue = (typeof LloydSwingV)[keyof typeof LloydSwingV];

// Byte 3 bit flags.
const B3_POWER = 0x80;
const B3_SLEEP = 0x40;
const B3_TURBO = 0x20;
const B3_SWINGV_MASK = 0x0f;
// Byte 9 bit flags.
const B9_FAN_MODE = 0x80;
const B9_DISPLAY = 0x08;
const B9_HSWING = 0x02;
// Byte 10.
const B10_ECO = 0x03;
// Byte 2 field masks.
const B2_FAN_MASK = 0xe0;
const B2_MODE_MASK = 0x1f;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface LloydState {
  power: boolean;
  mode: LloydModeValue;
  /** Fan speed (Auto/Low/Med/High). */
  fan: LloydFanValue;
  /** Temperature in °C (16–30). */
  temp: number;
  turbo: boolean;
  sleep: boolean;
  /** Energy-saving / economy mode. */
  eco: boolean;
  /** Vertical swing: 0=off, 1–5 fixed angle, 7=full swing (see {@link LloydSwingV}). */
  swingV: number;
  /** Horizontal (left/right) swing on/off. */
  swingH: boolean;
  /** Display / panel light on. */
  display: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Default state — Cool, 24°C, Fan Auto, everything else off, display on. */
export function defaultLloydState(): LloydState {
  return {
    power: true,
    mode: LloydMode.Cool,
    fan: LloydFan.Auto,
    temp: 24,
    turbo: false,
    sleep: false,
    eco: false,
    swingV: LloydSwingV.Off,
    swingH: false,
    display: true,
  };
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

/** Lloyd checksum: one's-complement of the byte sum of B0..B13. */
export function lloydChecksum(data: Uint8Array): number {
  return (~sumBytes(data, 0, LLOYD_STATE_LENGTH - 1)) & 0xff;
}

// ---------------------------------------------------------------------------
// Build raw 15-byte payload from state
// ---------------------------------------------------------------------------

/** Build the raw 15-byte Lloyd frame (including checksum) from a state. */
export function buildLloydRaw(state: LloydState): Uint8Array {
  const data = new Uint8Array(LLOYD_STATE_LENGTH);

  data[0] = LLOYD_SIG0;
  data[1] = LLOYD_SIG1;

  // Defaults guard partial states (e.g. from the canonical layer).
  const mode = state.mode ?? LloydMode.Cool;
  const fan = state.fan ?? LloydFan.Auto;
  const temp = state.temp ?? 24;
  const swingV = state.swingV ?? LloydSwingV.Off;

  // Byte 2: fan (high 3 bits) | mode (low 5 bits, one-hot).
  data[2] = (fan & B2_FAN_MASK) | (mode & B2_MODE_MASK);

  // Byte 3: power | sleep | turbo | swingV(low nibble).
  data[3] =
    (state.power ? B3_POWER : 0) |
    (state.sleep ? B3_SLEEP : 0) |
    (state.turbo ? B3_TURBO : 0) |
    (swingV & B3_SWINGV_MASK);

  // Byte 4: temperature × 2 (bit0 reserved / half-degree, unused).
  data[4] = clamp(Math.round(temp), LLOYD_TEMP_MIN, LLOYD_TEMP_MAX) << 1;

  // Bytes 5–8: unmapped (timer/clock) — left zero.

  // Byte 9: fan-mode flag (derived: set iff mode is Fan) | display | h-swing.
  data[9] =
    (mode === LloydMode.Fan ? B9_FAN_MODE : 0) |
    (state.display ? B9_DISPLAY : 0) |
    (state.swingH ? B9_HSWING : 0);

  // Byte 10: constant base | eco.
  data[10] = LLOYD_B10_BASE | (state.eco ? B10_ECO : 0);

  // Bytes 11–13: unmapped — left zero.

  data[14] = lloydChecksum(data);
  return data;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw 15-byte Lloyd payload into IR timings (MSB-first, no header). */
export function encodeLloydRaw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: 0,
    headerSpace: 0,
    oneMark: BIT_MARK,
    oneSpace: ONE_SPACE,
    zeroMark: BIT_MARK,
    zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK,
    gap: GAP,
    data,
    msbFirst: true,
    repeat,
  });
}

/** Encode a Lloyd A/C state into raw IR timings. */
export function sendLloyd(state: LloydState, repeat: number = 0): number[] {
  return encodeLloydRaw(buildLloydRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a raw 15-byte Lloyd frame into a state, or null on bad signature/checksum. */
export function parseLloydState(data: Uint8Array): LloydState | null {
  if (data.length < LLOYD_STATE_LENGTH) return null;
  if (data[0] !== LLOYD_SIG0 || data[1] !== LLOYD_SIG1) return null;
  if (data[14] !== lloydChecksum(data)) return null;

  return {
    power: (data[3]! & B3_POWER) !== 0,
    mode: (data[2]! & B2_MODE_MASK) as LloydModeValue,
    fan: (data[2]! & B2_FAN_MASK) as LloydFanValue,
    temp: data[4]! >> 1,
    turbo: (data[3]! & B3_TURBO) !== 0,
    sleep: (data[3]! & B3_SLEEP) !== 0,
    eco: (data[10]! & B10_ECO) !== 0,
    swingV: data[3]! & B3_SWINGV_MASK,
    swingH: (data[9]! & B9_HSWING) !== 0,
    display: (data[9]! & B9_DISPLAY) !== 0,
  };
}

/**
 * Decode raw IR timings as a Lloyd A/C state.
 *
 * @param timings        Raw mark/space timing array in microseconds.
 * @param offset         Starting index in the timings array (default 0).
 * @param headerOptional Unused (Lloyd has no header); accepted for a uniform
 *                       decoder signature.
 * @returns Decoded state, or null on mismatch / bad signature / bad checksum.
 */
export function decodeLloyd(
  timings: number[],
  offset: number = 0,
  _headerOptional: boolean = false,
): LloydState | null {
  const frame = matchGenericBytes(
    timings,
    offset,
    timings.length - offset,
    LLOYD_STATE_LENGTH,
    0,
    0, // no header
    BIT_MARK,
    ONE_SPACE,
    BIT_MARK,
    ZERO_SPACE,
    BIT_MARK,
    0, // footer space: hardware captures rarely include a full gap — don't require one
    true,
    TOLERANCE,
    undefined,
    true, // MSB-first
    true, // headerOptional (no header to require)
  );
  if (!frame) return null;
  return parseLloydState(frame.data);
}
