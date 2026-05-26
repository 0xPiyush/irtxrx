/**
 * Voltas A/C IR protocol encoder and decoder.
 *
 * 80-bit (10-byte) state, MSB-first, no header.
 * Single byte XOR-sum checksum at byte 9.
 *
 * Ported from IRremoteESP8266 `ir_Voltas.cpp` / `ir_Voltas.h`.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1238
 */

import { sumBytes, sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — match ir_Voltas.cpp exactly
// ---------------------------------------------------------------------------

const BIT_MARK = 1026;
const ONE_SPACE = 2553;
const ZERO_SPACE = 554;
const GAP = 100000; // kDefaultMessageGap
const STATE_LENGTH = 10;

// ---------------------------------------------------------------------------
// Mode constants
// ---------------------------------------------------------------------------

export const VoltasMode = {
  Fan: 0b0001,  // 1
  Heat: 0b0010, // 2
  Dry: 0b0100,  // 4
  Cool: 0b1000, // 8
} as const;

export type VoltasModeValue = (typeof VoltasMode)[keyof typeof VoltasMode];

// ---------------------------------------------------------------------------
// Fan constants
// ---------------------------------------------------------------------------

export const VoltasFan = {
  High: 0b001, // 1
  Med: 0b010,  // 2
  Low: 0b100,  // 4
  Auto: 0b111, // 7
} as const;

export type VoltasFanValue = (typeof VoltasFan)[keyof typeof VoltasFan];

// ---------------------------------------------------------------------------
// Model constants
// ---------------------------------------------------------------------------

export const VoltasModel = {
  /** Full Function — supports horizontal swing. */
  Unknown: 0,
  /** 122LZF — no horizontal swing support (default). */
  LZF: 1,
} as const;

export type VoltasModelValue = (typeof VoltasModel)[keyof typeof VoltasModel];

// SwingHChange field values
const SWINGH_CHANGE = 0b1111100;    // 0x7D — model supports SwingH, change is being made
const SWINGH_NO_CHANGE = 0b0011001; // 0x19 — model doesn't support SwingH, no change

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface VoltasState {
  /** Remote model. Default: LZF (122LZF, no SwingH support). */
  model?: VoltasModelValue;
  power?: boolean;
  /** Operating mode. Default: Cool. */
  mode?: VoltasModeValue;
  /** Temperature in °C (16–30). Default: 24. */
  temp?: number;
  /** Fan speed. Default: Auto. */
  fan?: VoltasFanValue;
  /** Vertical swing on/off. */
  swingV?: boolean;
  /** Horizontal swing on/off. Only effective on Unknown (full) model. */
  swingH?: boolean;
  /** Turbo mode. Only effective in Cool mode. */
  turbo?: boolean;
  /** Sleep mode. Only effective in Cool mode. */
  sleep?: boolean;
  /** Economy mode. Only effective in Cool mode. */
  econo?: boolean;
  light?: boolean;
  wifi?: boolean;
  /** On timer in minutes (0–1439). 0 disables the timer. */
  onTime?: number;
  /** Off timer in minutes (0–1439). 0 disables the timer. */
  offTime?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TEMP = 16;
const MAX_TEMP = 30;
const MAX_TIMER_MINS = 23 * 60 + 59; // 1439

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

function getBit(raw: Uint8Array, byteIdx: number, bitIdx: number): boolean {
  return ((raw[byteIdx]! >> bitIdx) & 1) === 1;
}

function getBitsRange(raw: Uint8Array, byteIdx: number, bitOffset: number, size: number): number {
  return (raw[byteIdx]! >> bitOffset) & ((1 << size) - 1);
}

// ---------------------------------------------------------------------------
// Default state — kReset from ir_Voltas.cpp
// ---------------------------------------------------------------------------

function defaultState(): Uint8Array {
  return new Uint8Array([0x33, 0x28, 0x00, 0x17, 0x3B, 0x3B, 0x3B, 0x11, 0x00, 0xCB]);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Build a 10-byte Voltas raw state from a state object.
 */
export function buildVoltasRaw(state: VoltasState): Uint8Array {
  const raw = defaultState();

  // Model — determines SwingHChange behavior.
  const model: VoltasModelValue = state.model ?? VoltasModel.LZF;

  // Mode (byte 1, bits 0–3). Defaults/validates to Cool.
  let mode: VoltasModeValue = state.mode ?? VoltasMode.Cool;
  if (mode !== VoltasMode.Cool && mode !== VoltasMode.Heat &&
      mode !== VoltasMode.Dry && mode !== VoltasMode.Fan) {
    mode = VoltasMode.Cool;
  }
  setBitsRange(raw, 1, 0, 4, mode);

  // Temp (byte 3, bits 0–3). Clamped 16–30, stored as (temp - 16).
  const temp = Math.min(Math.max(state.temp ?? 24, MIN_TEMP), MAX_TEMP);
  setBitsRange(raw, 3, 0, 4, temp - MIN_TEMP);

  // Fan (byte 1, bits 5–7). Auto not allowed in Fan mode (becomes High).
  let fan: VoltasFanValue = state.fan ?? VoltasFan.Auto;
  if (fan !== VoltasFan.Low && fan !== VoltasFan.Med &&
      fan !== VoltasFan.High && fan !== VoltasFan.Auto) {
    fan = VoltasFan.Auto;
  }
  if (fan === VoltasFan.Auto && mode === VoltasMode.Fan) {
    fan = VoltasFan.High;
  }
  setBitsRange(raw, 1, 5, 3, fan);

  // SwingH and SwingHChange (byte 0).
  if (model === VoltasModel.LZF) {
    // No SwingH support. SwingHChange = 0x19, SwingH = 1 (forced by C++ logic).
    setBit(raw, 0, 0, true);
    setBitsRange(raw, 0, 1, 7, SWINGH_NO_CHANGE);
  } else {
    // Full-feature model. SwingHChange = 0x7D, SwingH = user value.
    setBit(raw, 0, 0, state.swingH ?? false);
    setBitsRange(raw, 0, 1, 7, SWINGH_CHANGE);
  }

  // SwingV (byte 2, bits 0–2). Tristate: 0b111 = on, 0b000 = off.
  setBitsRange(raw, 2, 0, 3, (state.swingV ?? false) ? 0b111 : 0b000);

  // Wifi (byte 2, bit 3).
  setBit(raw, 2, 3, state.wifi ?? false);

  // Turbo (byte 2, bit 5). Only valid in Cool mode.
  setBit(raw, 2, 5, (state.turbo ?? false) && mode === VoltasMode.Cool);

  // Sleep (byte 2, bit 6). Only valid in Cool mode.
  setBit(raw, 2, 6, (state.sleep ?? false) && mode === VoltasMode.Cool);

  // Power (byte 2, bit 7).
  setBit(raw, 2, 7, state.power ?? false);

  // Econo (byte 3, bit 6). Only valid in Cool mode.
  setBit(raw, 3, 6, (state.econo ?? false) && mode === VoltasMode.Cool);

  // Timers — always applied (matching C++ setter semantics).
  applyTimer(raw, state.onTime ?? 0, "on");
  applyTimer(raw, state.offTime ?? 0, "off");

  // Light (byte 8, bit 5).
  setBit(raw, 8, 5, state.light ?? false);

  // Checksum (byte 9): ~sum(bytes 0–8).
  raw[9] = (~sumBytes(raw, 0, 9)) & 0xFF;

  return raw;
}

function applyTimer(raw: Uint8Array, mins: number, which: "on" | "off") {
  const m = Math.min(Math.max(mins, 0), MAX_TIMER_MINS);
  const hrs = Math.floor(m / 60) + 1;
  const minsField = m % 60;
  const hr12 = Math.floor(hrs / 12) & 1;
  const hrsMod = hrs % 12;
  const enable = m > 0;

  if (which === "on") {
    setBitsRange(raw, 4, 0, 6, minsField); // OnTimerMins
    setBit(raw, 4, 7, hr12 === 1);          // OnTimer12Hr
    setBitsRange(raw, 7, 0, 4, hrsMod);     // OnTimerHrs (low nibble)
    setBit(raw, 8, 7, enable);              // OnTimerEnable
  } else {
    setBitsRange(raw, 5, 0, 6, minsField); // OffTimerMins
    setBit(raw, 5, 7, hr12 === 1);          // OffTimer12Hr
    setBitsRange(raw, 7, 4, 4, hrsMod);     // OffTimerHrs (high nibble)
    setBit(raw, 8, 6, enable);              // OffTimerEnable
  }
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a 10-byte Voltas state into raw IR timings.
 */
export function encodeVoltasRaw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: 0, headerSpace: 0,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE,
    zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP,
    data, msbFirst: true, repeat,
  });
}

/**
 * Encode a Voltas state into raw IR timings.
 */
export function sendVoltas(state: VoltasState, repeat: number = 0): number[] {
  return encodeVoltasRaw(buildVoltasRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Voltas A/C state.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeVoltas(
  timings: number[],
  offset: number = 0,
  _headerOptional: boolean = false,
): VoltasState | null {
  const result = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    0, 0,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, // atLeast
  );
  if (!result) return null;

  const raw = result.data;

  // Validate checksum.
  const expectedChecksum = (~sumBytes(raw, 0, 9)) & 0xFF;
  if (raw[9] !== expectedChecksum) return null;

  return parseVoltasState(raw);
}

/**
 * Parse a 10-byte Voltas raw state into a state object.
 */
export function parseVoltasState(raw: Uint8Array): VoltasState {
  if (raw.length < STATE_LENGTH) {
    throw new Error(`Voltas raw state must be at least ${STATE_LENGTH} bytes`);
  }

  // Model: derived from SwingHChange field.
  const swingHChange = getBitsRange(raw, 0, 1, 7);
  const model: VoltasModelValue = swingHChange === SWINGH_NO_CHANGE
    ? VoltasModel.LZF
    : VoltasModel.Unknown;

  const mode = getBitsRange(raw, 1, 0, 4) as VoltasModeValue;
  const fan = getBitsRange(raw, 1, 5, 3) as VoltasFanValue;
  const tempField = getBitsRange(raw, 3, 0, 4);
  const temp = tempField + MIN_TEMP;

  const state: VoltasState = {
    model,
    power: getBit(raw, 2, 7),
    mode,
    temp,
    fan,
    swingV: getBitsRange(raw, 2, 0, 3) === 0b111,
    turbo: getBit(raw, 2, 5),
    sleep: getBit(raw, 2, 6),
    econo: getBit(raw, 3, 6),
    light: getBit(raw, 8, 5),
    wifi: getBit(raw, 2, 3),
  };

  // SwingH only meaningful on full-feature model.
  if (model === VoltasModel.Unknown) {
    state.swingH = getBit(raw, 0, 0);
  } else {
    state.swingH = false;
  }

  // Timers — extract using the C++ getOnTime/getOffTime formulas.
  state.onTime = decodeTimer(raw, "on");
  state.offTime = decodeTimer(raw, "off");

  return state;
}

function decodeTimer(raw: Uint8Array, which: "on" | "off"): number {
  let mins: number, hr12: number, hrs: number, enable: boolean;
  if (which === "on") {
    mins = getBitsRange(raw, 4, 0, 6);
    hr12 = (raw[4]! >> 7) & 1;
    hrs = getBitsRange(raw, 7, 0, 4);
    enable = getBit(raw, 8, 7);
  } else {
    mins = getBitsRange(raw, 5, 0, 6);
    hr12 = (raw[5]! >> 7) & 1;
    hrs = getBitsRange(raw, 7, 4, 4);
    enable = getBit(raw, 8, 6);
  }
  if (!enable) return 0;
  // (12 * 12hr + hrs - 1), clamped to 23 hours, then add mins.
  // C++ uses unsigned arithmetic, so hrs=0 + 12hr=0 underflows to a huge
  // value which the clamp pins to 23. Replicate that explicitly.
  const hrTotal = 12 * hr12 + hrs - 1;
  const clampedHrs = hrTotal < 0 ? 23 : Math.min(hrTotal, 23);
  return clampedHrs * 60 + mins;
}
