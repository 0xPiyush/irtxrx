/**
 * Haier HSU07-HEA03 A/C IR protocol encoder and decoder. (HAIER_AC)
 *
 * Ported from IRremoteESP8266 `ir_Haier.cpp` (the `IRHaierAC` class).
 * A 9-byte, command-oriented protocol: each message carries a `command`
 * (which button was pressed) plus the full settings — temperature, mode, fan,
 * vertical swing, health, sleep, a wall clock, and on/off timers. The final
 * byte is a byte-sum checksum.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/404
 */

import { encodeHaier, decodeHaierBytes, haierSum } from "./haier_common.js";

const STATE_LENGTH = 9;
const PREFIX = 0b10100101;
const TEMP_MIN = 16;
const TEMP_MAX = 30;
const MAX_TIME = 23 * 60 + 59;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const HaierAcCommand = {
  Off: 0b0000,
  On: 0b0001,
  Mode: 0b0010,
  Fan: 0b0011,
  TempUp: 0b0110,
  TempDown: 0b0111,
  Sleep: 0b1000,
  TimerSet: 0b1001,
  TimerCancel: 0b1010,
  Health: 0b1100,
  Swing: 0b1101,
} as const;
export type HaierAcCommandValue = (typeof HaierAcCommand)[keyof typeof HaierAcCommand];

export const HaierAcMode = {
  Auto: 0,
  Cool: 1,
  Dry: 2,
  Heat: 3,
  Fan: 4,
} as const;
export type HaierAcModeValue = (typeof HaierAcMode)[keyof typeof HaierAcMode];

export const HaierAcFan = {
  Auto: 0,
  Low: 1,
  Med: 2,
  High: 3,
} as const;
export type HaierAcFanValue = (typeof HaierAcFan)[keyof typeof HaierAcFan];

export const HaierAcSwingV = {
  Off: 0b00,
  Up: 0b01,
  Down: 0b10,
  Chg: 0b11,
} as const;
export type HaierAcSwingVValue = (typeof HaierAcSwingV)[keyof typeof HaierAcSwingV];

