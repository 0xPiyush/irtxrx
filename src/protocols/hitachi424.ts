/**
 * Hitachi 424-bit (53-byte) A/C protocol encoder and decoder. (HITACHI_AC424)
 *
 * Ported from IRremoteESP8266 `ir_Hitachi.cpp` / `ir_Hitachi.h`.
 * Models: RAR-8P2 remote / RAS-AJ25H A/C.
 *
 * Wire format: a long leader (29784/49290) precedes a 3416/1604 header, then
 * 53 bytes LSB-first + footer. Integrity is by byte-pair inversion: every
 * second byte from offset 3 onward is the bitwise inverse of the byte before
 * it. The message also carries a "button" byte recording the last key pressed.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/973
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes, matchMark, matchSpace } from "../decode.js";
import {
  HITACHI_AC424_LDR_MARK,
  HITACHI_AC424_LDR_SPACE,
  HITACHI_AC424_HDR_MARK,
  HITACHI_AC424_HDR_SPACE,
  HITACHI_AC424_BIT_MARK,
  HITACHI_AC424_ONE_SPACE,
  HITACHI_AC424_ZERO_SPACE,
  HITACHI_MIN_GAP,
  invertBytePairs,
  checkInvertedBytePairs,
} from "./hitachi_common.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_LENGTH = 53;
const MIN_TEMP = 16;
const MAX_TEMP = 32;
const FAN_TEMP = 27;

export const HitachiAc424Mode = {
  Fan: 1,
  Cool: 3,
  Dry: 5,
  Heat: 6,
} as const;

export type HitachiAc424ModeValue = (typeof HitachiAc424Mode)[keyof typeof HitachiAc424Mode];

export const HitachiAc424Fan = {
  Min: 1,
  Low: 2,
  Medium: 3,
  High: 4,
  Auto: 5,
  Max: 6,
} as const;

export type HitachiAc424FanValue = (typeof HitachiAc424Fan)[keyof typeof HitachiAc424Fan];

const FAN_MAX_DRY = 2;

export const HitachiAc424Button = {
  PowerMode: 0x13,
  Fan: 0x42,
  TempDown: 0x43,
  TempUp: 0x44,
  SwingV: 0x81,
  SwingH: 0x8C,
} as const;

/** Fixed known-good template from `IRHitachiAc424::stateReset` (pre-setters). */
const TEMPLATE: readonly number[] = (() => {
  const t = new Array(STATE_LENGTH).fill(0);
  t[0] = 0x01; t[1] = 0x10; t[3] = 0x40; t[5] = 0xFF; t[7] = 0xCC;
  t[27] = 0xE1; t[33] = 0x80; t[35] = 0x03; t[37] = 0x01; t[39] = 0x88;
  t[45] = 0xFF; t[47] = 0xFF; t[49] = 0xFF; t[51] = 0xFF;
  return t;
})();

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface HitachiAc424State {
  power?: boolean;
  /** Temperature in °C (16–32). Forced to 27°C in Fan mode. */
  temp?: number;
  mode?: HitachiAc424ModeValue;
  fan?: HitachiAc424FanValue;
  /** Vertical-swing toggle (the remote sends the swing button, not a state). */
  swingVToggle?: boolean;
}

// ---------------------------------------------------------------------------
// Build raw byte array — emulates the IRHitachiAc424 setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 53-byte HITACHI_AC424 state from a state object.
 *
 * Emulates `stateReset()` + the C++ setter order (mode → temp → fan → power →
 * swing-toggle). The trailing setter determines the recorded "button" byte:
 * with `swingVToggle` it becomes SwingV, otherwise PowerMode (from setPower).
 * Byte-pair inversion is applied last, exactly like `getRaw()`.
 */
