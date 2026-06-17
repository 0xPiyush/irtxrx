/**
 * Corona A/C IR protocol encoder and decoder. (CORONA_AC)
 *
 * Ported from IRremoteESP8266 `ir_Corona.cpp` / `ir_Corona.h` — full coverage of
 * the `IRCoronaAc` class and the `sendCoronaAc` / `decodeCoronaAc` wire format.
 *
 * Wire format: a 21-byte state sent LSB-first as **three 7-byte sections**, each
 * a full 3500/1680 header + data + footer/gap. Each section is
 * `[0x28, 0x61, label, Data0, ~Data0, Data1, ~Data1]` — the "checksum" is byte
 * inversion. Section 0 holds the settings; sections 1 and 2 hold the On and Off
 * timers (a 16-bit value of 30-units-per-minute, `0xFFFF` = off).
 *
 * Power and the timers interact (matching the class): setting power clears the
 * matching timer, and setting a timer forces power on, clears the other timer,
 * and clears the one-shot "power button".
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Corona.cpp
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

const HDR_MARK = 3500;
const HDR_SPACE = 1680;
const BIT_MARK = 450;
const ONE_SPACE = 1270;
const ZERO_SPACE = 420;
const SPACE_GAP = 10800;
const TOLERANCE = 30; // kTolerance (25) + kCoronaTolerance (5)

const SECTION_BYTES = 7;
const SECTIONS = 3;
export const CORONA_AC_STATE_LENGTH = SECTION_BYTES * SECTIONS; // 21

const SECTION_HEADER0 = 0x28;
const SECTION_HEADER1 = 0x61;
const SECTION_LABEL_BASE = 0x0d;
const DATA0_BASE = 0x10; // section-0 Data0 bit 4 is always on

export const CoronaAcMode = { Heat: 0b00, Dry: 0b01, Cool: 0b10, Fan: 0b11 } as const;
export type CoronaAcModeValue = (typeof CoronaAcMode)[keyof typeof CoronaAcMode];
export const CoronaAcFan = { Auto: 0b00, Low: 0b01, Medium: 0b10, High: 0b11 } as const;
export type CoronaAcFanValue = (typeof CoronaAcFan)[keyof typeof CoronaAcFan];

const TEMP_MIN = 17;
const TEMP_MAX = 30;
const TIMER_MAX = 12 * 60; // minutes
const TIMER_OFF = 0xffff;
const TIMER_UNITS_PER_MIN = 30;

/** Section label byte for section `s`: `((0b11 << s) << 4) | 0x0D`. */
function sectionLabel(s: number): number {
  return (((0b11 << s) << 4) & 0xf0) | SECTION_LABEL_BASE;
}

