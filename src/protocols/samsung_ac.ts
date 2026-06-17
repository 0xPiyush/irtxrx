/**
 * Samsung A/C IR protocol encoder and decoder. (SAMSUNG_AC)
 *
 * Ported from IRremoteESP8266 `ir_Samsung.cpp` / `ir_Samsung.h`.
 * Models: AR09/AR12 series, DB93-14195A / DB96-24901C remotes.
 *
 * Wire format: a message header (690/17844) followed by 7-byte sections, each
 * framed by a 3086/8864 section header and a 2886µs section gap, sent LSB-first.
 * Each section carries a population-count nibble checksum.
 *
 * Two message variants are supported (matching `IRSamsungAc`):
 *   - **Standard** (14-byte, two sections) — used for normal mode/temp/fan/swing
 *     changes while the unit is running.
 *   - **Extended** (21-byte, three sections) — required whenever the power
 *     on/off state, an On/Off timer, or Sleep is being changed. The middle
 *     section is a fixed marker carrying the timer/sleep bits; the third section
 *     is a copy of the standard settings section. Decode transparently handles
 *     both lengths and re-collapses an extended message to its settings.
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
const EXTENDED_STATE_LENGTH = 21;
const SECTION_LENGTH = 7;

const TEMP_MIN = 16;
const TEMP_MAX = 30;

const TIMER_MAX = 24 * 60; // 1 day, in minutes

/** The fixed middle (2nd) section inserted into an extended message. */
const EXTENDED_MIDDLE: readonly number[] = [0x01, 0xd2, 0x0f, 0x00, 0x00, 0x00, 0x00];

/** Fixed extended payload sent by `IRSamsungAc::sendOn` (power on). */
const SEND_ON_STATE: readonly number[] = [
  0x02, 0x92, 0x0f, 0x00, 0x00, 0x00, 0xf0,
  0x01, 0xd2, 0x0f, 0x00, 0x00, 0x00, 0x00,
  0x01, 0xe2, 0xfe, 0x71, 0x80, 0x11, 0xf0,
];

/** Fixed extended payload sent by `IRSamsungAc::sendOff` (power off). */
const SEND_OFF_STATE: readonly number[] = [
  0x02, 0xb2, 0x0f, 0x00, 0x00, 0x00, 0xc0,
  0x01, 0xd2, 0x0f, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x02, 0xff, 0x71, 0x80, 0x11, 0xc0,
];

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
  /**
   * On timer in minutes (0 = off). Resolution is 10 minutes; capped at 24h.
   * Setting any timer (or {@link extended}) emits a 21-byte extended message.
   */
  onTimer?: number;
  /** Off timer in minutes (0 = off). Resolution 10 min; capped at 24h. */
  offTimer?: number;
  /**
   * Sleep timer in minutes (0 = off). Resolution 10 min; capped at 24h.
   * Sleep shares the hardware Off timer, so setting it clears the On timer.
   */
  sleepTimer?: number;
  /**
   * Force a 21-byte extended message even with no timers set. Samsung requires
   * an extended message to change the power on/off state, so set this when the
   * intent is a power toggle. Decode sets it on any extended capture.
   */
  extended?: boolean;
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

/** Round a timer value to the hardware's 10-minute resolution, capped at 24h. */
function timerResolution(mins: number): number {
  return Math.floor(Math.min(Math.max(mins, 0), TIMER_MAX) / 10) * 10;
}

/**
 * Resolve the raw On/Off/Sleep timer values from a state, mirroring the
 * `IRSamsungAc::setOnTimer` / `setOffTimer` / `setSleepTimer` precedence: a
 * sleep timer takes over the Off timer and cancels any On timer.
 */
function resolveTimers(state: SamsungAcState): { onTimer: number; offTimer: number; sleep: boolean } {
  let onTimer = timerResolution(state.onTimer ?? 0);
  let offTimer = timerResolution(state.offTimer ?? 0);
  let sleep = false;
  if ((state.sleepTimer ?? 0) > 0) {
    offTimer = timerResolution(state.sleepTimer!);
    if (offTimer > 0) onTimer = 0;
    sleep = offTimer > 0;
  }
  return { onTimer, offTimer, sleep };
}

/** True when a state must be sent as a 21-byte extended message. */
function needsExtended(state: SamsungAcState): boolean {
  return state.extended === true ||
    (state.onTimer ?? 0) > 0 || (state.offTimer ?? 0) > 0 || (state.sleepTimer ?? 0) > 0;
}

