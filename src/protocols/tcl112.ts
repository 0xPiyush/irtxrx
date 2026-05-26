/**
 * TCL 112-bit (14-byte) A/C protocol encoder and decoder. (TCL112AC)
 *
 * Ported from IRremoteESP8266 `ir_Tcl.cpp` / `ir_Tcl.h`.
 * Models: TCL TAC-09CHSD/XA31I, Leberg LBS-TOR07 (TAC09CHSD); Teknopoint
 * Allegro SSA-09H (GZ055BE1). Also the common framing for several rebadged
 * Indian-market split ACs.
 *
 * Wire format: 3000/1650 header + 14 bytes (LSB-first) + footer, byte-sum
 * checksum in byte 13. Messages always start with the fixed prefix 0x23 0xCB
 * 0x26. Temperature has 0.5°C resolution.
 *
 * @note TCL112AC shares its timing/framing with MITSUBISHI112; the two are
 *   told apart by the header-mark length (Mitsubishi's is longer). Only the
 *   "Normal" (type 1) message is modelled here — the "Special"/quiet (type 2)
 *   message is out of scope.
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/619
 */

import { sumBytes, sendGenericBytes } from "../encode.js";
import { matchGenericBytes, matchMark, matchSpace } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Tcl.h exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3000;
const HDR_SPACE = 1650;
const BIT_MARK = 500;
const ONE_SPACE = 1050;
const ZERO_SPACE = 325;
const GAP = 100000;
/** Header-mark tolerance — tight, to disambiguate from MITSUBISHI112 (3450µs). */
const HDR_MARK_TOLERANCE = 6;
/** Data tolerance — `_tolerance` (25%) + `kTcl112AcTolerance` (5%). */
const DATA_TOLERANCE = 30;

const STATE_LENGTH = 14;
const TEMP_MIN = 16;
const TEMP_MAX = 31;
const TIMER_RESOLUTION = 20; // minutes
const TIMER_MAX = 720; // minutes (12h)

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const Tcl112Mode = {
  Heat: 1,
  Dry: 2,
  Cool: 3,
  Fan: 7,
  Auto: 8,
} as const;

export type Tcl112ModeValue = (typeof Tcl112Mode)[keyof typeof Tcl112Mode];

export const Tcl112Fan = {
  Auto: 0b000,
  Min: 0b001, // "Night"
  Low: 0b010,
  Med: 0b011,
  High: 0b101,
} as const;

export type Tcl112FanValue = (typeof Tcl112Fan)[keyof typeof Tcl112Fan];

export const Tcl112SwingV = {
  Off: 0b000,
  Highest: 0b001,
  High: 0b010,
  Middle: 0b011,
  Low: 0b100,
  Lowest: 0b101,
  On: 0b111,
} as const;

export type Tcl112SwingVValue = (typeof Tcl112SwingV)[keyof typeof Tcl112SwingV];

export const Tcl112Model = {
  TAC09CHSD: 1,
  GZ055BE1: 2,
} as const;

export type Tcl112ModelValue = (typeof Tcl112Model)[keyof typeof Tcl112Model];

const MSGTYPE_SPECIAL = 0b10;

