/**
 * Samsung A/C IR protocol encoder and decoder. (SAMSUNG_AC)
 *
 * Ported from IRremoteESP8266 `ir_Samsung.cpp` / `ir_Samsung.h`.
 * Models: AR09/AR12 series, DB93-14195A / DB96-24901C remotes.
 *
 * Wire format: a message header (690/17844) followed by 7-byte sections, each
 * framed by a 3086/8864 section header and a 2886µs section gap, sent LSB-first.
 * Each section carries a population-count nibble checksum. Only the standard
 * 14-byte (two-section) message is modelled here; the 21-byte extended message
 * (timers / sleep / explicit power) is out of scope.
 *
 * Powerful/Breeze(WindFree)/Econo share the `FanSpecial` field and are mutually
 * exclusive; Quiet and Powerful are also mutually exclusive. These interactions
 * are reproduced from the `IRSamsungAc` class so encode stays byte-exact.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/505
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1538 (checksum)
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes, matchMark, matchSpace } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Samsung.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 690;
const HDR_SPACE = 17844;
const SECTION_MARK = 3086;
const SECTION_SPACE = 8864;
const SECTION_GAP = 2886;
const BIT_MARK = 586;
const ONE_SPACE = 1432;
const ZERO_SPACE = 436;
const MESSAGE_GAP = 100000; // kDefaultMessageGap

const STATE_LENGTH = 14;
const SECTION_LENGTH = 7;

const TEMP_MIN = 16;
const TEMP_MAX = 30;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const SamsungAcMode = {
  Auto: 0,
  Cool: 1,
  Dry: 2,
  Fan: 3,
  Heat: 4,
} as const;
export type SamsungAcModeValue = (typeof SamsungAcMode)[keyof typeof SamsungAcMode];

export const SamsungAcFan = {
  Auto: 0,
  Low: 2,
  Med: 4,
  High: 5,
  Turbo: 7,
} as const;
export type SamsungAcFanValue = (typeof SamsungAcFan)[keyof typeof SamsungAcFan];

/** Internal: the special fan code used while in Auto mode. */
const FAN_AUTO2 = 6;

// _.Swing
const SWING_V = 0b010;
const SWING_H = 0b011;
const SWING_BOTH = 0b100;
const SWING_OFF = 0b111;
// _.FanSpecial
const FANSPECIAL_OFF = 0b000;
const POWERFUL_ON = 0b011;
const BREEZE_ON = 0b101;
const ECONO_ON = 0b111;

/** Reset state from `IRSamsungAc::stateReset` (standard 14 bytes, power on). */
const RESET: readonly number[] = [
  0x02, 0x92, 0x0f, 0x00, 0x00, 0x00, 0xf0,
  0x01, 0x02, 0xae, 0x71, 0x00, 0x15, 0xf0,
];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface SamsungAcState {
  power?: boolean;
  mode?: SamsungAcModeValue;
  /** Temperature in °C (16–30). */
  temp?: number;
  fan?: SamsungAcFanValue;
  /** Vertical swing on/off. */
  swingV?: boolean;
  /** Horizontal swing on/off. */
  swingH?: boolean;
  quiet?: boolean;
  /** Powerful / Turbo. */
  powerful?: boolean;
  /** Breeze / WindFree. */
  breeze?: boolean;
  econo?: boolean;
  clean?: boolean;
  beep?: boolean;
  /** Display / LED light. */
  display?: boolean;
  /** Ion / filter. */
  ion?: boolean;
}

// ---------------------------------------------------------------------------
// Bit / checksum helpers
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

function setBit(raw: Uint8Array, idx: number, bit: number, on: boolean): void {
  if (on) raw[idx] = raw[idx]! | (1 << bit);
  else raw[idx] = raw[idx]! & ~(1 << bit);
}

function popcount8(v: number): number {
  let n = v & 0xff;
  let c = 0;
  while (n) { c += n & 1; n >>= 1; }
  return c;
}

