/**
 * Trotec A/C IR protocol encoders and decoders. (TROTEC + TROTEC_3550)
 *
 * Ported from IRremoteESP8266 `ir_Trotec.cpp` / `ir_Trotec.h` — full coverage of
 * the `IRTrotecESP` and `IRTrotec3550` classes and both wire formats.
 *
 * Two distinct 9-byte (72-bit) protocols share this file:
 *   - **{@link sendTrotec | TROTEC}** — Trotec PAC 3200, Duux Blizzard. Sent
 *     **LSB-first** behind a 5952/7364 header, with an extra bit-mark + 1.5ms
 *     tail after the normal footer. Checksum = sum of bytes 2–7 (byte 8).
 *   - **{@link sendTrotec3550 | TROTEC_3550}** — Trotec PAC 3550 Pro. Sent
 *     **MSB-first** behind a 12000/5130 header. Adds °C/°F selection, vertical
 *     swing and a minute timer. Checksum = sum of bytes 0–7 (byte 8).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Trotec.cpp
 */

import { sendGenericBytes, sumBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

export const TROTEC_STATE_LENGTH = 9;

// Shared mode/fan enums (identical raw values across both variants).
export const TrotecMode = { Auto: 0, Cool: 1, Dry: 2, Fan: 3 } as const;
export type TrotecModeValue = (typeof TrotecMode)[keyof typeof TrotecMode];
export const TrotecFan = { Low: 1, Med: 2, High: 3 } as const;
export type TrotecFanValue = (typeof TrotecFan)[keyof typeof TrotecFan];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
function getBits(raw: Uint8Array, idx: number, off: number, size: number): number {
  return (raw[idx]! >> off) & ((1 << size) - 1);
}
function setBits(raw: Uint8Array, idx: number, off: number, size: number, val: number): void {
  const mask = ((1 << size) - 1) << off;
  raw[idx] = (raw[idx]! & ~mask) | ((val << off) & mask);
}

// ===========================================================================
// TROTEC (PAC 3200 / Duux)
// ===========================================================================

const HDR_MARK = 5952;
const HDR_SPACE = 7364;
const BIT_MARK = 592;
const ONE_SPACE = 1560;
const ZERO_SPACE = 592;
const GAP = 6184;
const GAP_END = 1500;

const INTRO1 = 0x12;
const INTRO2 = 0x34;
const TEMP_MIN = 18;
const TEMP_DEF = 25;
const TEMP_MAX = 32;
const MAX_TIMER = 23; // hours

export interface TrotecState {
  power?: boolean;
  mode?: TrotecModeValue;
  /** Temperature in °C (18–32). */
  temp?: number;
  fan?: TrotecFanValue;
  sleep?: boolean;
  /** Timer in whole hours (0–23). */
  timer?: number;
}

/** Verify the byte-8 checksum (sum of bytes 2–7) of a Trotec state. */
export function trotecValidChecksum(raw: Uint8Array): boolean {
  return raw[TROTEC_STATE_LENGTH - 1] === (sumBytes(raw, 2, TROTEC_STATE_LENGTH - 1) & 0xff);
}

/** Build the raw 9-byte Trotec (PAC 3200) state (mirrors `stateReset` + setters). */
export function buildTrotecRaw(state: TrotecState): Uint8Array {
  const raw = new Uint8Array(TROTEC_STATE_LENGTH);
  raw[0] = INTRO1;
  raw[1] = INTRO2;
  setBits(raw, 2, 0, 2, (state.mode ?? TrotecMode.Auto) > TrotecMode.Fan ? TrotecMode.Auto : state.mode ?? TrotecMode.Auto);
  setBits(raw, 2, 3, 1, (state.power ?? false) ? 1 : 0);
  setBits(raw, 2, 4, 2, Math.min(state.fan ?? TrotecFan.Med, TrotecFan.High));
  setBits(raw, 3, 0, 4, clamp(state.temp ?? TEMP_DEF, TEMP_MIN, TEMP_MAX) - TEMP_MIN);
  setBits(raw, 3, 7, 1, (state.sleep ?? false) ? 1 : 0);
  const timer = state.timer ?? 0;
  setBits(raw, 5, 6, 1, timer & 1); // Timer bit mirrors the class's `_.Timer = timer`
  raw[6] = Math.min(timer, MAX_TIMER); // Hours
  raw[8] = sumBytes(raw, 2, TROTEC_STATE_LENGTH - 1) & 0xff;
  return raw;
}

/** Encode a raw 9-byte Trotec state into IR timings (`IRsend::sendTrotec`). */
export function encodeTrotecRaw(raw: Uint8Array, repeat: number = 0): number[] {
  const out: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    const frame = sendGenericBytes({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: GAP, data: raw, msbFirst: false,
    });
    for (const t of frame) out.push(t);
    out.push(BIT_MARK, GAP_END); // extra footer per repeat
  }
  return out;
}