/** Reset state from `IRTcl112Ac::stateReset` (On, Cool, 24°C). */
const TEMPLATE: readonly number[] = [
  0x23, 0xCB, 0x26, 0x01, 0x00, 0x24, 0x03, 0x07, 0x40, 0x00, 0x00, 0x00,
  0x00, 0x03,
];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Tcl112State {
  power?: boolean;
  /** Temperature in °C (16–31, 0.5° resolution). */
  temp?: number;
  mode?: Tcl112ModeValue;
  fan?: Tcl112FanValue;
  swingV?: Tcl112SwingVValue;
  swingH?: boolean;
  econo?: boolean;
  /** Health / filter setting. */
  health?: boolean;
  /** Display/LED light. */
  light?: boolean;
  turbo?: boolean;
  /** On-timer in minutes (0 = off, rounds down to 20-min steps, max 720). */
  onTimer?: number;
  /** Off-timer in minutes (0 = off, rounds down to 20-min steps, max 720). */
  offTimer?: number;
  model?: Tcl112ModelValue;
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

/** Matches `IRTcl112Ac::calcChecksum`: byte sum, +0xF offset for special msgs. */
function calcChecksum(raw: Uint8Array, length: number = STATE_LENGTH): number {
  if (length <= 4 || raw[3] !== 0x02) return sumBytes(raw, 0, length - 1);
  return (sumBytes(raw, 0, length - 1) + 0xF) & 0xFF;
}

// ---------------------------------------------------------------------------
// Build raw byte array — emulates the IRTcl112Ac setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 14-byte TCL112AC state from a state object.
 *
 * Emulates `stateReset()` then the C++ setter order. `setTurbo(true)` forces
 * fan to High and vertical swing to On, and is applied after the explicit
 * fan/swing setters so it wins — exactly as the class behaves.
 */
export function buildTcl112Raw(state: Tcl112State): Uint8Array {
  const raw = Uint8Array.from(TEMPLATE);

  const setBit = (idx: number, bit: number, on: boolean): void => {
    if (on) raw[idx] = raw[idx]! | (1 << bit); else raw[idx] = raw[idx]! & ~(1 << bit);
  };
  const setBits = (idx: number, off: number, size: number, val: number): void => {
    const mask = ((1 << size) - 1) << off;
    raw[idx] = (raw[idx]! & ~mask) | ((val << off) & mask);
  };

  const setFan = (speed: number): void => {
    switch (speed) {
      case Tcl112Fan.Auto:
      case Tcl112Fan.Min:
      case Tcl112Fan.Low:
      case Tcl112Fan.Med:
      case Tcl112Fan.High:
        setBits(8, 0, 3, speed);
        break;
      default:
        setBits(8, 0, 3, Tcl112Fan.Auto);
    }
  };

  const setMode = (mode: number): void => {
    switch (mode) {
      case Tcl112Mode.Fan:
        setFan(Tcl112Fan.High);
        setBits(6, 0, 4, mode);
        break;
      case Tcl112Mode.Auto:
      case Tcl112Mode.Cool:
      case Tcl112Mode.Heat:
      case Tcl112Mode.Dry:
        setBits(6, 0, 4, mode);
        break;
      default:
        setBits(6, 0, 4, Tcl112Mode.Auto);
    }
  };

  const setTemp = (celsius: number): void => {
    const safe = Math.min(Math.max(celsius, TEMP_MIN), TEMP_MAX);
    const nrHalfDegrees = Math.trunc(safe * 2);
    setBit(12, 5, (nrHalfDegrees & 1) === 1);                 // HalfDegree
    setBits(7, 0, 4, TEMP_MAX - Math.trunc(nrHalfDegrees / 2)); // Temp
  };

  const setSwingVertical = (setting: number): void => {
    switch (setting) {
      case Tcl112SwingV.Off:
      case Tcl112SwingV.Highest:
      case Tcl112SwingV.High:
      case Tcl112SwingV.Middle:
      case Tcl112SwingV.Low:
      case Tcl112SwingV.Lowest:
      case Tcl112SwingV.On:
        setBits(8, 3, 3, setting);
    }
  };

  const setTurbo = (on: boolean): void => {
    setBit(6, 5, on); // Turbo
    if (on) {
      setBits(8, 0, 3, Tcl112Fan.High);
      setBits(8, 3, 3, Tcl112SwingV.On);
    }
  };

  const setTimer = (idx: number, enabledBit: number, mins: number): void => {
    const units = Math.trunc(Math.min(mins, TIMER_MAX) / TIMER_RESOLUTION);
    setBits(idx, 1, 6, units);          // OnTimer/OffTimer occupy bits 1–6
    setBit(5, enabledBit, units > 0);   // OnTimerEnabled / OffTimerEnabled
  };

  // stateReset() applied via TEMPLATE. Now mirror the runner's setter order.
  setBit(12, 7, (state.model ?? Tcl112Model.TAC09CHSD) !== Tcl112Model.GZ055BE1); // isTcl
  setMode((state.mode ?? Tcl112Mode.Cool) as number);
  setTemp(state.temp ?? 24);
  setFan((state.fan ?? Tcl112Fan.Auto) as number);
  setSwingVertical((state.swingV ?? Tcl112SwingV.Off) as number);
  setBit(12, 3, state.swingH ?? false);   // SwingH
  setBit(5, 7, state.econo ?? false);      // Econo
  setBit(6, 4, state.health ?? false);     // Health
  setBit(5, 6, !(state.light ?? false));   // Light (bit cleared when on)
  setTurbo(state.turbo ?? false);
  setTimer(10, 4, state.onTimer ?? 0);     // OnTimer + OnTimerEnabled (bit4)
  setTimer(9, 3, state.offTimer ?? 0);     // OffTimer + OffTimerEnabled (bit3)
  setBit(8, 6, !!(raw[5]! & 0x18));        // TimerIndicator = on||off enabled
  setBit(5, 2, state.power ?? true);       // Power

  raw[13] = calcChecksum(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// Public encode API
// ---------------------------------------------------------------------------

/**
 * Encode a raw 14-byte TCL112AC state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendTcl112Ac` (LSB-first).
 */
export function encodeTcl112Raw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK,
    headerSpace: HDR_SPACE,
    oneMark: BIT_MARK,
    oneSpace: ONE_SPACE,
    zeroMark: BIT_MARK,
    zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK,
    gap: GAP,
    data,
    msbFirst: false,
    repeat,
  });
}