/** Matches `IRSamsungAc::calcSectionChecksum`. */
function calcSectionChecksum(raw: Uint8Array, base: number): number {
  let sum = 0;
  sum += popcount8(raw[base]!);
  sum += popcount8(raw[base + 1]! & 0x0f); // low nibble of byte 1
  sum += popcount8((raw[base + 2]! >> 4) & 0x0f); // high nibble of byte 2
  for (let i = 3; i < 7; i++) sum += popcount8(raw[base + i]!);
  return (sum ^ 0xff) & 0xff;
}

/** Matches `IRSamsungAc::getSectionChecksum`. */
function getSectionChecksum(raw: Uint8Array, base: number): number {
  return ((raw[base + 2]! & 0x0f) << 4) | ((raw[base + 1]! >> 4) & 0x0f);
}

function setSectionChecksum(raw: Uint8Array, base: number): void {
  const sum = calcSectionChecksum(raw, base);
  setBits(raw, base + 1, 4, 4, sum & 0x0f); // Sum?Lower
  setBits(raw, base + 2, 0, 4, (sum >> 4) & 0x0f); // Sum?Upper
}

// ---------------------------------------------------------------------------
// Field accessors (standard message map)
// ---------------------------------------------------------------------------

const getSwingField = (raw: Uint8Array): number => getBits(raw, 9, 4, 3);
const setSwingField = (raw: Uint8Array, v: number): void => setBits(raw, 9, 4, 3, v);
const getFanField = (raw: Uint8Array): number => getBits(raw, 12, 1, 3);
const setFanField = (raw: Uint8Array, v: number): void => setBits(raw, 12, 1, 3, v);
const getModeField = (raw: Uint8Array): number => getBits(raw, 12, 4, 3);
const getFanSpecial = (raw: Uint8Array): number => getBits(raw, 10, 1, 3);
const setFanSpecial = (raw: Uint8Array, v: number): void => setBits(raw, 10, 1, 3, v);

const isSwingV = (raw: Uint8Array): boolean => {
  const s = getSwingField(raw);
  return s === SWING_V || s === SWING_BOTH;
};

// ---------------------------------------------------------------------------
// Build raw 14-byte state — emulates the IRSamsungAc setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 14-byte (standard) Samsung A/C state from a state object.
 *
 * Mirrors `stateReset()` then the C++ setter order used by the cross-check
 * runner, including the Quiet/Powerful/Breeze/Econo `FanSpecial` interactions.
 */
