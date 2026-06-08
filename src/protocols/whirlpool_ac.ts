/**
 * Whirlpool A/C IR protocol encoder and decoder. (WHIRLPOOL_AC)
 *
 * Ported from IRremoteESP8266 `ir_Whirlpool.cpp` (the `IRWhirlpoolAc` class).
 * A 21-byte LSB-first message transmitted in three sections (6 + 8 + 7 bytes)
 * with two XOR checksums (byte 13 over bytes 2–11, byte 20 over bytes 14–19).
 * Power is a TOGGLE, and a `command` byte records which button was pressed.
 * Two remote models (DG11J1-3A / DG11J1-91) differ in temperature range.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/509
 */

import { sendGenericBytes, xorBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Whirlpool.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 8950;
const HDR_SPACE = 4484;
const BIT_MARK = 597;
const ONE_SPACE = 1649;
const ZERO_SPACE = 533;
const SECTION_GAP = 7920;
const MESSAGE_GAP = 100000; // kDefaultMessageGap

const STATE_LENGTH = 21;
const TEMP_MIN = 18;
const TEMP_MAX = 32;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const WhirlpoolAcMode = {
  Heat: 0,
  Auto: 1,
  Cool: 2,
  Dry: 3,
  Fan: 4,
} as const;
export type WhirlpoolAcModeValue = (typeof WhirlpoolAcMode)[keyof typeof WhirlpoolAcMode];

export const WhirlpoolAcFan = {
  Auto: 0,
  High: 1,
  Medium: 2,
  Low: 3,
} as const;
export type WhirlpoolAcFanValue = (typeof WhirlpoolAcFan)[keyof typeof WhirlpoolAcFan];

export const WhirlpoolAcModel = {
  DG11J13A: 1,
  DG11J191: 2,
} as const;
export type WhirlpoolAcModelValue = (typeof WhirlpoolAcModel)[keyof typeof WhirlpoolAcModel];

export const WhirlpoolAcCommand = {
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
  SixthSense: 0x17,
  OffTimer: 0x1d,
} as const;
export type WhirlpoolAcCommandValue = (typeof WhirlpoolAcCommand)[keyof typeof WhirlpoolAcCommand];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface WhirlpoolAcState {
  model?: WhirlpoolAcModelValue;
  /** Power is a toggle on this protocol. */
  powerToggle?: boolean;
  /** Temperature in °C (18–32 for 3A, 16–30 for 91). */
  temp?: number;
  mode?: WhirlpoolAcModeValue;
  fan?: WhirlpoolAcFanValue;
  swing?: boolean;
  /** Display light (stored inverted as LightOff). */
  light?: boolean;
  /** Super / Jet / Turbo. */
  super?: boolean;
  sleep?: boolean;
  /** Which button this message represents. */
  command?: number;
  /** Clock time in minutes since midnight. */
  clock?: number;
  onTimer?: number;
  onTimerEnabled?: boolean;
  offTimer?: number;
  offTimerEnabled?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function setBits(raw: Uint8Array, idx: number, off: number, size: number, val: number): void {
  const mask = ((1 << size) - 1) << off;
  raw[idx] = (raw[idx]! & ~mask) | ((val << off) & mask);
}

function tempOffset(model: number): number {
  return model === WhirlpoolAcModel.DG11J191 ? -2 : 0;
}

// ---------------------------------------------------------------------------
// Build raw 21-byte state
// ---------------------------------------------------------------------------

/** Build the raw 21-byte Whirlpool A/C state from a state object. */
export function buildWhirlpoolAcRaw(state: WhirlpoolAcState): Uint8Array {
  const raw = new Uint8Array(STATE_LENGTH);
  raw[0] = 0x83;
  raw[1] = 0x06;
  raw[6] = 0x80; // const reserved bit

  const model = state.model ?? WhirlpoolAcModel.DG11J13A;
  const off = tempOffset(model);
  setBits(raw, 18, 3, 1, model === WhirlpoolAcModel.DG11J191 ? 1 : 0); // J191

  setBits(raw, 2, 0, 2, state.fan ?? WhirlpoolAcFan.Auto);
  setBits(raw, 2, 2, 1, state.powerToggle ? 1 : 0);
  setBits(raw, 2, 3, 1, state.sleep ? 1 : 0);
  setBits(raw, 2, 7, 1, state.swing ? 1 : 0); // Swing1
  setBits(raw, 8, 6, 1, state.swing ? 1 : 0); // Swing2

  setBits(raw, 3, 0, 3, state.mode ?? WhirlpoolAcMode.Auto);
  setBits(raw, 3, 4, 4, clamp(state.temp ?? 23, TEMP_MIN + off, TEMP_MAX + off) - (TEMP_MIN + off));

  setBits(raw, 5, 4, 1, state.super ? 1 : 0); // Super1
  setBits(raw, 5, 7, 1, state.super ? 1 : 0); // Super2

  const clock = clamp(state.clock ?? 0, 0, 23 * 60 + 59);
  setBits(raw, 6, 0, 5, Math.trunc(clock / 60));
  setBits(raw, 6, 5, 1, state.light ?? true ? 0 : 1); // LightOff (cleared when on)
  setBits(raw, 7, 0, 6, clock % 60);

  const offT = clamp(state.offTimer ?? 0, 0, 23 * 60 + 59);
  setBits(raw, 7, 7, 1, state.offTimerEnabled ? 1 : 0);
  setBits(raw, 8, 0, 5, Math.trunc(offT / 60));
  setBits(raw, 9, 0, 6, offT % 60);

  const onT = clamp(state.onTimer ?? 0, 0, 23 * 60 + 59);
  setBits(raw, 9, 7, 1, state.onTimerEnabled ? 1 : 0);
  setBits(raw, 10, 0, 5, Math.trunc(onT / 60));
  setBits(raw, 11, 0, 6, onT % 60);

  raw[15] = state.command ?? WhirlpoolAcCommand.Power;

  raw[13] = xorBytes(raw, 2, 12); // Sum1 over bytes 2..11
  raw[20] = xorBytes(raw, 14, 20); // Sum2 over bytes 14..19
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 21-byte Whirlpool A/C payload into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendWhirlpoolAC`: three sections (6/8/7
 * bytes) with a 7920µs section gap; only the first section has a header.
 */
export function encodeWhirlpoolAcRaw(data: Uint8Array, repeat: number = 0): number[] {
  const result: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    const s1 = sendGenericBytes({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: SECTION_GAP,
      data: data.subarray(0, 6), msbFirst: false,
    });
    const s2 = sendGenericBytes({
      headerMark: 0, headerSpace: 0,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: SECTION_GAP,
      data: data.subarray(6, 14), msbFirst: false,
    });
    const s3 = sendGenericBytes({
      headerMark: 0, headerSpace: 0,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: MESSAGE_GAP,
      data: data.subarray(14, 21), msbFirst: false,
    });
    for (const t of s1) result.push(t);
    for (const t of s2) result.push(t);
    for (const t of s3) result.push(t);
  }
  return result;
}

/** Encode a Whirlpool A/C state into raw IR timings. */
export function sendWhirlpoolAc(state: WhirlpoolAcState, repeat: number = 0): number[] {
  return encodeWhirlpoolAcRaw(buildWhirlpoolAcRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Verify both Whirlpool A/C XOR checksums. */
export function whirlpoolAcValidChecksum(raw: Uint8Array): boolean {
  return raw[13] === xorBytes(raw, 2, 12) && raw[20] === xorBytes(raw, 14, 20);
}

/** Parse a validated 21-byte Whirlpool A/C state into a state object. */
export function parseWhirlpoolAcState(raw: Uint8Array): WhirlpoolAcState {
  const model: WhirlpoolAcModelValue = ((raw[18]! >> 3) & 1) ? WhirlpoolAcModel.DG11J191 : WhirlpoolAcModel.DG11J13A;
  const off = tempOffset(model);
  return {
    model,
    powerToggle: !!((raw[2]! >> 2) & 1),
    temp: ((raw[3]! >> 4) & 0x0f) + TEMP_MIN + off,
    mode: (raw[3]! & 0x07) as WhirlpoolAcModeValue,
    fan: (raw[2]! & 0x03) as WhirlpoolAcFanValue,
    swing: !!((raw[2]! >> 7) & 1),
    light: !((raw[6]! >> 5) & 1),
    super: !!((raw[5]! >> 4) & 1),
    sleep: !!((raw[2]! >> 3) & 1),
    command: raw[15]!,
    clock: (raw[6]! & 0x1f) * 60 + (raw[7]! & 0x3f),
    onTimerEnabled: !!((raw[9]! >> 7) & 1),
    onTimer: (raw[10]! & 0x1f) * 60 + (raw[11]! & 0x3f),
    offTimerEnabled: !!((raw[7]! >> 7) & 1),
    offTimer: (raw[8]! & 0x1f) * 60 + (raw[9]! & 0x3f),
  };
}

/**
 * Decode raw IR timings as a Whirlpool A/C (21-byte) message.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeWhirlpoolAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): WhirlpoolAcState | null {
  let pos = offset;
  const raw = new Uint8Array(STATE_LENGTH);

  const s1 = matchGenericBytes(
    timings, pos, timings.length - pos, 6,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, SECTION_GAP,
    false, undefined, undefined, false, headerOptional,
  );
  if (!s1) return null;
  raw.set(s1.data, 0);
  pos += s1.used;

  const s2 = matchGenericBytes(
    timings, pos, timings.length - pos, 8,
    0, 0,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, SECTION_GAP,
    false, undefined, undefined, false, false,
  );
  if (!s2) return null;
  raw.set(s2.data, 6);
  pos += s2.used;

  const s3 = matchGenericBytes(
    timings, pos, timings.length - pos, 7,
    0, 0,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    // C++ decodeWhirlpoolAC uses kWhirlpoolAcGap (7920) for the section-3 footer.
    BIT_MARK, SECTION_GAP,
    true, undefined, undefined, false, false,
  );
  if (!s3) return null;
  raw.set(s3.data, 14);

  if (raw[0] !== 0x83 || raw[1] !== 0x06) return null;
  if (!whirlpoolAcValidChecksum(raw)) return null;
  return parseWhirlpoolAcState(raw);
}