/**
 * Build the raw 21-byte extended Samsung A/C state from a state object.
 *
 * Mirrors `IRSamsungAc::sendExtended`: the standard settings section becomes the
 * 3rd section, a fixed marker section is inserted as the 2nd, and the On/Off/
 * Sleep timer bits are written into it. All three section checksums are set.
 */
export function buildSamsungAcExtendedRaw(state: SamsungAcState): Uint8Array {
  const settings = buildSamsungAcRaw(state); // section 1 + settings section
  const raw = new Uint8Array(EXTENDED_STATE_LENGTH);
  raw.set(settings.subarray(0, SECTION_LENGTH), 0); // 1st section
  raw.set(EXTENDED_MIDDLE, SECTION_LENGTH); // 2nd (marker) section
  raw.set(settings.subarray(SECTION_LENGTH, STATE_LENGTH), 2 * SECTION_LENGTH); // 3rd section

  const { onTimer, offTimer, sleep } = resolveTimers(state);
  const onEnable = onTimer > 0;
  const offEnable = offTimer > 0;

  // _setOnTimer — On time fields live in bytes 10/11, enable/day in byte 12.
  setBits(raw, 12, 1, 1, onEnable ? 1 : 0); // OnTimerEnable
  if (onTimer >= TIMER_MAX) {
    setBits(raw, 12, 4, 1, 1); // OnTimeDay
  } else {
    setBits(raw, 12, 4, 1, 0);
    setBits(raw, 10, 4, 3, Math.floor((onTimer % 60) / 10)); // OnTimeMins
    const hours = Math.floor(onTimer / 60);
    setBits(raw, 10, 7, 1, hours & 0b1); // OnTimeHrs1
    setBits(raw, 11, 0, 4, hours >> 1); // OnTimeHrs2
  }

  // _setOffTimer — Off time fields live in bytes 9/10, enable/day in byte 12.
  setBits(raw, 12, 2, 1, offEnable ? 1 : 0); // OffTimerEnable
  if (offTimer >= TIMER_MAX) {
    setBits(raw, 12, 0, 1, 1); // OffTimeDay
  } else {
    setBits(raw, 12, 0, 1, 0);
    setBits(raw, 9, 4, 3, Math.floor((offTimer % 60) / 10)); // OffTimeMins
    const hours = Math.floor(offTimer / 60);
    setBits(raw, 9, 7, 1, hours & 0b1); // OffTimeHrs1
    setBits(raw, 10, 0, 4, hours >> 1); // OffTimeHrs2
  }

  // _setSleepTimer — Sleep only engages when an Off time is set.
  const sleepBit = sleep && offEnable ? 1 : 0;
  setBits(raw, 5, 4, 1, sleepBit); // Sleep5 (1st section)
  setBits(raw, 12, 3, 1, sleepBit); // Sleep12 (marker section)

  setSectionChecksum(raw, 0);
  setSectionChecksum(raw, SECTION_LENGTH);
  setSectionChecksum(raw, 2 * SECTION_LENGTH);
  return raw;
}

/**
 * Encode a Samsung A/C state into raw IR timings.
 *
 * Emits a 21-byte extended message when a timer/sleep is set or
 * {@link SamsungAcState.extended} is true, otherwise a standard 14-byte message
 * — matching `IRSamsungAc::send`.
 */
export function sendSamsungAc(state: SamsungAcState, repeat: number = 0): number[] {
  const raw = needsExtended(state) ? buildSamsungAcExtendedRaw(state) : buildSamsungAcRaw(state);
  return encodeSamsungAcRaw(raw, repeat);
}

/** Encode the fixed extended "power on" message (`IRSamsungAc::sendOn`). */
export function sendSamsungAcOn(repeat: number = 0): number[] {
  return encodeSamsungAcRaw(Uint8Array.from(SEND_ON_STATE), repeat);
}