export function buildSamsungAcRaw(state: SamsungAcState): Uint8Array {
  const raw = Uint8Array.from(RESET);

  const setPower = (on: boolean): void => {
    const v = on ? 0b11 : 0b00;
    setBits(raw, 6, 4, 2, v); // Power1
    setBits(raw, 13, 4, 2, v); // Power2
  };

  const setTemp = (t: number): void => setBits(raw, 11, 4, 4, clamp(t, TEMP_MIN, TEMP_MAX) - TEMP_MIN);

  const setFan = (speed: number): void => {
    switch (speed) {
      case SamsungAcFan.Auto:
      case SamsungAcFan.Low:
      case SamsungAcFan.Med:
      case SamsungAcFan.High:
      case SamsungAcFan.Turbo:
        if (getModeField(raw) === SamsungAcMode.Auto) return; // not valid in Auto
        break;
      case FAN_AUTO2:
        if (getModeField(raw) !== SamsungAcMode.Auto) return;
        break;
      default:
        return;
    }
    setFanField(raw, speed);
  };

  const setMode = (mode: number): void => {
    const m = mode > SamsungAcMode.Heat ? SamsungAcMode.Auto : mode;
    setBits(raw, 12, 4, 3, m);
    if (m === SamsungAcMode.Auto) setFanField(raw, FAN_AUTO2);
    else if (getFanField(raw) === FAN_AUTO2) setFanField(raw, SamsungAcFan.Auto);
  };

  const getSwing = (): boolean => isSwingV(raw);

  const setSwing = (on: boolean): void => {
    switch (getSwingField(raw)) {
      case SWING_BOTH:
      case SWING_H:
        setSwingField(raw, on ? SWING_BOTH : SWING_H);
        break;
      default:
        setSwingField(raw, on ? SWING_V : SWING_OFF);
    }
  };

  const setSwingH = (on: boolean): void => {
    switch (getSwingField(raw)) {
      case SWING_V:
      case SWING_BOTH:
        setSwingField(raw, on ? SWING_BOTH : SWING_V);
        break;
      default:
        setSwingField(raw, on ? SWING_H : SWING_OFF);
    }
  };

  const getPowerful = (): boolean => getFanSpecial(raw) === POWERFUL_ON && getFanField(raw) === SamsungAcFan.Turbo;
  const getBreeze = (): boolean => getFanSpecial(raw) === BREEZE_ON && getFanField(raw) === SamsungAcFan.Auto && !getSwing();
  const getEcono = (): boolean => getFanSpecial(raw) === ECONO_ON && getFanField(raw) === SamsungAcFan.Auto && getSwing();

  const setQuiet = (on: boolean): void => {
    setBit(raw, 5, 5, on);
    if (on) {
      setFan(SamsungAcFan.Auto);
      setPowerful(false);
    }
  };

  function setPowerful(on: boolean): void {
    const offValue = (getBreeze() || getEcono()) ? getFanSpecial(raw) : FANSPECIAL_OFF;
    setFanSpecial(raw, on ? POWERFUL_ON : offValue);
    if (on) {
      setFan(SamsungAcFan.Turbo);
      setQuiet(false);
    }
  }

  const setBreeze = (on: boolean): void => {
    const offValue = (getPowerful() || getEcono()) ? getFanSpecial(raw) : FANSPECIAL_OFF;
    setFanSpecial(raw, on ? BREEZE_ON : offValue);
    if (on) {
      setFan(SamsungAcFan.Auto);
      setSwing(false);
    }
  };

  const setEcono = (on: boolean): void => {
    const offValue = (getBreeze() || getPowerful()) ? getFanSpecial(raw) : FANSPECIAL_OFF;
    setFanSpecial(raw, on ? ECONO_ON : offValue);
    if (on) {
      setFan(SamsungAcFan.Auto);
      setSwing(true);
    }
  };

  const setClean = (on: boolean): void => {
    setBit(raw, 10, 7, on); // CleanToggle10
    setBit(raw, 11, 1, on); // CleanToggle11
  };

  // Mirror the cross-check runner's setter order exactly.
  setPower(state.power ?? true);
  setMode(state.mode ?? SamsungAcMode.Auto);
  setTemp(state.temp ?? 25);
  setFan(state.fan ?? SamsungAcFan.Auto);
  setSwing(state.swingV ?? false);
  setSwingH(state.swingH ?? false);
  setQuiet(state.quiet ?? false);
  setPowerful(state.powerful ?? false);
  setBreeze(state.breeze ?? false);
  setEcono(state.econo ?? false);
  setClean(state.clean ?? false);
  setBit(raw, 13, 2, state.beep ?? false); // BeepToggle
  setBit(raw, 10, 4, state.display ?? false); // Display
  setBit(raw, 11, 0, state.ion ?? false); // Ion

  setSectionChecksum(raw, 0);
  setSectionChecksum(raw, SECTION_LENGTH);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 14-byte Samsung A/C state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendSamsungAC`: a message header then 7-byte
 * sections; the final section's gap absorbs the inter-message gap (→ 100ms).
 */
export function encodeSamsungAcRaw(data: Uint8Array, repeat: number = 0): number[] {
  const result: number[] = [];
  const sections = Math.floor(data.length / SECTION_LENGTH);
  for (let r = 0; r <= repeat; r++) {
    result.push(HDR_MARK, HDR_SPACE);
    for (let s = 0; s < sections; s++) {
      const isLast = s === sections - 1;
      const section = sendGenericBytes({
        headerMark: SECTION_MARK, headerSpace: SECTION_SPACE,
        oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
        footerMark: BIT_MARK, gap: isLast ? MESSAGE_GAP : SECTION_GAP,
        data: data.subarray(s * SECTION_LENGTH, (s + 1) * SECTION_LENGTH), msbFirst: false,
      });
      for (const t of section) result.push(t);
    }
  }
  return result;
}

/** Encode a Samsung A/C state into raw IR timings. */
export function sendSamsungAc(state: SamsungAcState, repeat: number = 0): number[] {
  return encodeSamsungAcRaw(buildSamsungAcRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Verify all section checksums of a Samsung A/C state. */
export function samsungAcValidChecksum(raw: Uint8Array): boolean {
  let ok = true;
  for (let base = 0; base + SECTION_LENGTH <= raw.length; base += SECTION_LENGTH)
    ok &&= getSectionChecksum(raw, base) === calcSectionChecksum(raw, base);
  return ok;
}

/** Parse a validated 14-byte Samsung A/C state into a state object. */
export function parseSamsungAcState(raw: Uint8Array): SamsungAcState {
  const swing = getSwingField(raw);
  const swingV = swing === SWING_V || swing === SWING_BOTH;
  const swingH = swing === SWING_H || swing === SWING_BOTH;
  const fanField = getFanField(raw);
  const fanSpecial = getFanSpecial(raw);
  const power = getBits(raw, 6, 4, 2) === 0b11 && getBits(raw, 13, 4, 2) === 0b11;
  return {
    power,
    mode: getModeField(raw) as SamsungAcModeValue,
    temp: getBits(raw, 11, 4, 4) + TEMP_MIN,
    fan: (fanField === FAN_AUTO2 ? SamsungAcFan.Auto : fanField) as SamsungAcFanValue,
    swingV,
    swingH,
    quiet: !!getBits(raw, 5, 5, 1),
    powerful: fanSpecial === POWERFUL_ON && fanField === SamsungAcFan.Turbo,
    breeze: fanSpecial === BREEZE_ON && fanField === SamsungAcFan.Auto && !swingV,
    econo: fanSpecial === ECONO_ON && fanField === SamsungAcFan.Auto && swingV,
    clean: !!getBits(raw, 10, 7, 1) && !!getBits(raw, 11, 1, 1),
    beep: !!getBits(raw, 13, 2, 1),
    display: !!getBits(raw, 10, 4, 1),
    ion: !!getBits(raw, 11, 0, 1),
  };
}

/**
 * Decode raw IR timings as a Samsung A/C (standard 14-byte) message.
 *
 * Matches the message header, the 7-byte section framing, and validates the
 * per-section population-count checksums.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeSamsungAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): SamsungAcState | null {
  let pos = offset;

  // Message header — mark matched loosely (the 690µs mark sits within the
  // bit-mark tolerance window, mirroring the C++ decoder).
  let hasHeader = false;
  if (pos + 1 < timings.length &&
      matchMark(timings[pos]!, BIT_MARK) && matchSpace(timings[pos + 1]!, HDR_SPACE)) {
    pos += 2;
    hasHeader = true;
  }
  if (!hasHeader && !headerOptional) return null;

  const raw = new Uint8Array(STATE_LENGTH);
  const sections = STATE_LENGTH / SECTION_LENGTH;
  for (let s = 0; s < sections; s++) {
    const isLast = s === sections - 1;
    const sec = matchGenericBytes(
      timings, pos, timings.length - pos, SECTION_LENGTH,
      SECTION_MARK, SECTION_SPACE,
      BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
      BIT_MARK, isLast ? MESSAGE_GAP : SECTION_GAP,
      isLast, undefined, undefined, false, false,
    );
    if (!sec) return null;
    raw.set(sec.data, s * SECTION_LENGTH);
    pos += sec.used;
  }

  if (!samsungAcValidChecksum(raw)) return null;
  return parseSamsungAcState(raw);
}