/** Build + encode a Trotec state into IR timings. */
export function sendTrotec(state: TrotecState, repeat: number = 0): number[] {
  return encodeTrotecRaw(buildTrotecRaw(state), repeat);
}

/** Parse a validated 9-byte Trotec state. */
export function parseTrotecState(raw: Uint8Array): TrotecState {
  return {
    power: !!getBits(raw, 2, 3, 1),
    mode: getBits(raw, 2, 0, 2) as TrotecModeValue,
    temp: getBits(raw, 3, 0, 4) + TEMP_MIN,
    fan: getBits(raw, 2, 4, 2) as TrotecFanValue,
    sleep: !!getBits(raw, 3, 7, 1),
    timer: raw[6]!,
  };
}

/** Decode raw IR timings as a Trotec (PAC 3200) message. */
export function decodeTrotec(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): TrotecState | null {
  const result = matchGenericBytes(
    timings, offset, timings.length - offset, TROTEC_STATE_LENGTH,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP, true, undefined, undefined, false, headerOptional,
  );
  if (!result) return null;
  if (raw0Mismatch(result.data)) return null;
  if (!trotecValidChecksum(result.data)) return null;
  return parseTrotecState(result.data);
}

/** Reject frames lacking the fixed 0x12/0x34 intro (cheap disambiguation). */
function raw0Mismatch(raw: Uint8Array): boolean {
  return raw[0] !== INTRO1 || raw[1] !== INTRO2;
}

// ===========================================================================
// TROTEC_3550 (PAC 3550 Pro)
// ===========================================================================

const HDR_MARK_3550 = 12000;
const HDR_SPACE_3550 = 5130;
const BIT_MARK_3550 = 550;
const ONE_SPACE_3550 = 1950;
const ZERO_SPACE_3550 = 500;
const MESSAGE_GAP_3550 = 100000;

const MIN_TEMP_C = 16;
const MAX_TEMP_C = 30;
const MIN_TEMP_F = 59;
const MAX_TEMP_F = 86;
const TIMER_MAX_MINS = 8 * 60;

/** stateReset for the 3550 (22°C, fan low, mode auto, Celsius). */
const RESET_3550: readonly number[] = [0x55, 0x60, 0x00, 0x0d, 0x00, 0x00, 0x10, 0x88, 0x5a];

export interface Trotec3550State {
  power?: boolean;
  mode?: TrotecModeValue;
  /** Temperature in the active unit (°C 16–30 / °F 59–86). */
  temp?: number;
  /** Whether {@link temp} is Celsius. Defaults to true. */
  celsius?: boolean;
  fan?: TrotecFanValue;
  swingV?: boolean;
  /** Timer in minutes (hour resolution; 0 disables). */
  timer?: number;
}

const cToF = (c: number): number => Math.trunc((c * 9) / 5 + 32);
const fToC = (f: number): number => Math.trunc(((f - 32) * 5) / 9);

/** Verify the byte-8 checksum (sum of bytes 0–7) of a Trotec3550 state. */
export function trotec3550ValidChecksum(raw: Uint8Array): boolean {
  return raw[TROTEC_STATE_LENGTH - 1] === (sumBytes(raw, 0, TROTEC_STATE_LENGTH - 1) & 0xff);
}

