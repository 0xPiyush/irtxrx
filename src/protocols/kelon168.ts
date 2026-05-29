/**
 * Kelon 168-bit A/C IR protocol encoder and decoder.
 *
 * Ported from IRremoteESP8266 `ir_Kelon.cpp` / `ir_Kelon.h`.
 *
 * Wire format: a 21-byte state sent LSB-first in three sections —
 *
 *   Section 1: HDR + bytes 0-5  (48 bits) + BIT_MARK + FOOTER_SPACE
 *   Section 2:        bytes 6-13 (64 bits) + BIT_MARK + FOOTER_SPACE
 *   Section 3:        bytes 14-20 (56 bits) + BIT_MARK + GAP
 *
 * Integrity: two XOR checksums — byte 13 over bytes 2-11, byte 20 over
 * bytes 14-19. Like the real remote, frames carry a "command" byte indicating
 * which button was pressed; we model it as a field and round-trip it losslessly.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1745
 */

import { encodeData } from "../encode.js";
import { matchMark, matchSpace, matchAtLeast, matchData } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Kelon.cpp exactly
// ---------------------------------------------------------------------------

const KELON_HDR_MARK = 9000;
const KELON_HDR_SPACE = 4600;
const KELON_BIT_MARK = 560;
const KELON_ONE_SPACE = 1680;
const KELON_ZERO_SPACE = 600;
const KELON168_FOOTER_SPACE = 8000;
const KELON_GAP = 2 * 100000; // 2 * kDefaultMessageGap
const KELON_TOLERANCE = 25;

export const KELON168_STATE_LENGTH = 21;
export const KELON168_BITS = KELON168_STATE_LENGTH * 8;

const SECTION1 = 6;
const SECTION2 = 8;
const SECTION3 = 7;

const CHECKSUM_BYTE1 = 13;
const CHECKSUM_BYTE2 = KELON168_STATE_LENGTH - 1; // 20

const KELON168_TEMP_MIN = 16;
const KELON168_TEMP_MAX = 32;
const KELON168_AUTO_TEMP = 23;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const Kelon168Mode = {
  Heat: 0,
  Auto: 1,
  Cool: 2,
  Dry: 3,
  Fan: 4,
} as const;
export type Kelon168ModeValue = (typeof Kelon168Mode)[keyof typeof Kelon168Mode];

export const Kelon168Fan = {
  Auto: 0,
  Min: 1,
  Low: 2,
  Medium: 3,
  High: 4,
  Max: 5,
} as const;
export type Kelon168FanValue = (typeof Kelon168Fan)[keyof typeof Kelon168Fan];

export const Kelon168Command = {
  Light: 0x00,
  Power: 0x01,
  Temp: 0x02,
  Sleep: 0x03,
  Super: 0x04,
  OnTimer: 0x05,
  Mode: 0x06,
  Swing: 0x07,
  IFeel: 0x0d,
  FanSpeed: 0x11,
  OffTimer: 0x1d,
} as const;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Kelon168State {
  /** "Power command present" flag (byte 2). */
  power?: boolean;
  /** Actual on/off state (byte 18). */
  on?: boolean;
  fan?: number;
  sleep?: boolean;
  swing?: boolean;
  super?: boolean;
  mode?: number;
  /** Temperature in °C (16–31). */
  temp?: number;
  light?: boolean;
  /** Clock, minutes past midnight (0–1439). */
  clockMinutes?: number;
  offTimerEnabled?: boolean;
  /** Off-timer, minutes past midnight (0–1439). */
  offTimerMinutes?: number;
  onTimerEnabled?: boolean;
  /** On-timer, minutes past midnight (0–1439). */
  onTimerMinutes?: number;
  /** Last-pressed command code (see {@link Kelon168Command}). */
  command?: number;
}

// ---------------------------------------------------------------------------
// Fan mapping (API ⇄ Fan/Fan2 wire bits)
// ---------------------------------------------------------------------------

