/**
 * Panasonic 27-byte A/C IR protocol encoder and decoder. (PANASONIC_AC)
 *
 * Ported from IRremoteESP8266 `ir_Panasonic.cpp` / `ir_Panasonic.h`.
 * Models: NKE, DKE/DKW/PKR, JKE, LKE, CKP, RKR series.
 *
 * Wire format: two sections (8 bytes then 19 bytes), each framed by a
 * 3456/1728 header and a footer, sent LSB-first. The first section ends with a
 * 10ms section gap. Both sections begin with the signature `0x02 0x20`. The
 * final byte is a byte-sum checksum seeded with 0xF4.
 *
 * The six remote models differ in a handful of marker bytes and in where the
 * Quiet/Powerful bits live (swapped on CKP/RKR), so this module reproduces the
 * `IRPanasonicAc` class's model-aware setter sequence to stay byte-exact.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Panasonic.cpp
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Panasonic.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3456;
const HDR_SPACE = 1728;
const BIT_MARK = 432;
const ONE_SPACE = 1296;
const ZERO_SPACE = 432;
const SECTION_GAP = 10000;
const MESSAGE_GAP = 100000; // kDefaultMessageGap
const TOLERANCE = 40; // kPanasonicAcTolerance — much higher than usual (issue #540)

const STATE_LENGTH = 27;
/** Short "command" frame: section 1 (8 bytes) + an 8-byte section 2. Used for
 *  one-shot commands (e.g. sleep/powerful/convertible on some remotes). Shares
 *  section 1, the section signatures, timing, and the byte-sum checksum with
 *  the full 27-byte frame — only the length differs. Like the vendor's
 *  IRPanasonicAc, its section-2 payload is treated as an opaque command. */
const SHORT_STATE_LENGTH = 16;
const SECTION1_LENGTH = 8;
const CHECKSUM_INIT = 0xf4;

const TEMP_MIN = 16;
const TEMP_MAX = 30;
const FAN_MODE_TEMP = 27;
const FAN_DELTA = 3;
const TIME_MAX = 23 * 60 + 59; // 1439
const TIME_SPECIAL = 0x600;

/** Reset state from `IRPanasonicAc::stateReset` (the known-good sequence). */
const KNOWN_GOOD: readonly number[] = [
  0x02, 0x20, 0xe0, 0x04, 0x00, 0x00, 0x00, 0x06, 0x02,
  0x20, 0xe0, 0x04, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x0e, 0xe0, 0x00, 0x00, 0x81, 0x00, 0x00, 0x00,
];

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const PanasonicAcMode = {
  Auto: 0,
  Dry: 2,
  Cool: 3,
  Heat: 4,
  Fan: 6,
} as const;
export type PanasonicAcModeValue = (typeof PanasonicAcMode)[keyof typeof PanasonicAcMode];

export const PanasonicAcFan = {
  Min: 0,
  Low: 1,
  Med: 2,
  High: 3,
  Max: 4,
  Auto: 7,
} as const;
export type PanasonicAcFanValue = (typeof PanasonicAcFan)[keyof typeof PanasonicAcFan];

export const PanasonicAcSwingV = {
  Highest: 0x1,
  High: 0x2,
  Middle: 0x3,
  Low: 0x4,
  Lowest: 0x5,
  Auto: 0xf,
} as const;
export type PanasonicAcSwingVValue = (typeof PanasonicAcSwingV)[keyof typeof PanasonicAcSwingV];

export const PanasonicAcSwingH = {
  Middle: 0x6,
  FullLeft: 0x9,
  Left: 0xa,
  Right: 0xb,
  FullRight: 0xc,
  Auto: 0xd,
} as const;
export type PanasonicAcSwingHValue = (typeof PanasonicAcSwingH)[keyof typeof PanasonicAcSwingH];

