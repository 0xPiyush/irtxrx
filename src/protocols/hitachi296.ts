/**
 * Hitachi 296-bit (37-byte) A/C protocol encoder and decoder. (HITACHI_AC296)
 *
 * Ported from IRremoteESP8266 `ir_Hitachi.cpp` / `ir_Hitachi.h`.
 * Models: RAR-3U3 remote / RAS-70YHA3 A/C.
 *
 * Base framing (3300/1700, no leader, LSB-first) with byte-pair-inversion
 * integrity. The C++ class exposes only power/temp/mode/fan setters (humidity
 * and the timers are read-only here and stay at their reset values), so this
 * module mirrors that surface.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1757
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";
import {
  HITACHI_HDR_MARK,
  HITACHI_HDR_SPACE,
  HITACHI_BIT_MARK,
  HITACHI_ONE_SPACE,
  HITACHI_ZERO_SPACE,
  HITACHI_MIN_GAP,
  HITACHI_BASE_TOLERANCE,
  invertBytePairs,
  checkInvertedBytePairs,
} from "./hitachi_common.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_LENGTH = 37;
const TEMP_AUTO = 1;
const MIN_TEMP = 16;
const MAX_TEMP = 31;

export const HitachiAc296Mode = {
  Cool: 0b0011,
  DryCool: 0b0100,
  Dehumidify: 0b0101,
  Heat: 0b0110,
  Auto: 0b0111,
  AutoDehumidifying: 0b1001,
  QuickLaundry: 0b1010,
  CondensationControl: 0b1100,
} as const;

export type HitachiAc296ModeValue = (typeof HitachiAc296Mode)[keyof typeof HitachiAc296Mode];

export const HitachiAc296Fan = {
  Silent: 0b001,
  Low: 0b010,
  Medium: 0b011,
  High: 0b100,
  Auto: 0b101,
} as const;

export type HitachiAc296FanValue = (typeof HitachiAc296Fan)[keyof typeof HitachiAc296Fan];

const TEMPLATE: readonly number[] = (() => {
  const t = new Array(STATE_LENGTH).fill(0);
  t[0] = 0x01; t[1] = 0x10; t[3] = 0x40; t[5] = 0xFF; t[7] = 0xCC;
  t[9] = 0x92; t[11] = 0x43; t[27] = 0xF1; t[35] = 0x03;
  return t;
})();

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface HitachiAc296State {
  power?: boolean;
  /** Temperature in °C (16–31). Forced to a special value in Auto mode. */
  temp?: number;
  mode?: HitachiAc296ModeValue;
  fan?: HitachiAc296FanValue;
}

// ---------------------------------------------------------------------------
// Build raw byte array — emulates the IRHitachiAc296 setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 37-byte HITACHI_AC296 state from a state object.
 *
 * Emulates `stateReset()` (temp 24, Heat, fan Auto) then the C++ setter order,
 * applying byte-pair inversion last. Modes outside the accepted set fall back
 * to Auto, and Auto mode forces the special temperature value.
 */
export function buildHitachiAc296Raw(state: HitachiAc296State): Uint8Array {
  const raw = Uint8Array.from(TEMPLATE);

  const getMode = (): number => raw[25]! & 0x0F;
  const getTemp = (): number => (raw[13]! >> 2) & 0x1F;

  const setTemp = (celsius: number): void => {
    const temp = getMode() === HitachiAc296Mode.Auto
      ? TEMP_AUTO
      : Math.min(Math.max(celsius, MIN_TEMP), MAX_TEMP);
    raw[13] = (raw[13]! & ~(0x1F << 2)) | ((temp & 0x1F) << 2);
  };

  const setMode = (mode: number): void => {
    switch (mode) {
      case HitachiAc296Mode.Heat:
      case HitachiAc296Mode.Cool:
      case HitachiAc296Mode.Dehumidify:
      case HitachiAc296Mode.AutoDehumidifying:
      case HitachiAc296Mode.Auto:
        raw[25] = (raw[25]! & 0xF0) | (mode & 0x0F);
        setTemp(getTemp());  // Re-apply to honour Auto's special temp.
        break;
      default:
        setMode(HitachiAc296Mode.Auto);
    }
  };

  const setFan = (speed: number): void => {
    const newSpeed = Math.min(Math.max(speed, HitachiAc296Fan.Silent), HitachiAc296Fan.Auto);
    raw[25] = (raw[25]! & ~(0x07 << 4)) | ((newSpeed & 0x07) << 4);
  };

  // stateReset().
  setTemp(24);
  setMode(HitachiAc296Mode.Heat);
  setFan(HitachiAc296Fan.Auto);

  // User-requested settings.
  setMode((state.mode ?? HitachiAc296Mode.Heat) as number);
  setTemp(state.temp ?? getTemp());
  setFan((state.fan ?? HitachiAc296Fan.Auto) as number);
  if (state.power ?? true) raw[27] = raw[27]! | 0x10; else raw[27] = raw[27]! & ~0x10;

  invertBytePairs(raw, 3, STATE_LENGTH - 3);
  return raw;
}

// ---------------------------------------------------------------------------
// Public encode API
// ---------------------------------------------------------------------------

/**
 * Encode a raw 37-byte HITACHI_AC296 state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendHitachiAc296` (base framing, LSB-first).
 */
export function encodeHitachiAc296Raw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HITACHI_HDR_MARK,
    headerSpace: HITACHI_HDR_SPACE,
    oneMark: HITACHI_BIT_MARK,
    oneSpace: HITACHI_ONE_SPACE,
    zeroMark: HITACHI_BIT_MARK,
    zeroSpace: HITACHI_ZERO_SPACE,
    footerMark: HITACHI_BIT_MARK,
    gap: HITACHI_MIN_GAP,
    data,
    msbFirst: false,
    repeat,
  });
}

/** Encode a HITACHI_AC296 state into raw IR timings. */
export function sendHitachiAc296(state: HitachiAc296State, repeat: number = 0): number[] {
  return encodeHitachiAc296Raw(buildHitachiAc296Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a HITACHI_AC296 message.
 *
 * Validates byte-pair inversion over bytes 3–36.
 *
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeHitachiAc296(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): HitachiAc296State | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    HITACHI_HDR_MARK, HITACHI_HDR_SPACE,
    HITACHI_BIT_MARK, HITACHI_ONE_SPACE,
    HITACHI_BIT_MARK, HITACHI_ZERO_SPACE,
    HITACHI_BIT_MARK, HITACHI_MIN_GAP,
    // C++ decodeHitachiAc296 pins mark-excess to 0. We widen the tolerance from
    // the C++ default (25%) to the Hitachi family's 30% — real AR-RCL-style
    // remotes send 0-bit spaces (~366µs) just under the 25% floor of the
    // nominal 500µs zero-space. Nominal frames still decode identically.
    true, HITACHI_BASE_TOLERANCE, 0, false,
    headerOptional,
  );
  if (!frame) return null;

  const raw = frame.data;
  if (!checkInvertedBytePairs(raw, 3, STATE_LENGTH - 3)) return null;

  return {
    power: !!(raw[27]! & 0x10),
    temp: (raw[13]! >> 2) & 0x1F,
    mode: (raw[25]! & 0x0F) as HitachiAc296ModeValue,
    fan: ((raw[25]! >> 4) & 0x07) as HitachiAc296FanValue,
  };
}