// The Fan field is stored "inverted" on the wire (1=High … 3=Low, 0=Auto).
const FAN_TO_RAW: Record<number, number> = { 0: 0, 1: 3, 2: 2, 3: 1 };
const RAW_TO_FAN: Record<number, number> = { 0: 0, 1: 3, 2: 2, 3: 1 };

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface HaierAcState {
  /** Which button the message represents. */
  command?: HaierAcCommandValue;
  /** Power on/off. When `command` is omitted, `power: false` sends the Off
   *  button and `power: true` (or unset) sends On. On decode, reflects whether
   *  the frame's command is anything other than Off. */
  power?: boolean;
  /** Temperature in °C (16–30). */
  temp?: number;
  mode?: HaierAcModeValue;
  fan?: HaierAcFanValue;
  swingV?: HaierAcSwingVValue;
  health?: boolean;
  sleep?: boolean;
  /** Wall clock, minutes past midnight (0–1439). */
  currTime?: number;
  /** On-timer in minutes past midnight, or -1/undefined when disabled. */
  onTimer?: number;
  /** Off-timer in minutes past midnight, or -1/undefined when disabled. */
  offTimer?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ---------------------------------------------------------------------------
// Build raw 9-byte state
// ---------------------------------------------------------------------------

/** Build the raw 9-byte Haier state from a state object. */
export function buildHaierAcRaw(state: HaierAcState): Uint8Array {
  const raw = new Uint8Array(STATE_LENGTH);
  raw[0] = PREFIX;

  const command = state.command ??
    (state.power === false ? HaierAcCommand.Off : HaierAcCommand.On);
  const temp = clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_MIN;
  raw[1] = (command & 0x0f) | ((temp & 0x0f) << 4);

  const curr = clamp(state.currTime ?? 0, 0, MAX_TIME);
  const currHours = Math.trunc(curr / 60);
  const currMins = curr % 60;
  const swingV = state.swingV ?? HaierAcSwingV.Off;
  // Byte 2: CurrHours:5, unknown:1 (=1), SwingV:2
  raw[2] = (currHours & 0x1f) | (1 << 5) | ((swingV & 0x03) << 6);

  const onTimerOn = (state.onTimer ?? -1) >= 0;
  const offTimerOn = (state.offTimer ?? -1) >= 0;
  // Byte 3: CurrMins:6, OffTimer:1, OnTimer:1
  raw[3] = (currMins & 0x3f) | ((offTimerOn ? 1 : 0) << 6) | ((onTimerOn ? 1 : 0) << 7);

  const off = offTimerOn ? clamp(state.offTimer!, 0, MAX_TIME) : 12 * 60; // default OffHours=12
  const offHours = Math.trunc(off / 60);
  const offMins = off % 60;
  // Byte 4: OffHours:5, Health:1, (pad)
  raw[4] = (offHours & 0x1f) | ((state.health ? 1 : 0) << 5);
  // Byte 5: OffMins:6, Fan:2
  raw[5] = (offMins & 0x3f) | ((FAN_TO_RAW[state.fan ?? HaierAcFan.Auto]! & 0x03) << 6);

  const on = onTimerOn ? clamp(state.onTimer!, 0, MAX_TIME) : 0;
  const onHours = Math.trunc(on / 60);
  const onMins = on % 60;
  // Byte 6: OnHours:5, Mode:3
  raw[6] = (onHours & 0x1f) | (((state.mode ?? HaierAcMode.Auto) & 0x07) << 5);
  // Byte 7: OnMins:6, Sleep:1, (pad)
  raw[7] = (onMins & 0x3f) | ((state.sleep ? 1 : 0) << 6);

  raw[8] = haierSum(raw, 0, STATE_LENGTH - 1);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw Haier 9-byte payload into IR timings. */
export function encodeHaierAcRaw(data: Uint8Array, repeat: number = 0): number[] {
  return encodeHaier(data, repeat);
}

/** Encode a Haier A/C state into raw IR timings. */
export function sendHaierAc(state: HaierAcState, repeat: number = 0): number[] {
  return encodeHaier(buildHaierAcRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 9-byte Haier state into a state object. */
export function parseHaierAcState(raw: Uint8Array): HaierAcState {
  const onTimerOn = !!((raw[3]! >> 7) & 1);
  const offTimerOn = !!((raw[3]! >> 6) & 1);
  const onHours = raw[6]! & 0x1f;
  const onMins = raw[7]! & 0x3f;
  const offHours = raw[4]! & 0x1f;
  const offMins = raw[5]! & 0x3f;
  return {
    command: (raw[1]! & 0x0f) as HaierAcCommandValue,
    power: (raw[1]! & 0x0f) !== HaierAcCommand.Off,
    temp: ((raw[1]! >> 4) & 0x0f) + TEMP_MIN,
    mode: ((raw[6]! >> 5) & 0x07) as HaierAcModeValue,
    fan: (RAW_TO_FAN[(raw[5]! >> 6) & 0x03] ?? 0) as HaierAcFanValue,
    swingV: ((raw[2]! >> 6) & 0x03) as HaierAcSwingVValue,
    health: !!((raw[4]! >> 5) & 1),
    sleep: !!((raw[7]! >> 6) & 1),
    currTime: (raw[2]! & 0x1f) * 60 + (raw[3]! & 0x3f),
    onTimer: onTimerOn ? onHours * 60 + onMins : -1,
    offTimer: offTimerOn ? offHours * 60 + offMins : -1,
  };
}

/**
 * Decode raw IR timings as a Haier 9-byte message.
 *
 * Validates the 0xA5 prefix and the byte-sum checksum.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeHaierAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): HaierAcState | null {
  const raw = decodeHaierBytes(timings, offset, STATE_LENGTH, headerOptional);
  if (!raw) return null;
  if (raw[0] !== PREFIX) return null;
  if (raw[8] !== haierSum(raw, 0, STATE_LENGTH - 1)) return null;
  return parseHaierAcState(raw);
}