/** Encode the fixed extended "power off" message (`IRSamsungAc::sendOff`). */
export function sendSamsungAcOff(repeat: number = 0): number[] {
  return encodeSamsungAcRaw(Uint8Array.from(SEND_OFF_STATE), repeat);
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
 * Extract the On/Off/Sleep timer settings from a raw 21-byte extended state,
 * mirroring `IRSamsungAc::setRaw` (length > 14) plus the public timer getters.
 */
export function parseSamsungAcExtended(raw: Uint8Array): SamsungAcState {
  // Collapse the extended message back to its 14-byte settings: 1st section +
  // 3rd section (the 2nd marker section is discarded), matching setRaw().
  const settings = new Uint8Array(STATE_LENGTH);
  settings.set(raw.subarray(0, SECTION_LENGTH), 0);
  settings.set(raw.subarray(2 * SECTION_LENGTH, EXTENDED_STATE_LENGTH), SECTION_LENGTH);

  // Timer/sleep bits live in the 2nd (marker) section, bytes 9–12.
  const onMins = getBits(raw, 10, 4, 3);
  const onHrs1 = getBits(raw, 10, 7, 1);
  const onHrs2 = getBits(raw, 11, 0, 4);
  const onDay = getBits(raw, 12, 4, 1);
  const offMins = getBits(raw, 9, 4, 3);
  const offHrs1 = getBits(raw, 9, 7, 1);
  const offHrs2 = getBits(raw, 10, 0, 4);
  const offDay = getBits(raw, 12, 0, 1);
  const sleep = getBits(raw, 5, 4, 1) === 1 && getBits(raw, 12, 3, 1) === 1;

  const onTimer = onDay ? TIMER_MAX : (onHrs2 * 2 + onHrs1) * 60 + onMins * 10;
  const offTimer = offDay ? TIMER_MAX : (offHrs2 * 2 + offHrs1) * 60 + offMins * 10;

  // Sleep & Off share the same timer; the getters report only the active one.
  return {
    ...parseSamsungAcState(settings),
    extended: true,
    onTimer,
    offTimer: sleep ? 0 : offTimer,
    sleepTimer: sleep ? offTimer : 0,
  };
}

/**
 * Decode raw IR timings as a Samsung A/C message (standard 14-byte or extended
 * 21-byte).
 *
 * Matches the message header, then 7-byte sections until one is followed by an
 * inter-message gap, and validates the per-section population-count checksums.
 * Extended messages additionally yield the On/Off/Sleep timer fields.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
/** True if no real pulses remain from `pos` (end of buffer or only zero padding). */
function atEndOfData(timings: number[], pos: number): boolean {
  for (let i = pos; i < timings.length; i++) if (timings[i] !== 0) return false;
  return true;
}

export function decodeSamsungAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): SamsungAcState | null {
  let pos = offset;

  // Message header — mark matched loosely (the 690µs mark sits within the
  // bit-mark tolerance window, mirroring the C++ decoder).
  let hasHeader = false;
  // C++ decodeSamsungAC pins mark-excess to 0 (not the global 50µs).
  if (pos + 1 < timings.length &&
      matchMark(timings[pos]!, BIT_MARK, undefined, 0) && matchSpace(timings[pos + 1]!, HDR_SPACE, undefined, 0)) {
    pos += 2;
    hasHeader = true;
  }
  if (!hasHeader && !headerOptional) return null;

  // Read 7-byte sections until one ends on an inter-message gap (the last). A
  // non-last section is followed by the short 2886µs section gap; the last by
  // the long ≈100ms message gap — the two are unambiguous, so no count is
  // needed up-front (supports both the 14- and 21-byte variants).
  const bytes: number[] = [];
  let matchedLast = false;
  for (let s = 0; s < EXTENDED_STATE_LENGTH / SECTION_LENGTH; s++) {
    // Try the section as non-last (short section gap) first, then as the last
    // section (long message gap, matched "at least").
    let sec = matchGenericBytes(
      timings, pos, timings.length - pos, SECTION_LENGTH,
      SECTION_MARK, SECTION_SPACE,
      BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
      BIT_MARK, SECTION_GAP,
      false, undefined, 0, false, false,
    );
    let isLast = false;
    if (!sec) {
      sec = matchGenericBytes(
        timings, pos, timings.length - pos, SECTION_LENGTH,
        SECTION_MARK, SECTION_SPACE,
        BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
        BIT_MARK, MESSAGE_GAP,
        true, undefined, 0, false, false,
      );
      isLast = true;
    }
    if (!sec) return null;
    for (const b of sec.data) bytes.push(b);
    pos += sec.used;
    // A clipped capture ends right after the final section's footer mark (no
    // trailing message gap, just zero padding / end of buffer), so the section
    // matches as "non-last". If nothing else remains, it IS the last section.
    if (!isLast && atEndOfData(timings, pos)) isLast = true;
    if (isLast) { matchedLast = true; break; }
  }

  if (!matchedLast) return null;
  if (bytes.length !== STATE_LENGTH && bytes.length !== EXTENDED_STATE_LENGTH) return null;

  const raw = Uint8Array.from(bytes);
  if (!samsungAcValidChecksum(raw)) return null;
  return raw.length === EXTENDED_STATE_LENGTH ? parseSamsungAcExtended(raw) : parseSamsungAcState(raw);
}