export const PanasonicAcModel = {
  Lke: 1,
  Nke: 2,
  Dke: 3,
  Jke: 4,
  Ckp: 5,
  Rkr: 6,
} as const;
export type PanasonicAcModelValue = (typeof PanasonicAcModel)[keyof typeof PanasonicAcModel];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface PanasonicAcState {
  model?: PanasonicAcModelValue;
  power?: boolean;
  mode?: PanasonicAcModeValue;
  /** Temperature in °C (16–30). */
  temp?: number;
  fan?: PanasonicAcFanValue;
  swingV?: PanasonicAcSwingVValue;
  swingH?: PanasonicAcSwingHValue;
  quiet?: boolean;
  powerful?: boolean;
  /** Ion/nanoe filter — only honoured by the DKE model. */
  ion?: boolean;
  /** Clock time in minutes since midnight (0 = unset). */
  clock?: number;
  /** On-timer time in minutes since midnight. */
  onTimer?: number;
  onTimerEnabled?: boolean;
  /** Off-timer time in minutes since midnight. */
  offTimer?: number;
  offTimerEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Bit / checksum helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function setBit(raw: Uint8Array, idx: number, bit: number, on: boolean): void {
  if (on) raw[idx] = raw[idx]! | (1 << bit);
  else raw[idx] = raw[idx]! & ~(1 << bit);
}

function setBits(raw: Uint8Array, idx: number, off: number, size: number, val: number): void {
  const mask = ((1 << size) - 1) << off;
  raw[idx] = (raw[idx]! & ~mask) | ((val << off) & mask);
}

function getBits(raw: Uint8Array, idx: number, off: number, size: number): number {
  return (raw[idx]! >> off) & ((1 << size) - 1);
}

/** Matches `IRPanasonicAc::calcChecksum`: byte sum seeded with 0xF4. */
function calcChecksum(raw: Uint8Array, length: number = STATE_LENGTH): number {
  let sum = CHECKSUM_INIT;
  for (let i = 0; i < length - 1; i++) sum += raw[i]!;
  return sum & 0xff;
}

// ---------------------------------------------------------------------------
// Model detection — mirrors IRPanasonicAc::getModel
// ---------------------------------------------------------------------------

/** Detect the remote model from raw bytes (0 = unknown). */
export function detectPanasonicAcModel(raw: Uint8Array): number {
  if (raw[23] === 0x89) return PanasonicAcModel.Rkr;
  if (raw[17] === 0x00) {
    if ((raw[21]! & 0x10) && (raw[23]! & 0x01)) return PanasonicAcModel.Ckp;
    if (raw[23]! & 0x80) return PanasonicAcModel.Jke;
  }
  if (raw[17] === 0x06 && (raw[13]! & 0x0f) === 0x02) return PanasonicAcModel.Lke;
  if (raw[23] === 0x01) return PanasonicAcModel.Dke;
  if (raw[17] === 0x06) return PanasonicAcModel.Nke;
  return 0; // Unknown
}

// ---------------------------------------------------------------------------
// Time field helpers
// ---------------------------------------------------------------------------

function setTime(raw: Uint8Array, idx: number, mins: number, roundDown: boolean): void {
  let corrected = Math.min(mins, TIME_MAX);
  if (roundDown) corrected -= corrected % 10;
  if (mins === TIME_SPECIAL) corrected = TIME_SPECIAL;
  raw[idx] = corrected & 0xff;
  setBits(raw, idx + 1, 0, 3, corrected >> 8);
}

function getTime(raw: Uint8Array, idx: number): number {
  const result = (getBits(raw, idx + 1, 0, 3) << 8) + raw[idx]!;
  return result === TIME_SPECIAL ? 0 : result;
}

// ---------------------------------------------------------------------------
// Build raw 27-byte state — emulates the IRPanasonicAc setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 27-byte Panasonic AC state from a state object.
 *
 * Mirrors `stateReset()` then the C++ setter order used by the cross-check
 * runner, including model-dependent side effects (swapped Quiet/Powerful bits,
 * model-gated horizontal swing and ion).
 */
export function buildPanasonicAcRaw(state: PanasonicAcState): Uint8Array {
  const raw = Uint8Array.from(KNOWN_GOOD);
  let savedTemp = 25; // mirrors IRPanasonicAc::_temp
  let savedSwingH: number = PanasonicAcSwingH.Middle; // mirrors _swingh

  const model = (): number => detectPanasonicAcModel(raw);

  const setTemp = (celsius: number, remember: boolean): void => {
    const temp = clamp(celsius, TEMP_MIN, TEMP_MAX);
    if (remember) savedTemp = temp;
    setBits(raw, 14, 1, 5, temp);
  };

  const setMode = (desired: number): void => {
    let mode: number = PanasonicAcMode.Auto;
    switch (desired) {
      case PanasonicAcMode.Fan:
        setTemp(FAN_MODE_TEMP, false);
        mode = desired;
        break;
      case PanasonicAcMode.Auto:
      case PanasonicAcMode.Cool:
      case PanasonicAcMode.Heat:
      case PanasonicAcMode.Dry:
        mode = desired;
        setTemp(savedTemp, true);
        break;
    }
    raw[13] = raw[13]! & 0x0f;
    setBits(raw, 13, 4, 4, mode);
  };

  const setFan = (speed: number): void => {
    switch (speed) {
      case PanasonicAcFan.Min:
      case PanasonicAcFan.Low:
      case PanasonicAcFan.Med:
      case PanasonicAcFan.High:
      case PanasonicAcFan.Max:
      case PanasonicAcFan.Auto:
        setBits(raw, 16, 4, 4, speed + FAN_DELTA);
        break;
      default:
        setBits(raw, 16, 4, 4, PanasonicAcFan.Auto + FAN_DELTA);
    }
  };

  const setSwingVertical = (elevation: number): void => {
    let e = elevation;
    if (e !== PanasonicAcSwingV.Auto) e = clamp(e, PanasonicAcSwingV.Highest, PanasonicAcSwingV.Lowest);
    setBits(raw, 16, 0, 4, e);
  };

  const setSwingHorizontal = (dir: number): void => {
    switch (dir) {
      case PanasonicAcSwingH.Auto:
      case PanasonicAcSwingH.Middle:
      case PanasonicAcSwingH.FullLeft:
      case PanasonicAcSwingH.Left:
      case PanasonicAcSwingH.Right:
      case PanasonicAcSwingH.FullRight:
        break;
      default:
        return;
    }
    savedSwingH = dir;
    let direction = dir;
    switch (model()) {
      case PanasonicAcModel.Dke:
      case PanasonicAcModel.Rkr:
        break;
      case PanasonicAcModel.Nke:
      case PanasonicAcModel.Lke:
        direction = PanasonicAcSwingH.Middle;
        break;
      default:
        return;
    }
    setBits(raw, 17, 0, 4, direction);
  };

  const getIon = (): boolean => model() === PanasonicAcModel.Dke && !!(raw[22]! & 0x01);
  const setIon = (on: boolean): void => {
    if (model() === PanasonicAcModel.Dke) setBit(raw, 22, 0, on);
  };

  const setPowerful = (on: boolean): void => {
    const offset = (model() === PanasonicAcModel.Rkr || model() === PanasonicAcModel.Ckp) ? 0 : 5;
    if (on) setQuiet(false);
    setBit(raw, 21, offset, on);
  };

  function setQuiet(on: boolean): void {
    const offset = (model() === PanasonicAcModel.Rkr || model() === PanasonicAcModel.Ckp) ? 5 : 0;
    if (on) setPowerful(false);
    setBit(raw, 21, offset, on);
  }

  const setModel = (m: number): void => {
    switch (m) {
      case PanasonicAcModel.Dke:
      case PanasonicAcModel.Jke:
      case PanasonicAcModel.Lke:
      case PanasonicAcModel.Nke:
      case PanasonicAcModel.Ckp:
      case PanasonicAcModel.Rkr:
        break;
      default:
        return;
    }
    raw[13] = raw[13]! & 0xf0;
    raw[17] = 0x00;
    raw[21] = raw[21]! & 0b11101111;
    raw[23] = 0x81;
    raw[25] = 0x00;

    switch (m) {
      case PanasonicAcModel.Lke:
        raw[13] = raw[13]! | 0x02;
        raw[17] = 0x06;
        break;
      case PanasonicAcModel.Dke:
        raw[23] = 0x01;
        raw[25] = 0x06;
        setSwingHorizontal(savedSwingH); // model check is built-in
        break;
      case PanasonicAcModel.Nke:
        raw[17] = 0x06;
        break;
      case PanasonicAcModel.Jke:
        break;
      case PanasonicAcModel.Ckp:
        raw[21] = raw[21]! | 0x10;
        raw[23] = 0x01;
        break;
      case PanasonicAcModel.Rkr:
        raw[13] = raw[13]! | 0x08;
        raw[23] = 0x89;
        break;
    }
    setIon(getIon());
  };

  const setOnTimer = (mins: number, enable: boolean): void => {
    setBit(raw, 13, 1, enable);
    setTime(raw, 18, mins, true);
  };

  const setOffTimer = (mins: number, enable: boolean): void => {
    let corrected = Math.min(mins, TIME_MAX);
    corrected -= corrected % 10;
    if (mins === TIME_SPECIAL) corrected = TIME_SPECIAL;
    setBit(raw, 13, 2, enable);
    setBits(raw, 19, 4, 4, corrected);
    setBits(raw, 20, 0, 7, corrected >> 4);
  };

  // Mirror the cross-check runner's setter order exactly.
  setModel(state.model ?? PanasonicAcModel.Dke);
  setMode(state.mode ?? PanasonicAcMode.Auto);
  setTemp(state.temp ?? 25, true);
  setFan(state.fan ?? PanasonicAcFan.Auto);
  setSwingVertical(state.swingV ?? PanasonicAcSwingV.Auto);
  setSwingHorizontal(state.swingH ?? PanasonicAcSwingH.Middle);
  setQuiet(state.quiet ?? false);
  setPowerful(state.powerful ?? false);
  setIon(state.ion ?? false);
  setTime(raw, 24, state.clock ?? 0, false); // setClock
  setOnTimer(state.onTimer ?? 0, state.onTimerEnabled ?? false);
  setOffTimer(state.offTimer ?? 0, state.offTimerEnabled ?? false);
  setBit(raw, 13, 0, state.power ?? false); // setPower

  raw[STATE_LENGTH - 1] = calcChecksum(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 27-byte Panasonic AC state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendPanasonicAC`: two sections (8 + 19
 * bytes), LSB-first, the first closed by a 10ms section gap.
 */
export function encodePanasonicAcRaw(data: Uint8Array, repeat: number = 0): number[] {
  const result: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    const section1 = sendGenericBytes({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: SECTION_GAP,
      data: data.subarray(0, SECTION1_LENGTH), msbFirst: false,
    });
    const section2 = sendGenericBytes({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: MESSAGE_GAP,
      data: data.subarray(SECTION1_LENGTH), msbFirst: false,
    });
    for (const t of section1) result.push(t);
    for (const t of section2) result.push(t);
  }
  return result;
}

/** Encode a Panasonic AC state into raw IR timings. */
export function sendPanasonicAc(state: PanasonicAcState, repeat: number = 0): number[] {
  return encodePanasonicAcRaw(buildPanasonicAcRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 27-byte Panasonic AC state into a state object. */
export function parsePanasonicAcState(raw: Uint8Array): PanasonicAcState {
  const m = detectPanasonicAcModel(raw);
  const ckpLike = m === PanasonicAcModel.Rkr || m === PanasonicAcModel.Ckp;
  return {
    model: (m || PanasonicAcModel.Dke) as PanasonicAcModelValue,
    power: !!(raw[13]! & 0x01),
    mode: getBits(raw, 13, 4, 4) as PanasonicAcModeValue,
    temp: getBits(raw, 14, 1, 5),
    fan: (getBits(raw, 16, 4, 4) - FAN_DELTA) as PanasonicAcFanValue,
    swingV: getBits(raw, 16, 0, 4) as PanasonicAcSwingVValue,
    swingH: getBits(raw, 17, 0, 4) as PanasonicAcSwingHValue,
    quiet: !!(raw[21]! & (1 << (ckpLike ? 5 : 0))),
    powerful: !!(raw[21]! & (1 << (ckpLike ? 0 : 5))),
    ion: m === PanasonicAcModel.Dke && !!(raw[22]! & 0x01),
    clock: getTime(raw, 24),
    onTimer: getTime(raw, 18),
    onTimerEnabled: !!(raw[13]! & 0x02),
    offTimer: (() => {
      const result = (getBits(raw, 20, 0, 7) << 4) | getBits(raw, 19, 4, 4);
      return result === TIME_SPECIAL ? 0 : result;
    })(),
    offTimerEnabled: !!(raw[13]! & 0x04),
  };
}

/**
 * Decode raw IR timings as a Panasonic AC (27-byte) message.
 *
 * Matches the two-section structure, the `0x02 0x20` section signatures, and
 * the byte-sum checksum.
 *
 * @returns Decoded state, or null on mismatch / failed compliance.
 */
export function decodePanasonicAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): PanasonicAcState | null {
  // Section 1 — 8 bytes, closed by the 10ms section gap (exact match).
  const s1 = matchGenericBytes(
    timings, offset, timings.length - offset, SECTION1_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, SECTION_GAP,
    false, TOLERANCE, 0, false, headerOptional,
  );
  if (!s1) return null;

  // Section 2 — remaining 19 bytes, closed by the inter-message gap (atLeast).
  const s2 = matchGenericBytes(
    timings, offset + s1.used, timings.length - offset - s1.used, STATE_LENGTH - SECTION1_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MESSAGE_GAP,
    true, TOLERANCE, 0, false, false,
  );
  if (!s2) return null;

  const raw = new Uint8Array(STATE_LENGTH);
  raw.set(s1.data, 0);
  raw.set(s2.data, SECTION1_LENGTH);

  // Section signatures + checksum gate false matches.
  if (raw[0] !== 0x02 || raw[1] !== 0x20 || raw[8] !== 0x02 || raw[9] !== 0x20) return null;
  if (raw[STATE_LENGTH - 1] !== calcChecksum(raw)) return null;

  return parsePanasonicAcState(raw);
}

/**
 * Decode a Panasonic AC *short* (128-bit / 16-byte) command frame.
 *
 * This is the same two-section structure as {@link decodePanasonicAc} but with
 * an 8-byte section 2. The section-2 payload is a one-shot command whose fields
 * are not modelled (the vendor library leaves it opaque too), so the validated
 * 16-byte frame is returned verbatim. Re-encode with {@link encodePanasonicAcRaw}.
 *
 * @returns The raw 16-byte frame, or null on mismatch / failed compliance.
 */
export function decodePanasonicAcShort(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Uint8Array | null {
  // Section 1 — 8 bytes, closed by the 10ms section gap (exact match).
  const s1 = matchGenericBytes(
    timings, offset, timings.length - offset, SECTION1_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, SECTION_GAP,
    false, TOLERANCE, 0, false, headerOptional,
  );
  if (!s1) return null;

  // Section 2 — remaining 8 bytes, closed by the inter-message gap (atLeast).
  const s2 = matchGenericBytes(
    timings, offset + s1.used, timings.length - offset - s1.used, SHORT_STATE_LENGTH - SECTION1_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MESSAGE_GAP,
    true, TOLERANCE, 0, false, false,
  );
  if (!s2) return null;

  const raw = new Uint8Array(SHORT_STATE_LENGTH);
  raw.set(s1.data, 0);
  raw.set(s2.data, SECTION1_LENGTH);

  // Section signatures + checksum gate false matches.
  if (raw[0] !== 0x02 || raw[1] !== 0x20 || raw[8] !== 0x02 || raw[9] !== 0x20) return null;
  if (raw[SHORT_STATE_LENGTH - 1] !== calcChecksum(raw, SHORT_STATE_LENGTH)) return null;

  return raw;
}
