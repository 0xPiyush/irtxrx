/**
 * Daikin 128-bit (16-byte) IR protocol encoder.
 *
 * Leader (2x mark/space) + 2 sections: bytes 0–7 (with header) + bytes 8–15 (no header, footer mark).
 * Nibble-based checksums.
 * Ported from IRremoteESP8266 `ir_Daikin.cpp`.
 */

import { uint8ToBcd, bcdToUint8, sumNibbles, sendGenericBytes } from "../encode.js";
import { matchMark, matchSpace, matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants (shared with Daikin64)
// ---------------------------------------------------------------------------

const LDR_MARK = 9800;
const LDR_SPACE = 9800;
const HDR_MARK = 4600;
const HDR_SPACE = 2500;
const BIT_MARK = 350;
const ONE_SPACE = 954;
const ZERO_SPACE = 382;
const GAP = 20300;
const FOOTER_MARK = 4600; // kDaikin128FooterMark = kDaikin128HdrMark
const STATE_LENGTH = 16;
const SECTION_LEN = 8;

// ---------------------------------------------------------------------------
// Daikin128-specific mode values (4-bit, different from shared 3-bit)
// ---------------------------------------------------------------------------

export const Daikin128Mode = {
  Dry: 0b0001,
  Cool: 0b0010,
  Fan: 0b0100,
  Heat: 0b1000,
  Auto: 0b1010,
} as const;

export type Daikin128ModeValue = (typeof Daikin128Mode)[keyof typeof Daikin128Mode];

export const Daikin128Fan = {
  Auto: 0b0001,
  High: 0b0010,
  Med: 0b0100,
  Low: 0b1000,
  Powerful: 0b0011,
  Quiet: 0b1001,
} as const;

export type Daikin128FanValue = (typeof Daikin128Fan)[keyof typeof Daikin128Fan];

const MIN_TEMP = 16;
const MAX_TEMP = 30;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Daikin128State {
  power?: boolean;
  temp?: number;
  mode?: Daikin128ModeValue;
  fan?: Daikin128FanValue;
  swingVertical?: boolean;
  sleep?: boolean;
  econo?: boolean;
  /** Ceiling light control. */
  ceiling?: boolean;
  /** Wall light control. */
  wall?: boolean;
  /** Clock: minutes since midnight (0–1439). */
  clock?: number;
  onTimerEnabled?: boolean;
  /** On timer: minutes since midnight (resolution 30 min). */
  onTime?: number;
  offTimerEnabled?: boolean;
  /** Off timer: minutes since midnight (resolution 30 min). */
  offTime?: number;
}

// ---------------------------------------------------------------------------
// Bit helpers
// ---------------------------------------------------------------------------

function setBit(raw: Uint8Array, byteIdx: number, bitIdx: number, on: boolean) {
  if (on) raw[byteIdx] = raw[byteIdx]! | (1 << bitIdx);
  else raw[byteIdx] = raw[byteIdx]! & ~(1 << bitIdx);
}

function setBitsRange(
  raw: Uint8Array, byteIdx: number, bitOffset: number, size: number, value: number,
) {
  const mask = ((1 << size) - 1) << bitOffset;
  raw[byteIdx] = (raw[byteIdx]! & ~mask) | ((value << bitOffset) & mask);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function defaultState(): Uint8Array {
  const raw = new Uint8Array(STATE_LENGTH);
  raw[0] = 0x16;
  raw[7] = 0x04; // Lower nibble = 0x4, upper nibble = checksum
  raw[8] = 0xa1;
  return raw;
}

export function buildDaikin128Raw(state: Daikin128State): Uint8Array {
  const raw = defaultState();

  // Mode (byte 1, bits 0–3)
  let mode: number = state.mode ?? Daikin128Mode.Auto;
  if (!(mode === Daikin128Mode.Auto || mode === Daikin128Mode.Cool || mode === Daikin128Mode.Heat || mode === Daikin128Mode.Fan || mode === Daikin128Mode.Dry))
    mode = Daikin128Mode.Auto;
  setBitsRange(raw, 1, 0, 4, mode);

  // Fan (byte 1, bits 4–7) — mode-dependent constraints
  let fan: number = state.fan ?? Daikin128Fan.Auto;
  if (fan === Daikin128Fan.Quiet || fan === Daikin128Fan.Powerful) {
    if (mode === Daikin128Mode.Auto) fan = Daikin128Fan.Auto;
  }
  if (!(fan === Daikin128Fan.Auto || fan === Daikin128Fan.High || fan === Daikin128Fan.Med || fan === Daikin128Fan.Low || fan === Daikin128Fan.Quiet || fan === Daikin128Fan.Powerful))
    fan = Daikin128Fan.Auto;
  setBitsRange(raw, 1, 4, 4, fan);

  // Clock (byte 2 = ClockMins BCD, byte 3 = ClockHours BCD)
  if (state.clock !== undefined) {
    let mins = state.clock;
    if (mins >= 24 * 60) mins = 0;
    raw[2] = uint8ToBcd(mins % 60);
    raw[3] = uint8ToBcd(Math.trunc(mins / 60));
  }

  // On timer (byte 4: bits 0–5 = OnHours, bit 6 = OnHalfHour, bit 7 = OnTimer)
  if (state.onTime !== undefined) {
    let mins = state.onTime;
    if (mins >= 24 * 60) mins = 0;
    setBitsRange(raw, 4, 0, 6, uint8ToBcd(Math.trunc(mins / 60)));
    setBit(raw, 4, 6, (mins % 60) >= 30);
  }
  setBit(raw, 4, 7, state.onTimerEnabled ?? false);

  // Off timer (byte 5: bits 0–5 = OffHours, bit 6 = OffHalfHour, bit 7 = OffTimer)
  if (state.offTime !== undefined) {
    let mins = state.offTime;
    if (mins >= 24 * 60) mins = 0;
    setBitsRange(raw, 5, 0, 6, uint8ToBcd(Math.trunc(mins / 60)));
    setBit(raw, 5, 6, (mins % 60) >= 30);
  }
  setBit(raw, 5, 7, state.offTimerEnabled ?? false);

  // Temp (byte 6, BCD)
  const temp = Math.min(Math.max(state.temp ?? 24, MIN_TEMP), MAX_TEMP);
  raw[6] = uint8ToBcd(temp);

  // Byte 7 lower nibble fields: SwingV(bit 0), Sleep(bit 1), bit 2 always 1, Power(bit 3)
  setBit(raw, 7, 0, state.swingVertical ?? false);
  setBit(raw, 7, 1, state.sleep ?? false);
  setBit(raw, 7, 2, true); // always 1
  setBit(raw, 7, 3, state.power ?? false);

  // Byte 9: Ceiling(bit 0), Econo(bit 2), Wall(bit 3)
  const econo = (state.econo ?? false) && (mode === Daikin128Mode.Cool || mode === Daikin128Mode.Heat);
  setBit(raw, 9, 0, state.ceiling ?? false);
  setBit(raw, 9, 2, econo);
  setBit(raw, 9, 3, state.wall ?? false);

  // --- Checksums ---
  // First checksum: sumNibbles(bytes 0–6, init=lower nibble of byte 7) & 0x0F → upper nibble of byte 7
  const sum1 = sumNibbles(raw, 0, SECTION_LEN - 1, raw[7]! & 0x0f) & 0x0f;
  raw[7] = (raw[7]! & 0x0f) | (sum1 << 4);

  // Second checksum: sumNibbles(bytes 8–14) → byte 15
  raw[15] = sumNibbles(raw, SECTION_LEN, SECTION_LEN - 1);

  return raw;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export function sendDaikin128(state: Daikin128State, repeat = 0): number[] {
  return encodeDaikin128Raw(buildDaikin128Raw(state), repeat);
}

export function encodeDaikin128Raw(data: Uint8Array, repeat = 0): number[] {
  const result: number[] = [];

  for (let r = 0; r <= repeat; r++) {
    // Leader: 2x (mark + space)
    for (let i = 0; i < 2; i++) {
      result.push(LDR_MARK);
      result.push(LDR_SPACE);
    }

    // Section 1 (bytes 0–7) — with header
    const s1 = sendGenericBytes({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE,
      zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: GAP,
      data: data.subarray(0, SECTION_LEN), msbFirst: false,
    });
    for (let i = 0; i < s1.length; i++) result.push(s1[i]!);

    // Section 2 (bytes 8–15) — no header, footer = FOOTER_MARK
    const s2 = sendGenericBytes({
      headerMark: 0, headerSpace: 0,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE,
      zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: FOOTER_MARK, gap: GAP,
      data: data.subarray(SECTION_LEN), msbFirst: false,
    });
    for (let i = 0; i < s2.length; i++) result.push(s2[i]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Decode API
// ---------------------------------------------------------------------------

/**
 * Try to skip the leader section (2x mark/space pairs).
 * Returns the new offset past the leader, or the original offset if no leader.
 */
function skipLeader(
  timings: number[],
  offset: number,
): number {
  let pos = offset;
  // Leader is 2x (LDR_MARK + LDR_SPACE)
  for (let i = 0; i < 2; i++) {
    if (pos + 1 >= timings.length) return offset;
    if (!matchMark(timings[pos]!, LDR_MARK)) return offset;
    if (!matchSpace(timings[pos + 1]!, LDR_SPACE)) return offset;
    pos += 2;
  }
  return pos;
}

/**
 * Decode raw IR timings as a Daikin128 message.
 *
 * The leader preamble (2x mark/space) is optional — hardware captures often
 * miss it.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeDaikin128(
  timings: number[],
  offset: number = 0,
): Daikin128State | null {
  // Skip leader if present.
  let pos = skipLeader(timings, offset);

  // Section 1 (bytes 0–7): header + 8 bytes + footer (BIT_MARK + GAP).
  const s1 = matchGenericBytes(
    timings, pos, timings.length - pos, SECTION_LEN,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false, // atLeast, tol, excess, msbFirst=false
  );
  if (!s1) return null;
  pos += s1.used;

  // Section 2 (bytes 8–15): no header + 8 bytes + footer (FOOTER_MARK + GAP).
  const s2 = matchGenericBytes(
    timings, pos, timings.length - pos, SECTION_LEN,
    0, 0,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    FOOTER_MARK, GAP,
    true, undefined, undefined, false, // atLeast, tol, excess, msbFirst=false
  );
  if (!s2) return null;

  // Concatenate sections into one 16-byte array.
  const raw = new Uint8Array(STATE_LENGTH);
  raw.set(s1.data, 0);
  raw.set(s2.data, SECTION_LEN);

  // Validate checksums.
  // Section 1: sumNibbles(bytes 0–6, init=lower nibble of byte 7) & 0x0F === upper nibble of byte 7
  const expectedSum1 = sumNibbles(raw, 0, SECTION_LEN - 1, raw[7]! & 0x0f) & 0x0f;
  if (((raw[7]! >> 4) & 0x0f) !== expectedSum1) return null;

  // Section 2: sumNibbles(bytes 8–14) === byte 15
  const expectedSum2 = sumNibbles(raw, SECTION_LEN, SECTION_LEN - 1);
  if (raw[15] !== expectedSum2) return null;

  // Extract state from byte/bit positions.
  const mode = (raw[1]! & 0x0f) as Daikin128ModeValue;
  const fan = ((raw[1]! >> 4) & 0x0f) as Daikin128FanValue;

  // Clock: byte 2 = minutes BCD, byte 3 = hours BCD
  const clockMins = bcdToUint8(raw[2]!);
  const clockHours = bcdToUint8(raw[3]!);
  const clock = clockHours * 60 + clockMins;

  // On timer (byte 4): bits 0–5 = hours BCD, bit 6 = half-hour, bit 7 = enabled
  const onTimerHours = bcdToUint8(raw[4]! & 0x3f);
  const onTimerHalf = !!(raw[4]! & (1 << 6));
  const onTimerEnabled = !!(raw[4]! & (1 << 7));
  const onTime = onTimerHours * 60 + (onTimerHalf ? 30 : 0);

  // Off timer (byte 5): bits 0–5 = hours BCD, bit 6 = half-hour, bit 7 = enabled
  const offTimerHours = bcdToUint8(raw[5]! & 0x3f);
  const offTimerHalf = !!(raw[5]! & (1 << 6));
  const offTimerEnabled = !!(raw[5]! & (1 << 7));
  const offTime = offTimerHours * 60 + (offTimerHalf ? 30 : 0);

  // Temp (byte 6, BCD)
  const temp = bcdToUint8(raw[6]!);

  return {
    power: !!(raw[7]! & (1 << 3)),
    temp,
    mode,
    fan,
    swingVertical: !!(raw[7]! & (1 << 0)),
    sleep: !!(raw[7]! & (1 << 1)),
    econo: !!(raw[9]! & (1 << 2)),
    ceiling: !!(raw[9]! & (1 << 0)),
    wall: !!(raw[9]! & (1 << 3)),
    clock,
    onTimerEnabled,
    onTime,
    offTimerEnabled,
    offTime,
  };
}