export function buildHitachiAc424Raw(state: HitachiAc424State): Uint8Array {
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
      newSpeed = HitachiAc424Fan.Min;  // Fan mode has no Auto.
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
      case HitachiAc424Mode.Fan: setTemp(FAN_TEMP, false); break;
      case HitachiAc424Mode.Heat:
      case HitachiAc424Mode.Cool:
      case HitachiAc424Mode.Dry: break;
      default: newMode = HitachiAc424Mode.Cool;
    }
    raw[25] = (raw[25]! & 0xF0) | (newMode & 0x0F);
    if (newMode !== HitachiAc424Mode.Fan) setTemp(previousTemp);
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

  // stateReset() sequence.
  setTemp(23);
  setPower(true);
  setMode(HitachiAc424Mode.Cool);
  setFan(HitachiAc424Fan.Auto);

  // User-requested settings. setTemp is always applied (in Fan mode it simply
  // overrides the special temp that setMode installed).
  setMode((state.mode ?? HitachiAc424Mode.Cool) as number);
  setTemp(state.temp ?? previousTemp);
  setFan((state.fan ?? HitachiAc424Fan.Auto) as number);
  setPower(state.power ?? true);
  setSwingVToggle(state.swingVToggle ?? false);

  invertBytePairs(raw, 3, STATE_LENGTH - 3);
  return raw;
}

// ---------------------------------------------------------------------------
// Public encode API
// ---------------------------------------------------------------------------

/**
 * Encode a raw 53-byte HITACHI_AC424 state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendHitachiAc424`: a leader pulse precedes
 * the header + data + footer of each repeat.
 */
export function encodeHitachiAc424Raw(data: Uint8Array, repeat: number = 0): number[] {
  const result: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    result.push(HITACHI_AC424_LDR_MARK, HITACHI_AC424_LDR_SPACE);
    const frame = sendGenericBytes({
      headerMark: HITACHI_AC424_HDR_MARK,
      headerSpace: HITACHI_AC424_HDR_SPACE,
      oneMark: HITACHI_AC424_BIT_MARK,
      oneSpace: HITACHI_AC424_ONE_SPACE,
      zeroMark: HITACHI_AC424_BIT_MARK,
      zeroSpace: HITACHI_AC424_ZERO_SPACE,
      footerMark: HITACHI_AC424_BIT_MARK,
      gap: HITACHI_MIN_GAP,
      data,
      msbFirst: false,
    });
    for (let i = 0; i < frame.length; i++) result.push(frame[i]!);
  }
  return result;
}

/** Encode a HITACHI_AC424 state into raw IR timings. */
export function sendHitachiAc424(state: HitachiAc424State, repeat: number = 0): number[] {
  return encodeHitachiAc424Raw(buildHitachiAc424Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Consume the AC424 leader if present; returns the new offset. */
function skipLeader(timings: number[], offset: number): number {
  if (offset + 1 < timings.length &&
      matchMark(timings[offset]!, HITACHI_AC424_LDR_MARK) &&
      matchSpace(timings[offset + 1]!, HITACHI_AC424_LDR_SPACE)) {
    return offset + 2;
  }
  return offset;
}

/**
 * Decode raw IR timings as a HITACHI_AC424 message.
 *
 * The leader and header are both optional (hardware captures may clip them).
 * Byte-pair inversion is validated to reject false matches — note this is
 * stricter than the C++ decoder, which performs no compliance check.
 *
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeHitachiAc424(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): HitachiAc424State | null {
  const pos = skipLeader(timings, offset);

  const frame = matchGenericBytes(
    timings, pos, timings.length - pos, STATE_LENGTH,
    HITACHI_AC424_HDR_MARK, HITACHI_AC424_HDR_SPACE,
    HITACHI_AC424_BIT_MARK, HITACHI_AC424_ONE_SPACE,
    HITACHI_AC424_BIT_MARK, HITACHI_AC424_ZERO_SPACE,
    HITACHI_AC424_BIT_MARK, HITACHI_MIN_GAP,
    // C++ decodeHitachiAc424 pins mark-excess to 0 (not the global 50µs).
    true, undefined, 0, false,
    headerOptional,
  );
  if (!frame) return null;

  const raw = frame.data;
  if (!checkInvertedBytePairs(raw, 3, STATE_LENGTH - 3)) return null;

  return {
    power: !!(raw[27]! & 0x10),
    temp: (raw[13]! >> 2) & 0x3F,
    mode: (raw[25]! & 0x0F) as HitachiAc424ModeValue,
    fan: ((raw[25]! >> 4) & 0x0F) as HitachiAc424FanValue,
    swingVToggle: raw[11]! === HitachiAc424Button.SwingV,
  };
}