/** @returns [Fan (byte2 bits0-1), Fan2 (byte16 bit1)] */
function fanToWire(api: number): [number, number] {
  switch (api) {
    case Kelon168Fan.Min: return [0b11, 0];
    case Kelon168Fan.Low: return [0b11, 1];
    case Kelon168Fan.Medium: return [0b10, 0];
    case Kelon168Fan.High: return [0b01, 1];
    case Kelon168Fan.Max: return [0b01, 0];
    default: return [0, 0]; // Auto
  }
}

function wireToFan(fan: number, fan2: number): number {
  switch (fan) {
    case 0b01: return fan2 === 0 ? Kelon168Fan.Max : Kelon168Fan.High;
    case 0b10: return Kelon168Fan.Medium;
    case 0b11: return fan2 === 0 ? Kelon168Fan.Min : Kelon168Fan.Low;
    default: return Kelon168Fan.Auto;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

function xorBytes(state: Uint8Array, start: number, length: number): number {
  let sum = 0;
  for (let i = start; i < start + length; i++) sum ^= state[i]!;
  return sum & 0xff;
}

/** Validate both XOR checksums (byte 13 over 2–11, byte 20 over 14–19). */
export function validKelon168Checksum(state: Uint8Array): boolean {
  if (state.length < KELON168_STATE_LENGTH) return false;
  if (state[CHECKSUM_BYTE1] !== xorBytes(state, 2, CHECKSUM_BYTE1 - 1 - 2)) return false;
  if (state[CHECKSUM_BYTE2] !==
      xorBytes(state, CHECKSUM_BYTE1 + 1, CHECKSUM_BYTE2 - CHECKSUM_BYTE1 - 1)) return false;
  return true;
}

function applyKelon168Checksum(state: Uint8Array): void {
  state[CHECKSUM_BYTE1] = xorBytes(state, 2, CHECKSUM_BYTE1 - 1 - 2);
  state[CHECKSUM_BYTE2] = xorBytes(state, CHECKSUM_BYTE1 + 1, CHECKSUM_BYTE2 - CHECKSUM_BYTE1 - 1);
}

// ---------------------------------------------------------------------------
// Build raw bytes from state
// ---------------------------------------------------------------------------

/** Build a raw 21-byte Kelon168 code (with checksums) from a state. */
export function buildKelon168Raw(state: Kelon168State): Uint8Array {
  const d = new Uint8Array(KELON168_STATE_LENGTH);

  const [fan, fan2] = fanToWire(clamp(state.fan ?? Kelon168Fan.Auto, 0, Kelon168Fan.Max));
  const tempC = clamp(state.temp ?? KELON168_AUTO_TEMP, KELON168_TEMP_MIN, KELON168_TEMP_MAX);
  const tempField = (tempC - KELON168_TEMP_MIN) & 0xf;

  const clock = clamp(state.clockMinutes ?? 0, 0, 24 * 60 - 1);
  const offT = clamp(state.offTimerMinutes ?? 0, 0, 24 * 60 - 1);
  const onT = clamp(state.onTimerMinutes ?? 0, 0, 24 * 60 - 1);

  const swing = state.swing ? 1 : 0;
  const sup = state.super ? 1 : 0;

  // Bytes 0-1: fixed preamble
  d[0] = 0x83;
  d[1] = 0x06;
  // Byte 2: Fan(0-1), Power(2), Sleep(3), Swing1(7)
  d[2] =
    (fan & 0x3) |
    ((state.power ? 1 : 0) << 2) |
    ((state.sleep ? 1 : 0) << 3) |
    (swing << 7);
  // Byte 3: Mode(0-2), Temp(4-7)
  d[3] = ((state.mode ?? Kelon168Mode.Heat) & 0x7) | (tempField << 4);
  // Byte 4: unused
  d[4] = 0;
  // Byte 5: Super1(4), Super2(7)
  d[5] = (sup << 4) | (sup << 7);
  // Byte 6: ClockHours(0-4), LightOff(5), bit7 fixed 1
  d[6] =
    (Math.floor(clock / 60) & 0x1f) |
    ((state.light ?? true ? 0 : 1) << 5) |
    0x80;
  // Byte 7: ClockMins(0-5), OffTimerEnabled(7)
  d[7] = (clock % 60 & 0x3f) | ((state.offTimerEnabled ? 1 : 0) << 7);
  // Byte 8: OffHours(0-4), Swing2(6)
  d[8] = (Math.floor(offT / 60) & 0x1f) | (swing << 6);
  // Byte 9: OffMins(0-5), OnTimerEnabled(7)
  d[9] = (offT % 60 & 0x3f) | ((state.onTimerEnabled ? 1 : 0) << 7);
  // Byte 10: OnHours(0-4)
  d[10] = Math.floor(onT / 60) & 0x1f;
  // Byte 11: OnMins(0-5)
  d[11] = onT % 60 & 0x3f;
  // Byte 12: unused
  d[12] = 0;
  // Byte 13: Sum1 (computed below)
  // Byte 14: unused
  d[14] = 0;
  // Byte 15: Cmd
  d[15] = (state.command ?? Kelon168Command.Light) & 0xff;
  // Byte 16: Fan2(1)
  d[16] = (fan2 & 0x1) << 1;
  // Byte 17: pad
  d[17] = 0;
  // Byte 18: Model1=0b1000, On(4), Model2=0b001
  d[18] = 0b1000 | ((state.on ? 1 : 0) << 4) | (0b001 << 5);
  // Byte 19: unused
  d[19] = 0;
  // Byte 20: Sum2 (computed below)

  applyKelon168Checksum(d);
  return d;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

function pushByte(out: number[], value: number): void {
  const bits = encodeData(
    KELON_BIT_MARK, KELON_ONE_SPACE,
    KELON_BIT_MARK, KELON_ZERO_SPACE,
    BigInt(value), 8, false, // LSB-first
  );
  for (let i = 0; i < bits.length; i++) out.push(bits[i]!);
}

/** Encode a raw 21-byte Kelon168 code into IR timings. */
export function encodeKelon168Raw(data: Uint8Array, repeat: number = 0): number[] {
  const out: number[] = [];

  for (let r = 0; r <= repeat; r++) {
    // Section 1: header + bytes 0-5
    out.push(KELON_HDR_MARK, KELON_HDR_SPACE);
    for (let i = 0; i < SECTION1; i++) pushByte(out, data[i]!);
    out.push(KELON_BIT_MARK, KELON168_FOOTER_SPACE);
    // Section 2: bytes 6-13
    for (let i = SECTION1; i < SECTION1 + SECTION2; i++) pushByte(out, data[i]!);
    out.push(KELON_BIT_MARK, KELON168_FOOTER_SPACE);
    // Section 3: bytes 14-20
    for (let i = SECTION1 + SECTION2; i < KELON168_STATE_LENGTH; i++) pushByte(out, data[i]!);
    out.push(KELON_BIT_MARK, KELON_GAP);
  }

  return out;
}

/** Encode a Kelon168 A/C state into raw IR timings. */
export function sendKelon168(state: Kelon168State, repeat: number = 0): number[] {
  return encodeKelon168Raw(buildKelon168Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

export interface Kelon168RawResult {
  data: Uint8Array;
  used: number;
}

function readByte(timings: number[], pos: number): { value: number; used: number } | null {
  const r = matchData(
    timings, pos, 8,
    KELON_BIT_MARK, KELON_ONE_SPACE,
    KELON_BIT_MARK, KELON_ZERO_SPACE,
    KELON_TOLERANCE, 0, false,
  );
  if (!r.success) return null;
  return { value: Number(r.data & 0xffn), used: r.used };
}

/** Decode raw IR timings into a raw 21-byte Kelon168 code (checksum-validated). */
export function decodeKelon168Raw(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Kelon168RawResult | null {
  let pos = offset;
  const len = timings.length;

  // 168 data bits(336) + 3 footers(6) + header(2) ≈ 344 entries.
  if (len - offset < 340) return null;

  // Section 1 header
  if (
    pos + 1 < len &&
    matchMark(timings[pos]!, KELON_HDR_MARK, KELON_TOLERANCE) &&
    matchSpace(timings[pos + 1]!, KELON_HDR_SPACE, KELON_TOLERANCE)
  ) {
    pos += 2;
  } else if (!headerOptional) {
    return null;
  }

  const data = new Uint8Array(KELON168_STATE_LENGTH);
  const sizes = [SECTION1, SECTION2, SECTION3];
  let byteIdx = 0;

  for (let s = 0; s < sizes.length; s++) {
    for (let i = 0; i < sizes[s]!; i++) {
      const b = readByte(timings, pos);
      if (!b) return null;
      data[byteIdx++] = b.value;
      pos += b.used;
    }
    // Section footer mark
    if (pos >= len) return null;
    if (!matchMark(timings[pos]!, KELON_BIT_MARK, KELON_TOLERANCE)) return null;
    pos++;
    // Section footer space (8000 for §1/§2; large gap for §3, possibly absent at EOF)
    const lastSection = s === sizes.length - 1;
    const space = lastSection ? KELON_GAP : KELON168_FOOTER_SPACE;
    if (pos < len) {
      if (lastSection) {
        if (!matchAtLeast(timings[pos]!, space, KELON_TOLERANCE)) return null;
      } else {
        if (!matchSpace(timings[pos]!, space, KELON_TOLERANCE)) return null;
      }
      pos++;
    } else if (!lastSection) {
      return null; // §1/§2 must be followed by their footer space
    }
  }

  if (data[0] !== 0x83 || data[1] !== 0x06) return null;
  if (!validKelon168Checksum(data)) return null;

  return { data, used: pos - offset };
}

/** Parse a raw 21-byte Kelon168 code into a state object. */
export function parseKelon168State(d: Uint8Array): Kelon168State {
  const b2 = d[2]!, b3 = d[3]!, b5 = d[5]!, b6 = d[6]!, b7 = d[7]!,
    b8 = d[8]!, b9 = d[9]!, b10 = d[10]!, b11 = d[11]!, b15 = d[15]!,
    b16 = d[16]!, b18 = d[18]!;

  return {
    power: !!((b2 >> 2) & 1),
    on: !!((b18 >> 4) & 1),
    fan: wireToFan(b2 & 0x3, (b16 >> 1) & 1),
    sleep: !!((b2 >> 3) & 1),
    swing: !!((b2 >> 7) & 1) && !!((b8 >> 6) & 1),
    super: !!((b5 >> 4) & 1) && !!((b5 >> 7) & 1),
    mode: b3 & 0x7,
    temp: ((b3 >> 4) & 0xf) + KELON168_TEMP_MIN,
    light: !((b6 >> 5) & 1),
    clockMinutes: (b6 & 0x1f) * 60 + (b7 & 0x3f),
    offTimerEnabled: !!((b7 >> 7) & 1),
    offTimerMinutes: (b8 & 0x1f) * 60 + (b9 & 0x3f),
    onTimerEnabled: !!((b9 >> 7) & 1),
    onTimerMinutes: (b10 & 0x1f) * 60 + (b11 & 0x3f),
    command: b15,
  };
}

/**
 * Decode raw IR timings as a Kelon168 A/C state.
 *
 * @param timings        Raw mark/space timing array in microseconds.
 * @param offset         Starting index in the timings array (default 0).
 * @param headerOptional Allow a missing header (default false).
 * @returns Decoded state (same shape as encode input), or null.
 */
export function decodeKelon168(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Kelon168State | null {
  const raw = decodeKelon168Raw(timings, offset, headerOptional);
  if (!raw) return null;
  return parseKelon168State(raw.data);
}