/** Encode a TCL112AC state into raw IR timings. */
export function sendTcl112(state: Tcl112State, repeat: number = 0): number[] {
  return encodeTcl112Raw(buildTcl112Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a TCL112AC message.
 *
 * The header mark is matched with a tight tolerance so a (timing-compatible)
 * MITSUBISHI112 frame is rejected rather than mislabelled. Validates the fixed
 * 0x23CB26 prefix and the byte-sum checksum.
 *
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeTcl112(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Tcl112State | null {
  let pos = offset;

  // Header — tight mark tolerance disambiguates from MITSUBISHI112.
  let hasHeader = false;
  if (pos + 1 < timings.length &&
      matchMark(timings[pos]!, HDR_MARK, HDR_MARK_TOLERANCE) &&
      matchSpace(timings[pos + 1]!, HDR_SPACE, DATA_TOLERANCE)) {
    pos += 2;
    hasHeader = true;
  }
  if (!hasHeader && !headerOptional) return null;

  // Data + footer (header already consumed / intentionally skipped).
  const frame = matchGenericBytes(
    timings, pos, timings.length - pos, STATE_LENGTH,
    0, 0,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, DATA_TOLERANCE, undefined, false,
    false,
  );
  if (!frame) return null;

  const raw = frame.data;
  // Fixed prefix + checksum gate false matches.
  if (raw[0] !== 0x23 || raw[1] !== 0xCB || raw[2] !== 0x26) return null;
  if (raw[13] !== calcChecksum(raw)) return null;
  // Out of scope: the special/quiet (type 2) message.
  if ((raw[3]! & 0x03) === MSGTYPE_SPECIAL) return null;

  const halfDegree = (raw[12]! >> 5) & 1;
  const temp = (TEMP_MAX - (raw[7]! & 0x0F)) + (halfDegree ? 0.5 : 0);

  return {
    power: !!(raw[5]! & 0x04),
    temp,
    mode: (raw[6]! & 0x0F) as Tcl112ModeValue,
    fan: (raw[8]! & 0x07) as Tcl112FanValue,
    swingV: ((raw[8]! >> 3) & 0x07) as Tcl112SwingVValue,
    swingH: !!(raw[12]! & 0x08),
    econo: !!(raw[5]! & 0x80),
    health: !!(raw[6]! & 0x10),
    light: !((raw[5]! >> 6) & 1),
    turbo: !!(raw[6]! & 0x20),
    onTimer: ((raw[10]! >> 1) & 0x3F) * TIMER_RESOLUTION,
    offTimer: ((raw[9]! >> 1) & 0x3F) * TIMER_RESOLUTION,
    model: ((raw[12]! >> 7) & 1) ? Tcl112Model.TAC09CHSD : Tcl112Model.GZ055BE1,
  };
}
