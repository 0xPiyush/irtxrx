/**
 * Hitachi 224-bit (28-byte) A/C protocol encoder and decoder. (HITACHI_AC)
 *
 * Ported from IRremoteESP8266 `ir_Hitachi.cpp` / `ir_Hitachi.h`.
 *
 * Wire format: header + 28 bytes (MSB-first) + footer. Field values are stored
 * bit-reversed within their byte (the C++ class uses `reverseBits` everywhere),
 * and the message is protected by a subtractive byte-sum checksum in byte 27.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/417
 */

import { reverseBits, sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";
import {
  HITACHI_HDR_MARK,
  HITACHI_HDR_SPACE,
  HITACHI_BIT_MARK,
  HITACHI_ONE_SPACE,
  HITACHI_ZERO_SPACE,
  HITACHI_MIN_GAP,
  HITACHI_BASE_TOLERANCE,
} from "./hitachi_common.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_LENGTH = 28;
const MIN_TEMP = 16;
const MAX_TEMP = 32;
/** Special temperature value used internally for Fan mode. */
const FAN_TEMP = 64;

export const HitachiAcMode = {
  Auto: 2,
  Heat: 3,
  Cool: 4,
  Dry: 5,
  Fan: 0xC,
} as const;

export type HitachiAcModeValue = (typeof HitachiAcMode)[keyof typeof HitachiAcMode];

export const HitachiAcFan = {
  Auto: 1,
  Low: 2,
  Med: 3,
  High: 5,
} as const;

export type HitachiAcFanValue = (typeof HitachiAcFan)[keyof typeof HitachiAcFan];

/** Fixed known-good template from `IRHitachiAc::stateReset` (before setTemp). */
const TEMPLATE: readonly number[] = [
  0x80, 0x08, 0x0C, 0x02, 0xFD, 0x80, 0x7F, 0x88, 0x48, 0x10,
  0x00, 0x00, 0x00, 0x00, 0x60, 0x60, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00,
];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface HitachiAcState {
  power?: boolean;
  /** Temperature in °C (16–32). Ignored in Fan mode (forced to a special value). */
  temp?: number;
  mode?: HitachiAcModeValue;
  fan?: HitachiAcFanValue;
  swingV?: boolean;
  swingH?: boolean;
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

/** Matches `IRHitachiAc::calcChecksum`: 62 − Σ reverseBits(byte), reversed. */
function calcChecksum(raw: Uint8Array, length: number = STATE_LENGTH): number {
  let sum = 62;
  for (let i = 0; i < length - 1; i++) sum = (sum - reverseBits(raw[i]!, 8)) & 0xFF;
  return reverseBits(sum, 8);
}

// ---------------------------------------------------------------------------
// Build raw byte array — faithfully emulates the IRHitachiAc setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 28-byte HITACHI_AC state from a state object.
 *
 * Emulates `stateReset()` followed by the setter order used by the C++ class
 * (mode → temp → fan → swing → power) so the output matches byte-for-byte.
 */
export function buildHitachiAcRaw(state: HitachiAcState): Uint8Array {
  const raw = Uint8Array.from(TEMPLATE);
  let previousTemp = 23;

  const getMode = (): number => reverseBits(raw[10]!, 8);
  const getFan = (): number => reverseBits(raw[13]!, 8);

  const setTemp = (celsius: number): void => {
    if (celsius !== FAN_TEMP) previousTemp = celsius;
    const temp = celsius === FAN_TEMP
      ? FAN_TEMP
      : Math.min(Math.max(celsius, MIN_TEMP), MAX_TEMP);
    raw[11] = reverseBits((temp << 1) & 0xFF, 8);
    raw[9] = temp === MIN_TEMP ? 0x90 : 0x10;
  };

  const setFan = (speed: number): void => {
    let fanmin: number = HitachiAcFan.Auto;
    let fanmax: number = HitachiAcFan.High;
    switch (getMode()) {
      case HitachiAcMode.Dry:  // Only 2 low speeds in Dry mode.
        fanmin = HitachiAcFan.Low;
        fanmax = HitachiAcFan.Low + 1;
        break;
      case HitachiAcMode.Fan:
        fanmin = HitachiAcFan.Low;  // No Auto in Fan mode.
        break;
    }
    const newspeed = Math.min(Math.max(speed, fanmin), fanmax);
    raw[13] = reverseBits(newspeed, 8);
  };

  const setMode = (mode: number): void => {
    let newmode = mode;
    switch (mode) {
      case HitachiAcMode.Fan: setTemp(FAN_TEMP); break;
      case HitachiAcMode.Auto:
      case HitachiAcMode.Heat:
      case HitachiAcMode.Cool:
      case HitachiAcMode.Dry: break;
      default: newmode = HitachiAcMode.Auto;
    }
    raw[10] = reverseBits(newmode, 8);
    if (mode !== HitachiAcMode.Fan) setTemp(previousTemp);
    setFan(getFan());  // Re-clamp the fan speed after the mode change.
  };

  // stateReset() ends with setTemp(23).
  setTemp(23);

  const mode = (state.mode ?? HitachiAcMode.Cool) as number;
  setMode(mode);
  if (mode !== HitachiAcMode.Fan) setTemp(state.temp ?? previousTemp);
  setFan((state.fan ?? HitachiAcFan.Auto) as number);

  if (state.swingV) raw[14] = raw[14]! | 0x80; else raw[14] = raw[14]! & 0x7F;
  if (state.swingH) raw[15] = raw[15]! | 0x80; else raw[15] = raw[15]! & 0x7F;
  if (state.power ?? true) raw[17] = raw[17]! | 0x01; else raw[17] = raw[17]! & 0xFE;

  raw[27] = calcChecksum(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// Public encode API
// ---------------------------------------------------------------------------

/**
 * Encode a raw 28-byte HITACHI_AC state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendHitachiAC`.
 */
export function encodeHitachiAcRaw(data: Uint8Array, repeat: number = 0): number[] {
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
    msbFirst: true,
    repeat,
  });
}

/** Encode a HITACHI_AC state into raw IR timings. */
export function sendHitachiAc(state: HitachiAcState, repeat: number = 0): number[] {
  return encodeHitachiAcRaw(buildHitachiAcRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a HITACHI_AC message.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @param headerOptional Allow a missing header (hardware captures often clip it).
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeHitachiAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): HitachiAcState | null {
  const frame = matchGenericBytes(
    timings, offset, timings.length - offset, STATE_LENGTH,
    HITACHI_HDR_MARK, HITACHI_HDR_SPACE,
    HITACHI_BIT_MARK, HITACHI_ONE_SPACE,
    HITACHI_BIT_MARK, HITACHI_ZERO_SPACE,
    HITACHI_BIT_MARK, HITACHI_MIN_GAP,
    true, HITACHI_BASE_TOLERANCE, undefined, true,
    headerOptional,
  );
  if (!frame) return null;

  const raw = frame.data;
  if (raw[27] !== calcChecksum(raw)) return null;

  return {
    power: !!(raw[17]! & 0x01),
    temp: reverseBits(raw[11]!, 8) >> 1,
    mode: reverseBits(raw[10]!, 8) as HitachiAcModeValue,
    fan: reverseBits(raw[13]!, 8) as HitachiAcFanValue,
    swingV: !!(raw[14]! & 0x80),
    swingH: !!(raw[15]! & 0x80),
  };
}
