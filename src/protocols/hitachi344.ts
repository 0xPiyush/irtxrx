/**
 * Hitachi 344-bit (43-byte) A/C protocol encoder and decoder. (HITACHI_AC344)
 *
 * Ported from IRremoteESP8266 `ir_Hitachi.cpp` / `ir_Hitachi.h`.
 * Models: RAS-22NK A/C / RF11T1 remote.
 *
 * Another AC424 sibling: same byte layout, fan handling, and byte-pair
 * inversion, sent with base framing (3300/1700, no leader, LSB-first). Adds a
 * persistent vertical-swing bit (byte 37) and a horizontal-swing position
 * (byte 35). The internal buffer is the full 53-byte AC424 size; only the
 * first 43 bytes are transmitted.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1134
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
import { HitachiAc424Mode, HitachiAc424Fan, HitachiAc424Button } from "./hitachi424.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUFFER_LENGTH = 53;
const STATE_LENGTH = 43;
const MIN_TEMP = 16;
const MAX_TEMP = 32;
const FAN_TEMP = 27;
const FAN_MAX_DRY = 2;

/** Modes and fan speeds are shared with AC424. */
export const HitachiAc344Mode = HitachiAc424Mode;
export type HitachiAc344ModeValue = (typeof HitachiAc344Mode)[keyof typeof HitachiAc344Mode];
export const HitachiAc344Fan = HitachiAc424Fan;
export type HitachiAc344FanValue = (typeof HitachiAc344Fan)[keyof typeof HitachiAc344Fan];

export const HitachiAc344SwingH = {
  Auto: 0,
  RightMax: 1,
  Right: 2,
  Middle: 3,
  Left: 4,
  LeftMax: 5,
} as const;

export type HitachiAc344SwingHValue = (typeof HitachiAc344SwingH)[keyof typeof HitachiAc344SwingH];

const TEMPLATE: readonly number[] = (() => {
  const t = new Array(BUFFER_LENGTH).fill(0);
  t[0] = 0x01; t[1] = 0x10; t[3] = 0x40; t[5] = 0xFF; t[7] = 0xCC;
  t[27] = 0xE1; t[33] = 0x80; t[35] = 0x03; t[37] = 0x01; t[39] = 0x88;
  t[45] = 0xFF; t[47] = 0xFF; t[49] = 0xFF; t[51] = 0xFF;
  return t;
})();

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface HitachiAc344State {
  power?: boolean;
  /** Temperature in °C (16–32). Forced to 27°C in Fan mode. */
  temp?: number;
  mode?: HitachiAc344ModeValue;
  fan?: HitachiAc344FanValue;
  /** Persistent vertical swing. */
  swingV?: boolean;
  /** Horizontal swing position. */
  swingH?: HitachiAc344SwingHValue;
}

// ---------------------------------------------------------------------------
// Build raw byte array — emulates the IRHitachiAc344 setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 43-byte HITACHI_AC344 state from a state object.
 *
 * Emulates `stateReset()` (AC424 reset + zeroing bytes 37 & 39) and the C++
 * setter order, ending with `setPower` so the recorded button is PowerMode.
 */
