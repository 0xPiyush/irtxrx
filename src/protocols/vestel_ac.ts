/**
 * Vestel A/C IR protocol encoder and decoder. (VESTEL_AC)
 *
 * Ported from IRremoteESP8266 `ir_Vestel.cpp` / `ir_Vestel.h` — full coverage of
 * the `IRVestelAc` class and the `sendVestelAc` / `decodeVestelAc` wire format.
 * Models: Vestel BIOX CXP-9 and the many Vestel-OEM rebadges.
 *
 * Wire format: a single 56-bit value sent LSB-first (3110/9066 header). The
 * remote emits **two message variants** sharing the wire layout, distinguished
 * by the `UseCmd` bit:
 *   - **Command** — power/mode/temp/fan/swing/ion/sleep/turbo.
 *   - **Time** — the unit's clock plus On/Off/sleep-style timers.
 * Bits 12–19 hold a checksum: `0xFF − (popcount(bits 20–63) + 2)`.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Vestel.cpp
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric, kMarkExcess } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Vestel.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3110;
const HDR_SPACE = 9066;
const BIT_MARK = 520;
const ONE_SPACE = 1535;
const ZERO_SPACE = 480;
const MESSAGE_GAP = 100000;
const TOLERANCE = 30; // kVestelAcTolerance

export const VESTEL_AC_BITS = 56;
const MASK = (1n << 56n) - 1n;

/** Default command state (Power On, Mode Auto, Fan Auto, 25°C). */
const CMD_DEFAULT = 0x0f00d9001fef201n;
/** Default time state (signature only). */
const TIME_DEFAULT = 0x201n;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const VestelAcMode = {
  Auto: 0,
  Cool: 1,
  Dry: 2,
  Fan: 3,
  Heat: 4,
} as const;
export type VestelAcModeValue = (typeof VestelAcMode)[keyof typeof VestelAcMode];

export const VestelAcFan = {
  Auto: 1,
  Low: 5,
  Med: 9,
  High: 0xb,
  AutoCool: 0xc,
  AutoHot: 0xd,
} as const;
export type VestelAcFanValue = (typeof VestelAcFan)[keyof typeof VestelAcFan];

const TEMP_MIN = 18; // kVestelAcMinTempC (the setter's floor)
const TEMP_MAX = 30;
const TEMP_OFFSET = 16; // kVestelAcMinTempH
const TURBOSLEEP_NORMAL = 1;
const TURBOSLEEP_SLEEP = 3;
const TURBOSLEEP_TURBO = 7;
const SWING_ON = 0xa;
const SWING_OFF = 0xf;

// Bit positions within the 56-bit value.
const POS_SUM = 12n; // 8 bits (Cmd/Time checksum)
const POS_SWING = 20n; // 4
const POS_TURBOSLEEP = 24n; // 4
const POS_TEMP = 36n; // 4
const POS_FAN = 40n; // 4
const POS_MODE = 44n; // 3
const POS_ION = 50n; // 1
const POS_POWER = 52n; // 2
const POS_USECMD = 54n; // 1
// Time variant
const POS_OFF_TENMINS = 20n; // 3
const POS_OFF_HOURS = 23n; // 5
const POS_ON_TENMINS = 28n; // 3
const POS_ON_HOURS = 31n; // 5
const POS_HOURS = 36n; // 5
const POS_ON_TIMER = 41n; // 1
const POS_OFF_TIMER = 42n; // 1
const POS_TIMER = 43n; // 1
const POS_MINUTES = 44n; // 8

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface VestelAcState {
  /** True for a Time/Timer message; false/absent for a Command message. */
  timeCommand?: boolean;
  // --- Command fields ---
  power?: boolean;
  mode?: VestelAcModeValue;
  /** Temperature in °C (18–30). */
  temp?: number;
  fan?: VestelAcFanValue;
  swing?: boolean;
  /** Ion / air-purify. */
  ion?: boolean;
  sleep?: boolean;
  turbo?: boolean;
  // --- Time fields ---
  /** Clock: minutes past midnight. */
  clock?: number;
  /** On-timer in minutes (10-min resolution). */
  onTimer?: number;
  onTimerActive?: boolean;
  /** Off-timer in minutes (10-min resolution). */
  offTimer?: number;
  offTimerActive?: boolean;
  /** The combined timer-active flag. */
  timerActive?: boolean;
}

// ---------------------------------------------------------------------------
// Bit + checksum helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
function getField(v: bigint, pos: bigint, width: number): number {
  return Number((v >> pos) & ((1n << BigInt(width)) - 1n));
}
function setField(v: bigint, pos: bigint, width: number, val: number): bigint {
  const mask = ((1n << BigInt(width)) - 1n) << pos;
  return (v & ~mask) | ((BigInt(val) << pos) & mask);
}

/** Matches `IRVestelAc::calcChecksum`: 0xFF − (popcount(bits 20–63) + 2). */
export function vestelAcCalcChecksum(state: bigint): number {
  let region = (state >> 20n) & ((1n << 44n) - 1n);
  let pop = 0;
  while (region) {
    pop += Number(region & 1n);
    region >>= 1n;
  }
  return (0xff - (pop + 2)) & 0xff;
}

/** Verify the checksum (bits 12–19) of a 56-bit Vestel value. */
export function vestelAcValidChecksum(state: bigint): boolean {
  return getField(state, POS_SUM, 8) === vestelAcCalcChecksum(state);
}

