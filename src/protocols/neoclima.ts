/**
 * Neoclima A/C IR protocol encoder and decoder. (NEOCLIMA)
 *
 * Ported from IRremoteESP8266 `ir_Neoclima.cpp` / `ir_Neoclima.h` — full coverage
 * of the `IRNeoclimaAc` class and the `sendNeoclima` / `decodeNeoclima` wire
 * format. Models: Neoclima NS-09AHTI, Soleus Air TTWM1-10-01 (ZH/TY-01,
 * ZCF/TL-05 remotes).
 *
 * Wire format: a 12-byte state sent LSB-first behind a 6112/7391 header; the
 * data frame ends with a bit-mark + header-space, then an extra bit-mark +
 * ≈100ms gap. byte 11 is a modulo-256 sum of bytes 0–10; byte 10 is a constant
 * `0xA5`. Each message also carries a 5-bit **Button** marker (byte 5) recording
 * the last-pressed key, plus the full carried state (mode/temp/fan/swing and a
 * large set of toggles: turbo, econo, fresh, hold, ion, light, sleep, eye,
 * 8 °C-heat). Temperature may be °C (16–32) or °F (61–90).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Neoclima.cpp
 */

import { sendGenericBytes, sumBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Neoclima.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 6112;
const HDR_SPACE = 7391;
const BIT_MARK = 537;
const ONE_SPACE = 1651;
const ZERO_SPACE = 571;
const MIN_GAP = 100000; // kDefaultMessageGap

export const NEOCLIMA_STATE_LENGTH = 12;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const NeoclimaMode = {
  Auto: 0b000,
  Cool: 0b001,
  Dry: 0b010,
  Fan: 0b011,
  Heat: 0b100,
} as const;
export type NeoclimaModeValue = (typeof NeoclimaMode)[keyof typeof NeoclimaMode];

export const NeoclimaFan = {
  Auto: 0b00,
  High: 0b01,
  Med: 0b10,
  Low: 0b11,
} as const;
export type NeoclimaFanValue = (typeof NeoclimaFan)[keyof typeof NeoclimaFan];

/** Last-pressed key markers (byte 5). */
export const NeoclimaButton = {
  Power: 0x00, Mode: 0x01, TempUp: 0x02, TempDown: 0x03, Swing: 0x04,
  FanSpeed: 0x05, AirFlow: 0x07, Hold: 0x08, Sleep: 0x09, Turbo: 0x0a,
  Light: 0x0b, Econo: 0x0d, Eye: 0x0e, Follow: 0x13, Ion: 0x14,
  Fresh: 0x15, Heat8C: 0x1d, TempUnit: 0x1e,
} as const;
export type NeoclimaButtonValue = (typeof NeoclimaButton)[keyof typeof NeoclimaButton];
const VALID_BUTTONS = new Set<number>(Object.values(NeoclimaButton));

const MIN_TEMP_C = 16;
const MAX_TEMP_C = 32;
const MIN_TEMP_F = 61;
const MAX_TEMP_F = 90;
const SWINGV_ON = 0b01;
const SWINGV_OFF = 0b10;
const FOLLOW_ME = 0x5d;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface NeoclimaState {
  /** Last-pressed key marker (byte 5); see {@link NeoclimaButton}. */
  button?: NeoclimaButtonValue;
  power?: boolean;
  mode?: NeoclimaModeValue;
  /** Temperature in the active unit (°C 16–32 / °F 61–90). */
  temp?: number;
  /** Whether {@link temp} is Celsius. Defaults to true. */
  celsius?: boolean;
  fan?: NeoclimaFanValue;
  swingV?: boolean;
  swingH?: boolean;
  sleep?: boolean;
  turbo?: boolean;
  econo?: boolean;
  fresh?: boolean;
  hold?: boolean;
  ion?: boolean;
  light?: boolean;
  /** 8 °C heat (freeze protect). */
  eightCHeat?: boolean;
  eye?: boolean;
  /** FollowMe (sensor) marker — read-only on the real remote. */
  followMe?: boolean;
}

// ---------------------------------------------------------------------------
// Bit helpers
// ---------------------------------------------------------------------------

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

/** Verify the byte-11 checksum (sum of bytes 0–10) of a Neoclima state. */
export function neoclimaValidChecksum(raw: Uint8Array): boolean {
  if (raw.length < 2) return true;
  return raw[raw.length - 1] === (sumBytes(raw, 0, raw.length - 1) & 0xff);
}

// ---------------------------------------------------------------------------
// Build raw 12-byte state — defaults match `stateReset`
// ---------------------------------------------------------------------------

/**
 * Build the raw 12-byte Neoclima state from a state object.
 *
 * Field defaults mirror `stateReset` (Power on, Cool, 26 °C, Fan low, swing-V
 * off, swing-H on, Celsius). Dry mode forces low fan (as the class does). byte
 * 10 is the constant `0xA5`; byte 11 is the checksum.
 */
export function buildNeoclimaRaw(state: NeoclimaState): Uint8Array {
  const raw = new Uint8Array(NEOCLIMA_STATE_LENGTH);
  raw[10] = 0xa5; // constant

  const celsius = state.celsius ?? true;
  const mode = isMode(state.mode) ? state.mode! : NeoclimaMode.Auto;
  const fan = mode === NeoclimaMode.Dry ? NeoclimaFan.Low : (isFan(state.fan) ? state.fan! : NeoclimaFan.Low);
  const button = state.button !== undefined && VALID_BUTTONS.has(state.button)
    ? state.button : NeoclimaButton.Power;

  // byte 1
  setBits(raw, 1, 1, 1, (state.eightCHeat ?? false) ? 1 : 0); // CHeat
  setBits(raw, 1, 2, 1, (state.ion ?? false) ? 1 : 0); // Ion
  // byte 3
  setBits(raw, 3, 0, 1, (state.light ?? false) ? 1 : 0); // Light
  setBits(raw, 3, 2, 1, (state.hold ?? false) ? 1 : 0); // Hold
  setBits(raw, 3, 3, 1, (state.turbo ?? false) ? 1 : 0); // Turbo
  setBits(raw, 3, 4, 1, (state.econo ?? false) ? 1 : 0); // Econo
  setBits(raw, 3, 6, 1, (state.eye ?? false) ? 1 : 0); // Eye
  // byte 5
  setBits(raw, 5, 0, 5, button); // Button
  setBits(raw, 5, 7, 1, (state.fresh ?? false) ? 1 : 0); // Fresh
  // byte 7
  setBits(raw, 7, 0, 1, (state.sleep ?? false) ? 1 : 0); // Sleep
  setBits(raw, 7, 1, 1, (state.power ?? true) ? 1 : 0); // Power
  setBits(raw, 7, 2, 2, (state.swingV ?? false) ? SWINGV_ON : SWINGV_OFF); // SwingV
  setBits(raw, 7, 4, 1, (state.swingH ?? true) ? 0 : 1); // SwingH (inverted)
  setBits(raw, 7, 5, 2, fan); // Fan
  setBits(raw, 7, 7, 1, celsius ? 0 : 1); // UseFah
  // byte 8
  raw[8] = (state.followMe ?? false) ? FOLLOW_ME : 0; // Follow
  // byte 9
  const min = celsius ? MIN_TEMP_C : MIN_TEMP_F;
  const max = celsius ? MAX_TEMP_C : MAX_TEMP_F;
  setBits(raw, 9, 0, 5, clamp(state.temp ?? 26, min, max) - min); // Temp
  setBits(raw, 9, 5, 3, mode); // Mode

  raw[11] = sumBytes(raw, 0, NEOCLIMA_STATE_LENGTH - 1) & 0xff;
  return raw;
}

function isMode(m: number | undefined): boolean {
  return m === NeoclimaMode.Auto || m === NeoclimaMode.Cool || m === NeoclimaMode.Dry ||
    m === NeoclimaMode.Fan || m === NeoclimaMode.Heat;
}
function isFan(f: number | undefined): boolean {
  return f === NeoclimaFan.Auto || f === NeoclimaFan.High || f === NeoclimaFan.Med || f === NeoclimaFan.Low;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 12-byte Neoclima state into IR timings.
 *
 * Matches `IRsend::sendNeoclima`: header + 12 bytes (LSB-first) + bit-mark +
 * header-space, then an extra bit-mark + ≈100ms gap, per repeat.
 */
export function encodeNeoclimaRaw(raw: Uint8Array, repeat: number = 0): number[] {
  const out: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    const frame = sendGenericBytes({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: HDR_SPACE, data: raw, msbFirst: false,
    });
    for (const t of frame) out.push(t);
    out.push(BIT_MARK, MIN_GAP); // extra footer per repeat
  }
  return out;
}

/** Build + encode a Neoclima state into IR timings. */
export function sendNeoclima(state: NeoclimaState, repeat: number = 0): number[] {
  return encodeNeoclimaRaw(buildNeoclimaRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 12-byte Neoclima state. */
export function parseNeoclimaState(raw: Uint8Array): NeoclimaState {
  const celsius = getBits(raw, 7, 7, 1) === 0;
  const min = celsius ? MIN_TEMP_C : MIN_TEMP_F;
  return {
    button: getBits(raw, 5, 0, 5) as NeoclimaButtonValue,
    power: !!getBits(raw, 7, 1, 1),
    mode: getBits(raw, 9, 5, 3) as NeoclimaModeValue,
    celsius,
    temp: getBits(raw, 9, 0, 5) + min,
    fan: getBits(raw, 7, 5, 2) as NeoclimaFanValue,
    swingV: getBits(raw, 7, 2, 2) === SWINGV_ON,
    swingH: getBits(raw, 7, 4, 1) === 0, // inverted
    sleep: !!getBits(raw, 7, 0, 1),
    turbo: !!getBits(raw, 3, 3, 1),
    econo: !!getBits(raw, 3, 4, 1),
    fresh: !!getBits(raw, 5, 7, 1),
    hold: !!getBits(raw, 3, 2, 1),
    ion: !!getBits(raw, 1, 2, 1),
    light: !!getBits(raw, 3, 0, 1),
    eightCHeat: !!getBits(raw, 1, 1, 1),
    eye: !!getBits(raw, 3, 6, 1),
    followMe: (raw[8]! & FOLLOW_ME) === FOLLOW_ME,
  };
}

/**
 * Decode raw IR timings as a Neoclima A/C message.
 *
 * Mirrors `IRrecv::decodeNeoclima`: match the header + 12 LSB-first bytes +
 * footer, then validate the modulo-256 checksum.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeNeoclima(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): NeoclimaState | null {
  const result = matchGenericBytes(
    timings, offset, timings.length - offset, NEOCLIMA_STATE_LENGTH,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, HDR_SPACE, false, undefined, 0, false, headerOptional,
  );
  if (!result) return null;
  if (raw10Const(result.data)) return null;
  if (!neoclimaValidChecksum(result.data)) return null;
  return parseNeoclimaState(result.data);
}

/** Reject frames missing the constant byte-10 = 0xA5 (cheap disambiguation). */
function raw10Const(raw: Uint8Array): boolean {
  return raw[10] !== 0xa5;
}