export interface CoronaAcState {
  power?: boolean;
  /** One-shot "power button" press (defaults true; any timer clears it). */
  powerButton?: boolean;
  mode?: CoronaAcModeValue;
  /** Temperature in °C (17–30). */
  temp?: number;
  fan?: CoronaAcFanValue;
  econo?: boolean;
  /** One-shot vertical-swing toggle. */
  swingVToggle?: boolean;
  /** On-timer in minutes (1–720; 0 = off). */
  onTimer?: number;
  /** Off-timer in minutes (1–720; 0 = off). */
  offTimer?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
function getBits(raw: Uint8Array, idx: number, off: number, size: number): number {
  return (raw[idx]! >> off) & ((1 << size) - 1);
}
function setBits(raw: Uint8Array, idx: number, off: number, size: number, val: number): void {
  const mask = ((1 << size) - 1) << off;
  raw[idx] = (raw[idx]! & ~mask) | ((val << off) & mask);
}

/** Validate one 7-byte section: headers, label, and the two byte inversions. */
export function coronaAcValidSection(raw: Uint8Array, section: number): boolean {
  const b = section * SECTION_BYTES;
  if (raw[b] !== SECTION_HEADER0 || raw[b + 1] !== SECTION_HEADER1) return false;
  if (raw[b + 2] !== sectionLabel(section)) return false;
  if (raw[b + 3]! !== ((~raw[b + 4]!) & 0xff)) return false;
  if (raw[b + 5]! !== ((~raw[b + 6]!) & 0xff)) return false;
  return true;
}

/** Fill in each section's headers, label, and inverted bytes (`checksum`). */
function applyChecksum(raw: Uint8Array): void {
  for (let s = 0; s < SECTIONS; s++) {
    const b = s * SECTION_BYTES;
    raw[b] = SECTION_HEADER0;
    raw[b + 1] = SECTION_HEADER1;
    raw[b + 2] = sectionLabel(s);
    raw[b + 4] = (~raw[b + 3]!) & 0xff;
    raw[b + 6] = (~raw[b + 5]!) & 0xff;
  }
}

/**
 * Build the raw 21-byte Corona state from a state object, mirroring the
 * `IRCoronaAc` setter sequence and the circular power/timer interactions.
 */
export function buildCoronaAcRaw(state: CoronaAcState): Uint8Array {
  const raw = new Uint8Array(CORONA_AC_STATE_LENGTH);
  // stateReset: section-0 Data0 base (bit 4 on), all else 0.
  raw[3] = DATA0_BASE;

  // Settings accessors (section 0: Data0 = raw[3], Data1 = raw[5]).
  const setTemp = (deg: number): void => setBits(raw, 5, 0, 4, clamp(deg, TEMP_MIN, TEMP_MAX) - TEMP_MIN + 1);
  const setMode = (m: number): void => setBits(raw, 5, 6, 2,
    m === CoronaAcMode.Dry || m === CoronaAcMode.Fan || m === CoronaAcMode.Heat ? m : CoronaAcMode.Cool);
  const setFan = (s: number): void => setBits(raw, 3, 0, 2, s > CoronaAcFan.High ? CoronaAcFan.Auto : s);
  const setEcono = (on: boolean): void => setBits(raw, 3, 3, 1, on ? 1 : 0);
  const setSwingV = (on: boolean): void => setBits(raw, 3, 6, 1, on ? 1 : 0);
  const setPowerBit = (on: boolean): void => setBits(raw, 5, 4, 1, on ? 1 : 0);
  const setPowerButton = (on: boolean): void => setBits(raw, 5, 5, 1, on ? 1 : 0);

  // Timer accessors (section s: Data0 = raw[s*7+3], Data1 = raw[s*7+5]).
  const setTimer = (section: number, mins: number): void => {
    const hsecs = mins >= 1 && mins <= TIMER_MAX ? mins * TIMER_UNITS_PER_MIN : TIMER_OFF;
    setBits(raw, section * SECTION_BYTES + 5, 0, 8, (hsecs >> 8) & 0xff); // Data1
    setBits(raw, section * SECTION_BYTES + 3, 0, 8, hsecs & 0xff); // Data0
    if (hsecs !== TIMER_OFF) { setPowerBit(true); setPowerButton(false); }
  };
  // Note: the class's setOnTimer/setOffTimer mutually clear each other, but as a
  // pure builder we write each section's timer exactly as given so that decoding
  // a frame carrying both timer sections re-encodes losslessly. For the single-
  // timer states the class produces this is identical (clearing an already-off
  // timer is a no-op).
  const setOnTimer = (mins: number): void => { setTimer(1, mins); };
  const setOffTimer = (mins: number): void => { setTimer(2, mins); };
  const setPower = (on: boolean): void => { setPowerBit(on); if (on) setOnTimer(TIMER_OFF); else setOffTimer(TIMER_OFF); };

  // stateReset defaults then the setter sequence.
  setPowerButton(true);
  setTimer(1, TIMER_OFF);
  setTimer(2, TIMER_OFF);

  setPower(state.power ?? false);
  setTemp(state.temp ?? TEMP_MIN);
  setMode(state.mode ?? CoronaAcMode.Cool);
  setFan(state.fan ?? CoronaAcFan.Auto);
  setEcono(state.econo ?? false);
  setSwingV(state.swingVToggle ?? false);
  setOnTimer(state.onTimer ?? 0);
  setOffTimer(state.offTimer ?? 0);
  setPowerButton(state.powerButton ?? true);

  applyChecksum(raw);
  return raw;
}

/** Encode a raw 21-byte Corona state into IR timings (`IRsend::sendCoronaAc`). */
export function encodeCoronaAcRaw(raw: Uint8Array, repeat: number = 0): number[] {
  const out: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    for (let s = 0; s < SECTIONS; s++) {
      const section = sendGenericBytes({
        headerMark: HDR_MARK, headerSpace: HDR_SPACE,
        oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
        footerMark: BIT_MARK, gap: SPACE_GAP,
        data: raw.subarray(s * SECTION_BYTES, (s + 1) * SECTION_BYTES), msbFirst: false,
      });
      for (const t of section) out.push(t);
    }
  }
  return out;
}

/** Build + encode a Corona state into IR timings. */
export function sendCoronaAc(state: CoronaAcState, repeat: number = 0): number[] {
  return encodeCoronaAcRaw(buildCoronaAcRaw(state), repeat);
}

/** Parse a validated 21-byte Corona state into a state object. */
export function parseCoronaAcState(raw: Uint8Array): CoronaAcState {
  const onHsecs = (raw[1 * SECTION_BYTES + 5]! << 8) | raw[1 * SECTION_BYTES + 3]!;
  const offHsecs = (raw[2 * SECTION_BYTES + 5]! << 8) | raw[2 * SECTION_BYTES + 3]!;
  return {
    power: !!getBits(raw, 5, 4, 1),
    powerButton: !!getBits(raw, 5, 5, 1),
    mode: getBits(raw, 5, 6, 2) as CoronaAcModeValue,
    temp: getBits(raw, 5, 0, 4) + TEMP_MIN - 1,
    fan: getBits(raw, 3, 0, 2) as CoronaAcFanValue,
    econo: !!getBits(raw, 3, 3, 1),
    swingVToggle: !!getBits(raw, 3, 6, 1),
    onTimer: onHsecs === TIMER_OFF ? 0 : Math.floor(onHsecs / TIMER_UNITS_PER_MIN),
    offTimer: offHsecs === TIMER_OFF ? 0 : Math.floor(offHsecs / TIMER_UNITS_PER_MIN),
  };
}

/**
 * Decode raw IR timings as a Corona A/C message (`IRrecv::decodeCoronaAc`): match
 * three 7-byte sections and validate each section's headers, label, and byte
 * inversions.
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeCoronaAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): CoronaAcState | null {
  const bytes = new Uint8Array(CORONA_AC_STATE_LENGTH);
  let pos = offset;
  for (let s = 0; s < SECTIONS; s++) {
    const section = matchGenericBytes(
      timings, pos, timings.length - pos, SECTION_BYTES,
      HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
      BIT_MARK, SPACE_GAP, true, TOLERANCE, undefined, false, s === 0 ? headerOptional : false,
    );
    if (!section) return null;
    bytes.set(section.data, s * SECTION_BYTES);
    pos += section.used;
    if (!coronaAcValidSection(bytes, s)) return null;
  }
  return parseCoronaAcState(bytes);
}
