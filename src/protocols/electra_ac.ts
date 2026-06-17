/**
 * Electra A/C IR protocol encoder and decoder. (ELECTRA_AC)
 *
 * Ported from IRremoteESP8266 `ir_Electra.cpp` / `ir_Electra.h` — full coverage
 * of the `IRElectraAc` class and the `sendElectraAC` / `decodeElectraAC` wire
 * format. Models: Electra, AUX, Frigidaire, Subtropic, Centek, AEG, Electrolux,
 * Delonghi PAC EM90 (YKR-style / AUX-style remotes).
 *
 * Wire format: a fixed 13-byte state sent LSB-first behind a 9166/4470 header,
 * with a trailing bit-mark + ≈100ms message gap. byte 0 is a constant `0xC3`
 * signature; byte 12 is a plain modulo-256 sum of bytes 0–11.
 *
 * Besides the usual power/mode/temp/fan/swing, Electra carries an IFeel
 * (FollowMe) sensor temperature in byte 7 (offset by `0x4A`), a "sensor update"
 * marker, Turbo/Quiet, Clean, and a one-shot LED **light toggle** (byte 11).
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Electra.cpp
 */

import { sendGenericBytes, sumBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Electra.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 9166;
const HDR_SPACE = 4470;
const BIT_MARK = 646;
const ONE_SPACE = 1647;
const ZERO_SPACE = 547;
const MESSAGE_GAP = 100000; // kDefaultMessageGap

export const ELECTRA_AC_STATE_LENGTH = 13;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const ElectraAcMode = {
  Auto: 0b000,
  Cool: 0b001,
  Dry: 0b010,
  Heat: 0b100,
  Fan: 0b110,
} as const;
export type ElectraAcModeValue = (typeof ElectraAcMode)[keyof typeof ElectraAcMode];

export const ElectraAcFan = {
  Auto: 0b101,
  Low: 0b011,
  Med: 0b010,
  High: 0b001,
} as const;
export type ElectraAcFanValue = (typeof ElectraAcFan)[keyof typeof ElectraAcFan];

const TEMP_MIN = 16;
const TEMP_MAX = 32;
const TEMP_DELTA = 8;
const SWING_ON = 0b000;
const SWING_OFF = 0b111;
const LIGHT_TOGGLE_ON = 0x15;
const LIGHT_TOGGLE_OFF = 0x08;
const LIGHT_TOGGLE_MASK = 0x11;
const SENSOR_TEMP_DELTA = 0x4a;
const SENSOR_MIN_TEMP = 0;
const SENSOR_MAX_TEMP = 50;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface ElectraAcState {
  power?: boolean;
  mode?: ElectraAcModeValue;
  /** Temperature in °C (16–32). */
  temp?: number;
  fan?: ElectraAcFanValue;
  swingV?: boolean;
  swingH?: boolean;
  clean?: boolean;
  /** LED light **toggle** (one-shot on the real unit). */
  lightToggle?: boolean;
  turbo?: boolean;
  quiet?: boolean;
  /** IFeel / FollowMe sensor mode. */
  iFeel?: boolean;
  /**
   * "Sensor update" marker: the message only conveys {@link sensorTemp} and the
   * unit ignores the other settings (and stays silent).
   */
  sensorUpdate?: boolean;
  /** IFeel sensor temperature in °C (0–50); meaningful when {@link iFeel} or
   *  {@link sensorUpdate} is set. */
  sensorTemp?: number;
}

// ---------------------------------------------------------------------------
// Bit helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Checksum — matches IRElectraAc::calcChecksum (modulo-256 sum of bytes 0..11)
// ---------------------------------------------------------------------------

/** Verify the byte-12 checksum of a 13-byte Electra state. */
export function electraAcValidChecksum(raw: Uint8Array): boolean {
  if (raw.length < 2) return true;
  return raw[raw.length - 1] === (sumBytes(raw, 0, raw.length - 1) & 0xff);
}

// ---------------------------------------------------------------------------
// Build raw 13-byte state — mirrors the IRElectraAc setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 13-byte Electra state from a state object.
 *
 * Reproduces `stateReset()` (byte 0 = `0xC3`, light toggle = off) then the
 * setters. The sensor temperature in byte 7 is written (offset by `0x4A`) only
 * when IFeel or the sensor-update marker is active, matching the class's
 * IFeel↔SensorTemp behaviour; otherwise byte 7 stays 0. byte 12 is the sum.
 */
export function buildElectraAcRaw(state: ElectraAcState): Uint8Array {
  const raw = new Uint8Array(ELECTRA_AC_STATE_LENGTH);
  raw[0] = 0xc3;
  raw[11] = LIGHT_TOGGLE_OFF;

  setBits(raw, 9, 5, 1, (state.power ?? false) ? 1 : 0); // Power
  const mode = isMode(state.mode) ? state.mode! : ElectraAcMode.Auto;
  setBits(raw, 6, 5, 3, mode); // Mode
  setBits(raw, 1, 3, 5, clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_DELTA); // Temp
  setBits(raw, 4, 5, 3, isFan(state.fan) ? state.fan! : ElectraAcFan.Auto); // Fan
  setBits(raw, 1, 0, 3, (state.swingV ?? false) ? SWING_ON : SWING_OFF); // SwingV
  setBits(raw, 2, 5, 3, (state.swingH ?? false) ? SWING_ON : SWING_OFF); // SwingH
  setBits(raw, 9, 2, 1, (state.clean ?? false) ? 1 : 0); // Clean
  setBits(raw, 5, 6, 1, (state.turbo ?? false) ? 1 : 0); // Turbo
  setBits(raw, 5, 7, 1, (state.quiet ?? false) ? 1 : 0); // Quiet
  setBits(raw, 6, 3, 1, (state.iFeel ?? false) ? 1 : 0); // IFeel
  setBits(raw, 3, 6, 1, (state.sensorUpdate ?? false) ? 1 : 0); // SensorUpdate
  raw[11] = (state.lightToggle ?? false) ? LIGHT_TOGGLE_ON : LIGHT_TOGGLE_OFF;

  // Sensor temp (byte 7) only carries a value while IFeel/sensor-update is on.
  if ((state.iFeel ?? false) || (state.sensorUpdate ?? false)) {
    raw[7] = clamp(state.sensorTemp ?? 0, SENSOR_MIN_TEMP, SENSOR_MAX_TEMP) + SENSOR_TEMP_DELTA;
  }

  raw[12] = sumBytes(raw, 0, ELECTRA_AC_STATE_LENGTH - 1) & 0xff;
  return raw;
}

function isMode(m: number | undefined): boolean {
  return m === ElectraAcMode.Auto || m === ElectraAcMode.Cool || m === ElectraAcMode.Dry ||
    m === ElectraAcMode.Heat || m === ElectraAcMode.Fan;
}
function isFan(f: number | undefined): boolean {
  return f === ElectraAcFan.Auto || f === ElectraAcFan.Low || f === ElectraAcFan.Med || f === ElectraAcFan.High;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 13-byte Electra state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendElectraAC`: header + 13 bytes (LSB-first)
 * + bit-mark + 100ms gap, optionally repeated.
 */
export function encodeElectraAcRaw(raw: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: MESSAGE_GAP,
    data: raw, msbFirst: false, repeat,
  });
}

/** Build + encode an Electra state into IR timings. */
export function sendElectraAc(state: ElectraAcState, repeat: number = 0): number[] {
  return encodeElectraAcRaw(buildElectraAcRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 13-byte Electra state into a state object. */
export function parseElectraAcState(raw: Uint8Array): ElectraAcState {
  return {
    power: !!getBits(raw, 9, 5, 1),
    mode: getBits(raw, 6, 5, 3) as ElectraAcModeValue,
    temp: getBits(raw, 1, 3, 5) + TEMP_DELTA,
    fan: getBits(raw, 4, 5, 3) as ElectraAcFanValue,
    swingV: getBits(raw, 1, 0, 3) === SWING_ON,
    swingH: getBits(raw, 2, 5, 3) === SWING_ON,
    clean: !!getBits(raw, 9, 2, 1),
    lightToggle: (raw[11]! & LIGHT_TOGGLE_MASK) === LIGHT_TOGGLE_MASK,
    turbo: !!getBits(raw, 5, 6, 1),
    quiet: !!getBits(raw, 5, 7, 1),
    iFeel: !!getBits(raw, 6, 3, 1),
    sensorUpdate: !!getBits(raw, 3, 6, 1),
    sensorTemp: Math.max(SENSOR_TEMP_DELTA, raw[7]!) - SENSOR_TEMP_DELTA,
  };
}

/**
 * Decode raw IR timings as an Electra A/C message.
 *
 * Mirrors `IRrecv::decodeElectraAC`: match the header + 13 LSB-first bytes +
 * footer, then validate the modulo-256 checksum.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeElectraAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): ElectraAcState | null {
  const result = matchGenericBytes(
    timings, offset, timings.length - offset, ELECTRA_AC_STATE_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MESSAGE_GAP,
    true, undefined, 0, false, headerOptional,
  );
  if (!result) return null;
  if (!electraAcValidChecksum(result.data)) return null;
  return parseElectraAcState(result.data);
}
