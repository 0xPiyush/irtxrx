/**
 * Kelvinator A/C IR protocol encoder and decoder. (KELVINATOR)
 *
 * Ported from IRremoteESP8266 `ir_Kelvinator.cpp` / `ir_Kelvinator.h`.
 * Models: YALIF remote, KSV* A/C series (also Gree YAPOF3 / Sharp YB1FA remotes).
 *
 * Wire format: a 16-byte state sent LSB-first as **two back-to-back command
 * sequences**. Each sequence is:
 *   1. a header (9010/4505) + 4 "command" bytes (no footer),
 *   2. a 3-bit command-block footer carrying the constant `0b010`,
 *      followed by a bit-mark + ≈20ms gap,
 *   3. 4 "data" bytes, followed by a bit-mark + ≈40ms gap.
 * The 2nd command sequence's first three bytes are a copy of the 1st's. Each
 * 8-byte block ends with a 4-bit nibble checksum (bias 10) in the high nibble
 * of its last byte.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Kelvinator.cpp
 */

import { encodeData } from "../encode.js";
import { matchData, matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Kelvinator.cpp exactly (tick = 85µs)
// ---------------------------------------------------------------------------

const TICK = 85;
const HDR_MARK = 106 * TICK; // 9010
const HDR_SPACE = 53 * TICK; // 4505
const BIT_MARK = 8 * TICK; // 680
const ONE_SPACE = 18 * TICK; // 1530
const ZERO_SPACE = 6 * TICK; // 510
const GAP_SPACE = 235 * TICK; // 19975

const CMD_FOOTER = 2; // 0b010
const CMD_FOOTER_BITS = 3;
const CHECKSUM_START = 10;

export const KELVINATOR_STATE_LENGTH = 16;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const KelvinatorMode = {
  Auto: 0,
  Cool: 1,
  Dry: 2,
  Fan: 3,
  Heat: 4,
} as const;
export type KelvinatorModeValue = (typeof KelvinatorMode)[keyof typeof KelvinatorMode];

/** Fan speed: 0 = Auto, 1–5 = increasing speed. */
export const KelvinatorFan = {
  Auto: 0,
  Min: 1,
  Low: 2,
  Medium: 3,
  High: 4,
  Max: 5,
} as const;
export type KelvinatorFanValue = (typeof KelvinatorFan)[keyof typeof KelvinatorFan];

/** Vertical swing positions (the `SwingV` nibble). */
export const KelvinatorSwingV = {
  Off: 0b0000,
  Auto: 0b0001,
  Highest: 0b0010,
  UpperMiddle: 0b0011,
  Middle: 0b0100,
  LowerMiddle: 0b0101,
  Lowest: 0b0110,
  LowAuto: 0b0111,
  MiddleAuto: 0b1001,
  HighAuto: 0b1011,
} as const;
export type KelvinatorSwingVValue = (typeof KelvinatorSwingV)[keyof typeof KelvinatorSwingV];

const TEMP_MIN = 16;
const TEMP_MAX = 30;
const AUTO_TEMP = 25;
const FAN_MAX = 5;
const BASIC_FAN_MAX = 3;

/** The "automatic" SwingV positions (low bit set ⇒ auto-style position). */
const SWINGV_AUTO_SET = new Set<number>([
  KelvinatorSwingV.Auto,
  KelvinatorSwingV.LowAuto,
  KelvinatorSwingV.MiddleAuto,
  KelvinatorSwingV.HighAuto,
]);
/** The fixed-vane (non-auto) SwingV positions. */
const SWINGV_FIXED_SET = new Set<number>([
  KelvinatorSwingV.Highest,
  KelvinatorSwingV.UpperMiddle,
  KelvinatorSwingV.Middle,
  KelvinatorSwingV.LowerMiddle,
  KelvinatorSwingV.Lowest,
]);

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface KelvinatorState {
  power?: boolean;
  mode?: KelvinatorModeValue;
  /** Temperature in °C (16–30). */
  temp?: number;
  /** Fan speed 0 (auto) – 5. */
  fan?: KelvinatorFanValue;
  /** Vertical swing position; see {@link KelvinatorSwingV}. */
  swingV?: KelvinatorSwingVValue;
  /** Horizontal swing on/off. */
  swingH?: boolean;
  quiet?: boolean;
  /** Ion filter / air purifier. */
  ionFilter?: boolean;
  /** LED display on the unit. */
  light?: boolean;
  /** XFan / dry-after-off (only valid in Cool or Dry mode). */
  xfan?: boolean;
  turbo?: boolean;
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

function setBit(raw: Uint8Array, idx: number, bit: number, on: boolean): void {
  if (on) raw[idx] = raw[idx]! | (1 << bit);
  else raw[idx] = raw[idx]! & ~(1 << bit);
}

// ---------------------------------------------------------------------------
// Checksum — matches IRKelvinatorAC::calcBlockChecksum
// ---------------------------------------------------------------------------

/** Checksum one 8-byte block: bias 10 + low nibbles of bytes 0–3 + high
 *  nibbles of bytes 4–6, mod 16. Stored in the high nibble of byte 7. */
function calcBlockChecksum(raw: Uint8Array, base: number): number {
  let sum = CHECKSUM_START;
  for (let i = 0; i < 4; i++) sum += raw[base + i]! & 0x0f;
  for (let i = 4; i < 7; i++) sum += (raw[base + i]! >> 4) & 0x0f;
  return sum & 0x0f;
}

/** Verify both block checksums of a 16-byte Kelvinator state. */
export function kelvinatorValidChecksum(raw: Uint8Array): boolean {
  for (let base = 0; base + 7 < raw.length; base += 8) {
    if (getBits(raw, base + 7, 4, 4) !== calcBlockChecksum(raw, base)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Build raw 16-byte state — mirrors the IRKelvinatorAC setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 16-byte Kelvinator state from a state object.
 *
 * Reproduces `stateReset()` then the C++ setter order used by the cross-check
 * runner, including the Auto/Dry → 25°C default, the fan-change-resets-turbo
 * rule, the SwingAuto derivation, and the `fixup()` block duplication +
 * checksums.
 */
export function buildKelvinatorRaw(state: KelvinatorState): Uint8Array {
  const raw = new Uint8Array(KELVINATOR_STATE_LENGTH);
  // stateReset()
  raw[3] = 0x50;
  raw[11] = 0x70;

  const setTemp = (degrees: number): void =>
    setBits(raw, 1, 0, 4, clamp(degrees, TEMP_MIN, TEMP_MAX) - TEMP_MIN);

  const getMode = (): number => getBits(raw, 0, 0, 3);

  const setMode = (mode: number): void => {
    switch (mode) {
      case KelvinatorMode.Auto:
      case KelvinatorMode.Dry:
        setTemp(AUTO_TEMP); // falls through to set the mode
        setBits(raw, 0, 0, 3, mode);
        break;
      case KelvinatorMode.Heat:
      case KelvinatorMode.Cool:
      case KelvinatorMode.Fan:
        setBits(raw, 0, 0, 3, mode);
        break;
      default:
        setTemp(AUTO_TEMP);
        setBits(raw, 0, 0, 3, KelvinatorMode.Auto);
    }
  };

  const getFan = (): number => getBits(raw, 14, 4, 3);

  const setTurbo = (on: boolean): void => setBit(raw, 2, 4, on);

  const setFan = (speed: number): void => {
    const fan = Math.min(FAN_MAX, speed);
    if (fan !== getFan()) {
      setBits(raw, 0, 4, 2, Math.min(BASIC_FAN_MAX, fan)); // BasicFan
      setBits(raw, 14, 4, 3, fan); // Fan
      setTurbo(false); // changing fan cancels turbo
    }
  };

  const getSwingH = (): boolean => !!getBits(raw, 4, 4, 1);
  const getSwingV = (): number => getBits(raw, 4, 0, 4);

  const setSwingVertical = (automatic: boolean, position: number): void => {
    setBit(raw, 0, 6, automatic || getSwingH()); // SwingAuto
    let pos = position;
    if (!automatic) {
      if (!SWINGV_FIXED_SET.has(position)) pos = KelvinatorSwingV.Off;
    } else {
      if (!SWINGV_AUTO_SET.has(position)) pos = KelvinatorSwingV.Auto;
    }
    setBits(raw, 4, 0, 4, pos); // SwingV
  };

  const setSwingHorizontal = (on: boolean): void => {
    setBit(raw, 4, 4, on); // SwingH
    setBit(raw, 0, 6, on || (getSwingV() & 0b1) === 1); // SwingAuto
  };

  // Setter order mirrors the cross-check runner exactly.
  setBit(raw, 0, 3, state.power ?? false); // Power
  setMode(state.mode ?? KelvinatorMode.Auto);
  setTemp(state.temp ?? AUTO_TEMP);
  setFan(state.fan ?? KelvinatorFan.Auto);
  // The SwingV position implies its auto-ness; pass that through faithfully.
  const swingV = state.swingV ?? KelvinatorSwingV.Off;
  setSwingVertical(SWINGV_AUTO_SET.has(swingV), swingV);
  setSwingHorizontal(state.swingH ?? false);
  setBit(raw, 12, 7, state.quiet ?? false); // Quiet
  setBit(raw, 2, 6, state.ionFilter ?? false); // IonFilter
  setBit(raw, 2, 5, state.light ?? false); // Light
  setBit(raw, 2, 7, state.xfan ?? false); // XFan
  setTurbo(state.turbo ?? false);

  // fixup(): XFan only valid in Cool/Dry; duplicate block; checksums.
  const m = getMode();
  if (m !== KelvinatorMode.Cool && m !== KelvinatorMode.Dry) setBit(raw, 2, 7, false);
  raw[8] = raw[0]!;
  raw[9] = raw[1]!;
  raw[10] = raw[2]!;
  setBits(raw, 7, 4, 4, calcBlockChecksum(raw, 0)); // Sum1
  setBits(raw, 15, 4, 4, calcBlockChecksum(raw, 8)); // Sum2
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode 8 data bits of a byte, LSB-first. */
function bits8(byte: number): number[] {
  return encodeData(BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, BigInt(byte), 8, false);
}

/**
 * Encode a raw 16-byte Kelvinator state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendKelvinator`: two command sequences, each
 * being (header + 4 command bytes) + (3-bit `0b010` footer + bit-mark + gap) +
 * (4 data bytes + bit-mark + 2×gap), all LSB-first.
 */
export function encodeKelvinatorRaw(raw: Uint8Array, repeat: number = 0): number[] {
  const out: number[] = [];
  const footerBits = encodeData(BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, BigInt(CMD_FOOTER), CMD_FOOTER_BITS, false);
  const pushBytes = (start: number): void => {
    for (let i = start; i < start + 4; i++) for (const t of bits8(raw[i]!)) out.push(t);
  };

  for (let r = 0; r <= repeat; r++) {
    // Command sequence #1
    out.push(HDR_MARK, HDR_SPACE);
    pushBytes(0);
    for (const t of footerBits) out.push(t);
    out.push(BIT_MARK, GAP_SPACE);
    pushBytes(4);
    out.push(BIT_MARK, GAP_SPACE * 2);
    // Command sequence #2
    out.push(HDR_MARK, HDR_SPACE);
    pushBytes(8);
    for (const t of footerBits) out.push(t);
    out.push(BIT_MARK, GAP_SPACE);
    pushBytes(12);
    out.push(BIT_MARK, GAP_SPACE * 2);
  }
  return out;
}

/** Build + encode a Kelvinator state into IR timings. */
export function sendKelvinator(state: KelvinatorState, repeat: number = 0): number[] {
  return encodeKelvinatorRaw(buildKelvinatorRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 16-byte Kelvinator state into a state object. */
export function parseKelvinatorState(raw: Uint8Array): KelvinatorState {
  const mode = getBits(raw, 0, 0, 3) as KelvinatorModeValue;
  return {
    power: !!getBits(raw, 0, 3, 1),
    mode,
    temp: getBits(raw, 1, 0, 4) + TEMP_MIN,
    fan: getBits(raw, 14, 4, 3) as KelvinatorFanValue,
    swingV: getBits(raw, 4, 0, 4) as KelvinatorSwingVValue,
    swingH: !!getBits(raw, 4, 4, 1),
    quiet: !!getBits(raw, 12, 7, 1),
    ionFilter: !!getBits(raw, 2, 6, 1),
    light: !!getBits(raw, 2, 5, 1),
    xfan: !!getBits(raw, 2, 7, 1),
    turbo: !!getBits(raw, 2, 4, 1),
  };
}

/**
 * Decode raw IR timings as a Kelvinator A/C message.
 *
 * Mirrors `IRrecv::decodeKelvinator`: for each of the two command sequences,
 * match (header + 4 command bytes), the 3-bit `0b010` footer, then (4 data
 * bytes framed by the inter-block gap). Validates both block checksums.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeKelvinator(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): KelvinatorState | null {
  let pos = offset;
  const bytes: number[] = [];

  for (let s = 0; s < 2; s++) {
    // Command block: header + 4 bytes (no footer mark of its own).
    const cmd = matchGenericBytes(
      timings, pos, timings.length - pos, 4,
      HDR_MARK, HDR_SPACE,
      BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
      0, 0,
      false, undefined, undefined, false, s === 0 ? headerOptional : false,
    );
    if (!cmd) return null;
    for (const b of cmd.data) bytes.push(b);
    pos += cmd.used;

    // 3-bit command-block footer (must equal 0b010). The trailing bit-mark +
    // gap are consumed as the data block's "header" below.
    const ft = matchData(timings, pos, CMD_FOOTER_BITS, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, undefined, undefined, false, true);
    if (!ft.success || ft.data !== BigInt(CMD_FOOTER)) return null;
    pos += ft.used;

    // Data block: 4 bytes framed by the bit-mark/gap (leading) and bit-mark/
    // 2×gap (trailing). The 2nd sequence's gap is matched "at least".
    const dat = matchGenericBytes(
      timings, pos, timings.length - pos, 4,
      BIT_MARK, GAP_SPACE,
      BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
      BIT_MARK, GAP_SPACE * 2,
      s > 0, undefined, undefined, false, false,
    );
    if (!dat) return null;
    for (const b of dat.data) bytes.push(b);
    pos += dat.used;
  }

  if (bytes.length !== KELVINATOR_STATE_LENGTH) return null;
  const raw = Uint8Array.from(bytes);
  if (!kelvinatorValidChecksum(raw)) return null;
  return parseKelvinatorState(raw);
}
