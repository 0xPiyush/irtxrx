/**
 * Hitachi 104-bit (13-byte) A/C protocol encoder and decoder. (HITACHI_AC1)
 *
 * Ported from IRremoteESP8266 `ir_Hitachi.cpp` / `ir_Hitachi.h`.
 *
 * Wire format: 3400/3400 header + 13 bytes (MSB-first) + footer. Several fields
 * are stored bit-reversed (temperature is a 5-bit reversed value, timers are
 * 16-bit reversed), and a nibble-sum checksum over bytes 5–11 lives in byte 12.
 *
 * Models: R-LT0541-HTA in "A" (default) or "B" setting.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/453
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1056
 */

import { reverseBits, sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";
import {
  HITACHI_AC1_HDR_MARK,
  HITACHI_AC1_HDR_SPACE,
  HITACHI_BIT_MARK,
  HITACHI_ONE_SPACE,
  HITACHI_ZERO_SPACE,
  HITACHI_MIN_GAP,
  HITACHI_BASE_TOLERANCE,
} from "./hitachi_common.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_LENGTH = 13;
const MIN_TEMP = 16;
const MAX_TEMP = 32;
const TEMP_DELTA = 7;
const TEMP_AUTO = 25;
const TEMP_SIZE = 5;
const CHECKSUM_START = 5;

/** Remote model: 1 = R-LT0541-HTA "A" (default), 2 = "B". */
export const HitachiAc1Model = {
  A: 1,
  B: 2,
} as const;

export type HitachiAc1ModelValue = (typeof HitachiAc1Model)[keyof typeof HitachiAc1Model];

const MODEL_RAW_A = 0b10;
const MODEL_RAW_B = 0b01;

export const HitachiAc1Mode = {
  Dry: 2,
  Fan: 4,
  Cool: 6,
  Heat: 9,
  Auto: 14,
} as const;

export type HitachiAc1ModeValue = (typeof HitachiAc1Mode)[keyof typeof HitachiAc1Mode];

export const HitachiAc1Fan = {
  Auto: 1,
  High: 2,
  Med: 4,
  Low: 8,
} as const;

export type HitachiAc1FanValue = (typeof HitachiAc1Fan)[keyof typeof HitachiAc1Fan];

const SLEEP_OFF = 0;
const SLEEP_MAX = 4;

/** Fixed known-good template from `IRHitachiAc1::stateReset`. */
const TEMPLATE: readonly number[] = [
  0xB2, 0xAE, 0x4D, 0x91, 0xF0, 0xE1, 0xA4, 0x00, 0x00, 0x00,
  0x00, 0x61, 0x24,
];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface HitachiAc1State {
  model?: HitachiAc1ModelValue;
  power?: boolean;
  /** Power-toggle bit. The remote sets it whenever power changes. */
  powerToggle?: boolean;
  mode?: HitachiAc1ModeValue;
  /** Temperature in °C (16–32). Locked to 25°C and unchangeable in Auto mode. */
  temp?: number;
  fan?: HitachiAc1FanValue;
  /** Swing-toggle bit (the remote sends it when the swing button is pressed). */
  swingToggle?: boolean;
  swingV?: boolean;
  swingH?: boolean;
  /** Sleep 0 (off) – 4. Only available in Auto & Cool modes. */
  sleep?: number;
  /** On-timer in minutes (0 = off). */
  onTimer?: number;
  /** Off-timer in minutes (0 = off). */
  offTimer?: number;
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

/** Matches `IRHitachiAc1::calcChecksum`: nibble-sum over bytes 5–11, reversed. */
function calcChecksum(raw: Uint8Array, length: number = STATE_LENGTH): number {
  let sum = 0;
  for (let i = CHECKSUM_START; i < length - 1; i++) {
    sum += reverseBits(raw[i]! & 0x0F, 4);
    sum += reverseBits((raw[i]! >> 4) & 0x0F, 4);
  }
  return reverseBits(sum & 0xFF, 8);
}

// ---------------------------------------------------------------------------
// Build raw byte array — emulates the IRHitachiAc1 setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 13-byte HITACHI_AC1 state from a state object.
 *
 * Emulates `stateReset()` followed by the C++ setter order. Note the library's
 * quirk that in Heat/Fan modes the fan can only ever be forced to Low, and that
 * temperature is locked at 25°C in Auto mode — both are reproduced here.
 */
export function buildHitachiAc1Raw(state: HitachiAc1State): Uint8Array {
  const raw = Uint8Array.from(TEMPLATE);

  const getMode = (): number => (raw[5]! >> 4) & 0x0F;
  const getFan = (): number => raw[5]! & 0x0F;
  const setFanRaw = (f: number): void => { raw[5] = (raw[5]! & 0xF0) | (f & 0x0F); };
  const getSleep = (): number => (raw[11]! >> 1) & 0x07;

  const setModel = (model: number): void => {
    const value = model === HitachiAc1Model.B ? MODEL_RAW_B : MODEL_RAW_A;
    raw[3] = (raw[3]! & ~(0b11 << 6)) | (value << 6);
  };

  const setTemp = (celsius: number): void => {
    if (getMode() === HitachiAc1Mode.Auto) return;  // Can't change temp in Auto.
    let temp = Math.min(Math.max(celsius, MIN_TEMP), MAX_TEMP) - TEMP_DELTA;
    temp = reverseBits(temp, TEMP_SIZE) & 0x1F;
    raw[6] = (raw[6]! & ~(0x1F << 2)) | (temp << 2);
  };

  const setFan = (speed: number): void => {
    switch (getMode()) {
      case HitachiAc1Mode.Dry: setFanRaw(HitachiAc1Fan.Low); return;
      case HitachiAc1Mode.Auto: setFanRaw(HitachiAc1Fan.Auto); return;
      case HitachiAc1Mode.Heat:
      case HitachiAc1Mode.Fan:  // Auto speed not allowed in these modes.
        if (speed === HitachiAc1Fan.Auto || getFan() === HitachiAc1Fan.Auto)
          setFanRaw(HitachiAc1Fan.Low);
        return;
    }
    switch (speed) {
      case HitachiAc1Fan.Auto:
      case HitachiAc1Fan.High:
      case HitachiAc1Fan.Med:
      case HitachiAc1Fan.Low:
        setFanRaw(speed);
        break;
      default: setFanRaw(HitachiAc1Fan.Auto);
    }
  };

  const setSleep = (mode: number): void => {
    switch (getMode()) {
      case HitachiAc1Mode.Auto:
      case HitachiAc1Mode.Cool:
        raw[11] = (raw[11]! & ~(0x07 << 1)) | ((Math.min(mode, SLEEP_MAX) & 0x07) << 1);
        break;
      default:
        raw[11] = (raw[11]! & ~(0x07 << 1)) | ((SLEEP_OFF & 0x07) << 1);
    }
  };

  const setMode = (mode: number): void => {
    switch (mode) {
      case HitachiAc1Mode.Auto:
        setTemp(TEMP_AUTO);  // Acts before the mode is committed below.
        raw[5] = (raw[5]! & 0x0F) | (HitachiAc1Mode.Auto << 4);
        break;
      case HitachiAc1Mode.Fan:
      case HitachiAc1Mode.Heat:
      case HitachiAc1Mode.Cool:
      case HitachiAc1Mode.Dry:
        raw[5] = (raw[5]! & 0x0F) | ((mode & 0x0F) << 4);
        break;
      default:
        setTemp(TEMP_AUTO);
        raw[5] = (raw[5]! & 0x0F) | (HitachiAc1Mode.Auto << 4);
    }
    setSleep(getSleep());  // Correct the sleep mode if required.
    setFan(getFan());      // Correct the fan speed if required.
  };

  const setTimer = (lowIdx: number, highIdx: number, mins: number): void => {
    const minsLsb = reverseBits(mins & 0xFFFF, 16);
    raw[lowIdx] = (minsLsb >> 8) & 0xFF;
    raw[highIdx] = minsLsb & 0xFF;
  };

  setModel(state.model ?? HitachiAc1Model.A);
  setMode((state.mode ?? HitachiAc1Mode.Auto) as number);
  setTemp(state.temp ?? TEMP_AUTO);
  setFan((state.fan ?? HitachiAc1Fan.Auto) as number);

  if (state.swingV) raw[11] = raw[11]! | (1 << 6); else raw[11] = raw[11]! & ~(1 << 6);
  if (state.swingH) raw[11] = raw[11]! | (1 << 7); else raw[11] = raw[11]! & ~(1 << 7);
  if (state.swingToggle) raw[11] = raw[11]! | 0x01; else raw[11] = raw[11]! & ~0x01;
  setSleep(state.sleep ?? SLEEP_OFF);
  setTimer(7, 8, state.offTimer ?? 0);
  setTimer(9, 10, state.onTimer ?? 0);

  // setPower auto-toggles, so apply power then the explicit toggle override.
  const power = state.power ?? true;
  if (power) raw[11] = raw[11]! | (1 << 5); else raw[11] = raw[11]! & ~(1 << 5);
  if (state.powerToggle) raw[11] = raw[11]! | (1 << 4); else raw[11] = raw[11]! & ~(1 << 4);

  raw[12] = calcChecksum(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// Public encode API
// ---------------------------------------------------------------------------

/**
 * Encode a raw 13-byte HITACHI_AC1 state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendHitachiAC1`.
 */
export function encodeHitachiAc1Raw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HITACHI_AC1_HDR_MARK,
    headerSpace: HITACHI_AC1_HDR_SPACE,
    oneMark: HITACHI_BIT_MARK,
    oneSpace: HITACHI_ONE_SPACE,
    zeroMark: HITACHI_BIT_MARK,
    zeroSpace: HITACHI_ZERO_SPACE,
    footerMark: HITACHI_BIT_MARK,
    gap: HITACHI_MIN_GAP,
    data,
    msbFirst: true,
    repeat,
  });
}

/** Encode a HITACHI_AC1 state into raw IR timings. */
export function sendHitachiAc1(state: HitachiAc1State, repeat: number = 0): number[] {
  return encodeHitachiAc1Raw(buildHitachiAc1Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a HITACHI_AC1 message.
 *
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeHitachiAc1(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): HitachiAc1State | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    HITACHI_AC1_HDR_MARK, HITACHI_AC1_HDR_SPACE,
    HITACHI_BIT_MARK, HITACHI_ONE_SPACE,
    HITACHI_BIT_MARK, HITACHI_ZERO_SPACE,
    HITACHI_BIT_MARK, HITACHI_MIN_GAP,
    true, HITACHI_BASE_TOLERANCE, undefined, true,
    headerOptional,
  );
  if (!frame) return null;

  const raw = frame.data;
  if (raw[12] !== calcChecksum(raw)) return null;

  const modelRaw = (raw[3]! >> 6) & 0b11;
  const tempField = (raw[6]! >> 2) & 0x1F;
  const onLsb = (raw[9]! << 8) | raw[10]!;
  const offLsb = (raw[7]! << 8) | raw[8]!;

  return {
    model: modelRaw === MODEL_RAW_B ? HitachiAc1Model.B : HitachiAc1Model.A,
    power: !!(raw[11]! & (1 << 5)),
    powerToggle: !!(raw[11]! & (1 << 4)),
    mode: ((raw[5]! >> 4) & 0x0F) as HitachiAc1ModeValue,
    temp: reverseBits(tempField, TEMP_SIZE) + TEMP_DELTA,
    fan: (raw[5]! & 0x0F) as HitachiAc1FanValue,
    swingToggle: !!(raw[11]! & 0x01),
    swingV: !!(raw[11]! & (1 << 6)),
    swingH: !!(raw[11]! & (1 << 7)),
    sleep: (raw[11]! >> 1) & 0x07,
    onTimer: reverseBits(onLsb & 0xFFFF, 16),
    offTimer: reverseBits(offLsb & 0xFFFF, 16),
  };
}