export function buildHitachiAc344Raw(state: HitachiAc344State): Uint8Array {
  const raw = Uint8Array.from(TEMPLATE);
  let previousTemp = 0;

  const setButton = (b: number): void => { raw[11] = b; };
  const getMode = (): number => raw[25]! & 0x0F;
  const getFan = (): number => (raw[25]! >> 4) & 0x0F;
  const setFanField = (f: number): void => { raw[25] = (raw[25]! & 0x0F) | ((f & 0x0F) << 4); };

  const setTemp = (celsius: number, setPrevious: boolean = true): void => {
    const temp = Math.min(Math.max(celsius, MIN_TEMP), MAX_TEMP);
    raw[13] = (raw[13]! & 0x03) | (temp << 2);
    if (previousTemp > temp) setButton(HitachiAc424Button.TempDown);
    else if (previousTemp < temp) setButton(HitachiAc424Button.TempUp);
    if (setPrevious) previousTemp = temp;
  };

  const setFan = (speed: number): void => {
    let newSpeed = Math.max(speed, HitachiAc424Fan.Min);
    let fanMax: number = HitachiAc424Fan.Max;
    if (getMode() === HitachiAc424Mode.Dry && speed === HitachiAc424Fan.Auto) {
      fanMax = HitachiAc424Fan.Auto;
    } else if (getMode() === HitachiAc424Mode.Dry) {
      fanMax = FAN_MAX_DRY;
    } else if (getMode() === HitachiAc424Mode.Fan && speed === HitachiAc424Fan.Auto) {
      newSpeed = HitachiAc424Fan.Min;
    }
    newSpeed = Math.min(newSpeed, fanMax);
    if (newSpeed !== getFan()) setButton(HitachiAc424Button.Fan);
    setFanField(newSpeed);
    raw[9] = 0x92;
    raw[29] = 0x00;
    if (newSpeed === HitachiAc424Fan.Min) raw[9] = 0x98;
    if (newSpeed === HitachiAc424Fan.Max) { raw[9] = 0xA9; raw[29] = 0x30; }
  };

  const setMode = (mode: number): void => {
    let newMode = mode;
    switch (mode) {
      case HitachiAc344Mode.Fan: setTemp(FAN_TEMP, false); break;
      case HitachiAc344Mode.Heat:
      case HitachiAc344Mode.Cool:
      case HitachiAc344Mode.Dry: break;
      default: newMode = HitachiAc344Mode.Cool;
    }
    raw[25] = (raw[25]! & 0xF0) | (newMode & 0x0F);
    if (newMode !== HitachiAc344Mode.Fan) setTemp(previousTemp);
    setFan(getFan());
    setButton(HitachiAc424Button.PowerMode);
  };

  const setPower = (on: boolean): void => {
    if (on) raw[27] = raw[27]! | 0x10; else raw[27] = raw[27]! & ~0x10;
    setButton(HitachiAc424Button.PowerMode);
  };

  const setSwingV = (on: boolean): void => {
    // setSwingVToggle: records the button, then SwingV bit (byte 37, bit 5).
    setButton(HitachiAc424Button.SwingV);
    if (on) raw[37] = raw[37]! | (1 << 5); else raw[37] = raw[37]! & ~(1 << 5);
  };

  const setSwingH = (position: number): void => {
    const pos = position > HitachiAc344SwingH.LeftMax ? HitachiAc344SwingH.Middle : position;
    raw[35] = (raw[35]! & ~0x07) | (pos & 0x07);
    setButton(HitachiAc424Button.SwingH);
  };

  // stateReset(): AC424 reset then AC344-specific overrides.
  setTemp(23);
  setPower(true);
  setMode(HitachiAc344Mode.Cool);
  setFan(HitachiAc424Fan.Auto);
  raw[37] = 0x00;
  raw[39] = 0x00;

  // User-requested settings (setPower last → button = PowerMode).
  setMode((state.mode ?? HitachiAc344Mode.Cool) as number);
  setTemp(state.temp ?? previousTemp);
  setFan((state.fan ?? HitachiAc424Fan.Auto) as number);
  setSwingV(state.swingV ?? false);
  setSwingH((state.swingH ?? HitachiAc344SwingH.Auto) as number);
  setPower(state.power ?? true);

  invertBytePairs(raw, 3, BUFFER_LENGTH - 3);
  return raw.slice(0, STATE_LENGTH);
}

// ---------------------------------------------------------------------------
// Public encode API
// ---------------------------------------------------------------------------

/**
 * Encode a raw 43-byte HITACHI_AC344 state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendHitachiAc344` (base framing, LSB-first).
 */
export function encodeHitachiAc344Raw(data: Uint8Array, repeat: number = 0): number[] {
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

/** Encode a HITACHI_AC344 state into raw IR timings. */
export function sendHitachiAc344(state: HitachiAc344State, repeat: number = 0): number[] {
  return encodeHitachiAc344Raw(buildHitachiAc344Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a HITACHI_AC344 message.
 *
 * Validates byte-pair inversion over the transmitted bytes (3–42).
 *
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeHitachiAc344(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): HitachiAc344State | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    HITACHI_HDR_MARK, HITACHI_HDR_SPACE,
    HITACHI_BIT_MARK, HITACHI_ONE_SPACE,
    HITACHI_BIT_MARK, HITACHI_ZERO_SPACE,
    HITACHI_BIT_MARK, HITACHI_MIN_GAP,
    true, HITACHI_BASE_TOLERANCE, undefined, false,
    headerOptional,
  );
  if (!frame) return null;

  const raw = frame.data;
  if (!checkInvertedBytePairs(raw, 3, STATE_LENGTH - 3)) return null;

  return {
    power: !!(raw[27]! & 0x10),
    temp: (raw[13]! >> 2) & 0x3F,
    mode: (raw[25]! & 0x0F) as HitachiAc344ModeValue,
    fan: ((raw[25]! >> 4) & 0x0F) as HitachiAc344FanValue,
    swingV: !!(raw[37]! & (1 << 5)),
    swingH: (raw[35]! & 0x07) as HitachiAc344SwingHValue,
  };
}
