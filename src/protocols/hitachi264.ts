/**
 * Hitachi 264-bit (33-byte) A/C protocol encoder and decoder. (HITACHI_AC264)
 *
 * Ported from IRremoteESP8266 `ir_Hitachi.cpp` / `ir_Hitachi.h`.
 * Models: RAR-2P2 remote / RAK-25NH5 A/C.
 *
 * Structurally a smaller sibling of HITACHI_AC424: the same byte layout and
 * byte-pair-inversion integrity, but sent with the base framing (3300/1700
 * header, no leader, LSB-first) and a restricted fan set. Internally the C++
 * class keeps the full 53-byte AC424 buffer and transmits only the first 33
 * bytes, so we do the same.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1729
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
import { HitachiAc424Mode, HitachiAc424Button } from "./hitachi424.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Internal buffer is the full AC424 size; only the first 33 bytes are sent. */
const BUFFER_LENGTH = 53;
const STATE_LENGTH = 33;
const MIN_TEMP = 16;
const MAX_TEMP = 32;
const FAN_TEMP = 27;

/** Modes are shared with AC424 (Fan/Cool/Dry/Heat). */
export const HitachiAc264Mode = HitachiAc424Mode;
export type HitachiAc264ModeValue = (typeof HitachiAc264Mode)[keyof typeof HitachiAc264Mode];

export const HitachiAc264Fan = {
  Min: 1,
  Medium: 3,
  High: 4,
  Auto: 5,
} as const;

export type HitachiAc264FanValue = (typeof HitachiAc264Fan)[keyof typeof HitachiAc264Fan];

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

export interface HitachiAc264State {
  power?: boolean;
  /** Temperature in °C (16–32). Forced to 27°C in Fan mode. */
  temp?: number;
  mode?: HitachiAc264ModeValue;
  fan?: HitachiAc264FanValue;
  /** Vertical-swing toggle (records the swing button; AC264 has no swing state). */
  swingVToggle?: boolean;
}

// ---------------------------------------------------------------------------
// Build raw byte array — emulates the IRHitachiAc264 setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 33-byte HITACHI_AC264 state from a state object.
 *
 * Emulates `stateReset()` (AC424 reset + AC264 overrides of bytes 9 & 27)
 * followed by the C++ setter order. AC264's `setFan` only writes the fan nibble
 * — unlike AC424 it has no byte-9/29 side effects and never changes the button.
 */
export function buildHitachiAc264Raw(state: HitachiAc264State): Uint8Array {
  const raw = Uint8Array.from(TEMPLATE);
  let previousTemp = 0;

  const setButton = (b: number): void => { raw[11] = b; };
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
    switch (speed) {
      case HitachiAc264Fan.Min:
      case HitachiAc264Fan.Medium:
      case HitachiAc264Fan.High:
      case HitachiAc264Fan.Auto:
        setFanField(speed);
        break;
      default:
        setFanField(HitachiAc264Fan.Auto);
    }
  };

  const setMode = (mode: number): void => {
    let newMode = mode;
    switch (mode) {
      case HitachiAc264Mode.Fan: setTemp(FAN_TEMP, false); break;
      case HitachiAc264Mode.Heat:
      case HitachiAc264Mode.Cool:
      case HitachiAc264Mode.Dry: break;
      default: newMode = HitachiAc264Mode.Cool;
    }
    raw[25] = (raw[25]! & 0xF0) | (newMode & 0x0F);
    if (newMode !== HitachiAc264Mode.Fan) setTemp(previousTemp);
    setFan(getFan());
    setButton(HitachiAc424Button.PowerMode);
  };

  const setPower = (on: boolean): void => {
    if (on) raw[27] = raw[27]! | 0x10; else raw[27] = raw[27]! & ~0x10;
    setButton(HitachiAc424Button.PowerMode);
  };

  const setSwingVToggle = (on: boolean): void => {
    let button = raw[11]!;
    if (on) button = HitachiAc424Button.SwingV;
    else if (button === HitachiAc424Button.SwingV) button = HitachiAc424Button.PowerMode;
    setButton(button);
  };

  // stateReset(): AC424 reset then AC264-specific overrides.
  setTemp(23);
  setPower(true);
  setMode(HitachiAc264Mode.Cool);
  setFan(HitachiAc264Fan.Auto);
  raw[9] = 0x92;
  raw[27] = 0xC1;

  // User-requested settings.
  setMode((state.mode ?? HitachiAc264Mode.Cool) as number);
  setTemp(state.temp ?? previousTemp);
  setFan((state.fan ?? HitachiAc264Fan.Auto) as number);
  setPower(state.power ?? true);
  setSwingVToggle(state.swingVToggle ?? false);

  invertBytePairs(raw, 3, BUFFER_LENGTH - 3);
  return raw.slice(0, STATE_LENGTH);
}

// ---------------------------------------------------------------------------
// Public encode API
// ---------------------------------------------------------------------------

/**
 * Encode a raw 33-byte HITACHI_AC264 state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendHitachiAc264` (base framing, LSB-first).
 */
export function encodeHitachiAc264Raw(data: Uint8Array, repeat: number = 0): number[] {
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

/** Encode a HITACHI_AC264 state into raw IR timings. */
export function sendHitachiAc264(state: HitachiAc264State, repeat: number = 0): number[] {
  return encodeHitachiAc264Raw(buildHitachiAc264Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a HITACHI_AC264 message.
 *
 * Validates byte-pair inversion over the transmitted bytes (3–32).
 *
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeHitachiAc264(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): HitachiAc264State | null {
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
    mode: (raw[25]! & 0x0F) as HitachiAc264ModeValue,
    fan: ((raw[25]! >> 4) & 0x0F) as HitachiAc264FanValue,
    swingVToggle: raw[11]! === HitachiAc424Button.SwingV,
  };
}