/** Build the raw 9-byte Trotec3550 state (mirrors `stateReset` + setters). */
export function buildTrotec3550Raw(state: Trotec3550State): Uint8Array {
  const raw = Uint8Array.from(RESET_3550);
  const celsius = state.celsius ?? true;
  setBits(raw, 7, 7, 1, celsius ? 1 : 0); // Celsius
  setBits(raw, 1, 1, 1, (state.power ?? false) ? 1 : 0); // Power
  setBits(raw, 6, 0, 2, (state.mode ?? TrotecMode.Auto) > TrotecMode.Fan ? TrotecMode.Auto : state.mode ?? TrotecMode.Auto);
  setBits(raw, 6, 4, 2, Math.min(state.fan ?? TrotecFan.Low, TrotecFan.High));
  setBits(raw, 1, 0, 1, (state.swingV ?? false) ? 1 : 0); // SwingV

  // Temperature: both °C and °F fields are written, the inactive one converted.
  if (celsius) {
    const t = clamp(state.temp ?? 25, MIN_TEMP_C, MAX_TEMP_C);
    setBits(raw, 1, 4, 4, t - MIN_TEMP_C); // TempC
    setBits(raw, 3, 0, 5, cToF(t) - MIN_TEMP_F); // TempF
  } else {
    const t = clamp(state.temp ?? 77, MIN_TEMP_F, MAX_TEMP_F);
    setBits(raw, 3, 0, 5, t - MIN_TEMP_F); // TempF
    setBits(raw, 1, 4, 4, fToC(t) - MIN_TEMP_C); // TempC
  }

  const mins = state.timer ?? 0;
  setBits(raw, 1, 3, 1, mins > 0 ? 1 : 0); // TimerSet
  setBits(raw, 2, 0, 4, Math.floor(Math.min(mins, TIMER_MAX_MINS) / 60)); // TimerHrs

  raw[8] = sumBytes(raw, 0, TROTEC_STATE_LENGTH - 1) & 0xff;
  return raw;
}

/** Encode a raw 9-byte Trotec3550 state into IR timings (MSB-first). */
export function encodeTrotec3550Raw(raw: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK_3550, headerSpace: HDR_SPACE_3550,
    oneMark: BIT_MARK_3550, oneSpace: ONE_SPACE_3550, zeroMark: BIT_MARK_3550, zeroSpace: ZERO_SPACE_3550,
    footerMark: BIT_MARK_3550, gap: MESSAGE_GAP_3550, data: raw, msbFirst: true, repeat,
  });
}

/** Build + encode a Trotec3550 state into IR timings. */
export function sendTrotec3550(state: Trotec3550State, repeat: number = 0): number[] {
  return encodeTrotec3550Raw(buildTrotec3550Raw(state), repeat);
}

/** Parse a validated 9-byte Trotec3550 state. */
export function parseTrotec3550State(raw: Uint8Array): Trotec3550State {
  const celsius = !!getBits(raw, 7, 7, 1);
  return {
    power: !!getBits(raw, 1, 1, 1),
    mode: getBits(raw, 6, 0, 2) as TrotecModeValue,
    celsius,
    temp: celsius ? getBits(raw, 1, 4, 4) + MIN_TEMP_C : getBits(raw, 3, 0, 5) + MIN_TEMP_F,
    fan: getBits(raw, 6, 4, 2) as TrotecFanValue,
    swingV: !!getBits(raw, 1, 0, 1),
    timer: getBits(raw, 2, 0, 4) * 60,
  };
}

/** Decode raw IR timings as a Trotec3550 (PAC 3550 Pro) message (MSB-first). */
export function decodeTrotec3550(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Trotec3550State | null {
  const result = matchGenericBytes(
    timings, offset, timings.length - offset, TROTEC_STATE_LENGTH,
    HDR_MARK_3550, HDR_SPACE_3550, BIT_MARK_3550, ONE_SPACE_3550, BIT_MARK_3550, ZERO_SPACE_3550,
    BIT_MARK_3550, MESSAGE_GAP_3550, true, undefined, undefined, true, headerOptional,
  );
  if (!result) return null;
  if (result.data[0] !== 0x55) return null; // fixed intro
  if (!trotec3550ValidChecksum(result.data)) return null;
  return parseTrotec3550State(result.data);
}