function validMode(m: number): number {
  return m >= VestelAcMode.Auto && m <= VestelAcMode.Heat ? m : VestelAcMode.Auto;
}
function validFan(f: number): number {
  switch (f) {
    case VestelAcFan.Low: case VestelAcFan.Med: case VestelAcFan.High:
    case VestelAcFan.AutoCool: case VestelAcFan.AutoHot: case VestelAcFan.Auto:
      return f;
    default:
      return VestelAcFan.Auto;
  }
}

// ---------------------------------------------------------------------------
// Build raw 56-bit value
// ---------------------------------------------------------------------------

/**
 * Build the raw 56-bit Vestel value from a state object — a Command message,
 * or a Time message when {@link VestelAcState.timeCommand} is set. Reserved
 * bits are preserved from the protocol's default states, then the checksum
 * (bits 12–19) is written.
 */
export function buildVestelAcRaw(state: VestelAcState): bigint {
  let v: bigint;
  if (state.timeCommand) {
    v = TIME_DEFAULT;
    const onMins = Math.max(0, state.onTimer ?? 0);
    const offMins = Math.max(0, state.offTimer ?? 0);
    const clock = Math.max(0, state.clock ?? 0);
    v = setField(v, POS_OFF_HOURS, 5, Math.floor(offMins / 60));
    v = setField(v, POS_OFF_TENMINS, 3, Math.floor((offMins % 60) / 10));
    v = setField(v, POS_ON_HOURS, 5, Math.floor(onMins / 60));
    v = setField(v, POS_ON_TENMINS, 3, Math.floor((onMins % 60) / 10));
    v = setField(v, POS_HOURS, 5, Math.floor(clock / 60));
    v = setField(v, POS_MINUTES, 8, clock % 60);
    v = setField(v, POS_ON_TIMER, 1, (state.onTimerActive ?? false) ? 1 : 0);
    v = setField(v, POS_OFF_TIMER, 1, (state.offTimerActive ?? false) ? 1 : 0);
    v = setField(v, POS_TIMER, 1, (state.timerActive ?? false) ? 1 : 0);
    // UseCmd (bit 54) stays 0 for time messages.
  } else {
    v = CMD_DEFAULT;
    v = setField(v, POS_SWING, 4, (state.swing ?? false) ? SWING_ON : SWING_OFF);
    v = setField(v, POS_TURBOSLEEP, 4,
      state.turbo ? TURBOSLEEP_TURBO : state.sleep ? TURBOSLEEP_SLEEP : TURBOSLEEP_NORMAL);
    v = setField(v, POS_TEMP, 4, clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_OFFSET);
    v = setField(v, POS_FAN, 4, validFan(state.fan ?? VestelAcFan.Auto));
    v = setField(v, POS_MODE, 3, validMode(state.mode ?? VestelAcMode.Auto));
    v = setField(v, POS_ION, 1, (state.ion ?? false) ? 1 : 0);
    v = setField(v, POS_POWER, 2, (state.power ?? true) ? 0b11 : 0b00);
    v = setField(v, POS_USECMD, 1, 1);
  }
  return setField(v, POS_SUM, 8, vestelAcCalcChecksum(v)) & MASK;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw 56-bit Vestel value into IR timings (`IRsend::sendVestelAc`). */
export function encodeVestelAcRaw(data: bigint, repeat: number = 0): number[] {
  return sendGeneric({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: MESSAGE_GAP,
    data: data & MASK, nbits: VESTEL_AC_BITS, msbFirst: false, repeat,
  });
}

/** Build + encode a Vestel state into IR timings. */
export function sendVestelAc(state: VestelAcState, repeat: number = 0): number[] {
  return encodeVestelAcRaw(buildVestelAcRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 56-bit Vestel value into a state object. */
export function parseVestelAcState(v: bigint): VestelAcState {
  if (getField(v, POS_USECMD, 1) === 0) {
    return {
      timeCommand: true,
      clock: getField(v, POS_HOURS, 5) * 60 + getField(v, POS_MINUTES, 8),
      onTimer: getField(v, POS_ON_HOURS, 5) * 60 + getField(v, POS_ON_TENMINS, 3) * 10,
      onTimerActive: getField(v, POS_ON_TIMER, 1) === 1,
      offTimer: getField(v, POS_OFF_HOURS, 5) * 60 + getField(v, POS_OFF_TENMINS, 3) * 10,
      offTimerActive: getField(v, POS_OFF_TIMER, 1) === 1,
      timerActive: getField(v, POS_TIMER, 1) === 1,
    };
  }
  const turboSleep = getField(v, POS_TURBOSLEEP, 4);
  return {
    timeCommand: false,
    power: getField(v, POS_POWER, 2) === 0b11,
    mode: getField(v, POS_MODE, 3) as VestelAcModeValue,
    temp: getField(v, POS_TEMP, 4) + TEMP_OFFSET,
    fan: getField(v, POS_FAN, 4) as VestelAcFanValue,
    swing: getField(v, POS_SWING, 4) === SWING_ON,
    ion: getField(v, POS_ION, 1) === 1,
    sleep: turboSleep === TURBOSLEEP_SLEEP,
    turbo: turboSleep === TURBOSLEEP_TURBO,
  };
}

/**
 * Decode raw IR timings as a Vestel A/C message.
 *
 * Mirrors `IRrecv::decodeVestelAc`: match a 56-bit LSB-first value, validate the
 * checksum, then parse it as a Command or Time message per the `UseCmd` bit.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeVestelAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): VestelAcState | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, VESTEL_AC_BITS,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MESSAGE_GAP, true, TOLERANCE, kMarkExcess, false, headerOptional,
  );
  if (!result) return null;
  const v = result.data & MASK;
  if (!vestelAcValidChecksum(v)) return null;
  return parseVestelAcState(v);
}
