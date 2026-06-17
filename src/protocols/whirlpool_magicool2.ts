/**
 * Whirlpool Magicool A/C — NEC-style remote variant. (WHIRLPOOL_MAGICOOL2)
 *
 * NOT in IRremoteESP8266. A second "Whirlpool Magicool" remote (distinct model
 * from {@link ./whirlpool_magicool.ts}, which is a 14-byte ~3346/1350 frame).
 * Reverse-engineered from real captures (appliance ec8089b9…). Unrelated wire
 * format: an **NEC-style** 8514/4241 header, bit mark ~550µs, one-space ~1650µs,
 * zero-space ~520µs, ending in a bit-mark trailer.
 *
 * Wire format: a 15-byte (120-bit) state sent **LSB-first**, byte 0 = `0x56`
 * signature, byte 14 = a **nibble-sum** of bytes 0..13.
 *
 * Byte layout (LSB-first):
 * ```
 * 56 | T | 00 | F3 | MF | P/SW | F6 | 00 | F8 | 00 00 00 00 00 | CK
 *  0   1   2    3    4    5      6    7    8    9 ........ 13     14
 * ```
 * - byte 0 = `0x56`, byte 2 = `0x00`, bytes 7, 9–13 = `0x00` — constant.
 * - byte 1 = `tempC + 0x5C` (16–30 °C; `0x6B`=15 appears as the 6th-Sense auto value).
 * - byte 3: bit 0 = **Silent** (forces fan→Low), bit 1 = **6th-Sense**,
 *   bit 3 = **Dim** (display dimmed), bit 4 = **Eco**.
 * - byte 4 = `(mode << 4) | fan` — mode Cool `2` / Dry `3` / Fan `5`,
 *   fan Auto `0` / High `1` / Low `2` / Med `3`.
 * - byte 5: bit 1 = **power** (1 = on), bits[4:2] = **swing** (1–5 = louvre steps
 *   bottom→top, 6 = full), bit 0 = **6th-Sense**. Power-off frame = `0xc0`.
 * - byte 6: bit 1 = **6th-Sense**, bit 3 = **Sleep**.
 * - byte 8: bit 7 = **Turbo**.
 * - byte 14 = `Σ nibbles(bytes 0..13) & 0xFF`.
 *
 * 6th-Sense, Turbo and Silent have no "off" frame (cleared by changing mode).
 * Silent is not yet mapped. Timer is not yet mapped.
 */

import { sendGenericBytes, sumNibbles } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — measured from real Magicool (NEC-style) captures
// ---------------------------------------------------------------------------

const HDR_MARK = 8514;
const HDR_SPACE = 4240;
const BIT_MARK = 550;
const ONE_SPACE = 1650;
const ZERO_SPACE = 540;
const MIN_GAP = 100000; // inter-frame gap unobserved in captures
const TOLERANCE = 35; // real captures jitter heavily; signature + nibble-sum gate false matches

export const WHIRLPOOL_MAGICOOL2_STATE_LENGTH = 15;
const TEMP_OFFSET = 0x5c;
const POWER_OFF_BYTE5 = 0xc0;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const WhirlpoolMagicool2Mode = {
  Cool: 0x2,
  Dry: 0x3,
  Fan: 0x5,
} as const;
export type WhirlpoolMagicool2ModeValue = (typeof WhirlpoolMagicool2Mode)[keyof typeof WhirlpoolMagicool2Mode];

export const WhirlpoolMagicool2Fan = {
  Auto: 0,
  High: 1,
  Low: 2,
  Med: 3,
} as const;
export type WhirlpoolMagicool2FanValue = (typeof WhirlpoolMagicool2Fan)[keyof typeof WhirlpoolMagicool2Fan];

/** Vertical swing: five fixed louvre positions (bottom→top) or Full (oscillate). No "off". */
export const WhirlpoolMagicool2Swing = {
  Pos1: 1,
  Pos2: 2,
  Pos3: 3,
  Pos4: 4,
  Pos5: 5,
  Full: 6,
} as const;
export type WhirlpoolMagicool2SwingValue = (typeof WhirlpoolMagicool2Swing)[keyof typeof WhirlpoolMagicool2Swing];

const MIN_TEMP = 15; // 15 = the 6th-Sense "auto" value; normal range is 16–30
const MAX_TEMP = 30;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface WhirlpoolMagicool2State {
  /** Power. Defaults to true. */
  power?: boolean;
  mode?: WhirlpoolMagicool2ModeValue;
  /** Temperature in °C (16–30; 15 is the 6th-Sense auto value). */
  temp?: number;
  fan?: WhirlpoolMagicool2FanValue;
  swing?: WhirlpoolMagicool2SwingValue;
  /** 6th Sense auto-everything mode (no off frame — cleared by changing mode). */
  sixthSense?: boolean;
  /** Turbo / Jet boost (no off frame — cleared by changing mode). */
  turbo?: boolean;
  /** Eco / energy-saving. */
  eco?: boolean;
  /** Silent / quiet operation (forces fan to Low). */
  silent?: boolean;
  /** Sleep. */
  sleep?: boolean;
  /** Display backlight lit. Defaults to true; the "Dim" button turns it off. */
  light?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Verify the byte-14 nibble-sum checksum of a Magicool2 state. */
export function whirlpoolMagicool2ValidChecksum(raw: Uint8Array): boolean {
  if (raw.length < WHIRLPOOL_MAGICOOL2_STATE_LENGTH) return false;
  return raw[14] === sumNibbles(raw, 0, 14);
}

const VALID_MODES = new Set<number>(Object.values(WhirlpoolMagicool2Mode));
const VALID_FANS = new Set<number>(Object.values(WhirlpoolMagicool2Fan));
const VALID_SWINGS = new Set<number>(Object.values(WhirlpoolMagicool2Swing));

// byte 3
const SILENT_BIT = 0x01;
const SIXTH_BIT3 = 0x02;
const DIM_BIT = 0x08;
const ECO_BIT = 0x10;
// byte 5
const POWER_BIT = 0x02;
const SIXTH_BIT5 = 0x01;
// byte 6
const SIXTH_BIT6 = 0x02;
const SLEEP_BIT = 0x08;
// byte 8
const TURBO_BIT = 0x80;

// ---------------------------------------------------------------------------
// Build raw 15-byte state
// ---------------------------------------------------------------------------

/**
 * Build the raw 15-byte Magicool2 state.
 *
 * Defaults: power on, Cool, 24 °C, fan Auto, swing Pos1, display on, all
 * features off.
 */
export function buildWhirlpoolMagicool2Raw(state: WhirlpoolMagicool2State): Uint8Array {
  const raw = new Uint8Array(WHIRLPOOL_MAGICOOL2_STATE_LENGTH);
  raw[0] = 0x56;

  const mode = VALID_MODES.has(state.mode as number) ? state.mode! : WhirlpoolMagicool2Mode.Cool;
  const fan = VALID_FANS.has(state.fan as number) ? state.fan! : WhirlpoolMagicool2Fan.Auto;
  const swing = VALID_SWINGS.has(state.swing as number) ? state.swing! : WhirlpoolMagicool2Swing.Pos1;
  const sixth = state.sixthSense ?? false;
  const power = state.power ?? true;

  raw[1] = clamp(Math.round(state.temp ?? 24), MIN_TEMP, MAX_TEMP) + TEMP_OFFSET;
  raw[3] = (state.silent ?? false ? SILENT_BIT : 0) | (sixth ? SIXTH_BIT3 : 0) | (state.light ?? true ? 0 : DIM_BIT) | (state.eco ?? false ? ECO_BIT : 0);
  raw[4] = (mode << 4) | fan;
  raw[5] = power ? (POWER_BIT | (swing << 2) | (sixth ? SIXTH_BIT5 : 0)) : POWER_OFF_BYTE5;
  raw[6] = (sixth ? SIXTH_BIT6 : 0) | (state.sleep ?? false ? SLEEP_BIT : 0);
  raw[8] = state.turbo ?? false ? TURBO_BIT : 0;

  raw[14] = sumNibbles(raw, 0, 14);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw 15-byte Magicool2 state into IR timings. */
export function encodeWhirlpoolMagicool2Raw(raw: Uint8Array, repeat: number = 0): number[] {
  const out: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    const frame = sendGenericBytes({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: MIN_GAP, data: raw, msbFirst: false,
    });
    for (const t of frame) out.push(t);
  }
  return out;
}

/** Build + encode a Magicool2 state into IR timings. */
export function sendWhirlpoolMagicool2(state: WhirlpoolMagicool2State, repeat: number = 0): number[] {
  return encodeWhirlpoolMagicool2Raw(buildWhirlpoolMagicool2Raw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 15-byte Magicool2 state. */
export function parseWhirlpoolMagicool2State(raw: Uint8Array): WhirlpoolMagicool2State {
  const power = !!(raw[5]! & POWER_BIT);
  const swingRaw = (raw[5]! >> 2) & 0x07;
  return {
    power,
    mode: (raw[4]! >> 4) as WhirlpoolMagicool2ModeValue,
    temp: raw[1]! - TEMP_OFFSET,
    fan: (raw[4]! & 0x0f) as WhirlpoolMagicool2FanValue,
    // Swing bits are zero in the power-off frame; default to Pos1 there.
    swing: (VALID_SWINGS.has(swingRaw) ? swingRaw : WhirlpoolMagicool2Swing.Pos1) as WhirlpoolMagicool2SwingValue,
    sixthSense: !!(raw[3]! & SIXTH_BIT3),
    turbo: !!(raw[8]! & TURBO_BIT),
    eco: !!(raw[3]! & ECO_BIT),
    silent: !!(raw[3]! & SILENT_BIT),
    sleep: !!(raw[6]! & SLEEP_BIT),
    light: !(raw[3]! & DIM_BIT),
  };
}

/** Reject frames whose constant/structural bytes don't match. */
function structureOk(raw: Uint8Array): boolean {
  if (raw[0] !== 0x56 || raw[2] !== 0x00) return false;
  if (raw[7] !== 0x00 || raw[9] !== 0x00 || raw[10] !== 0x00) return false;
  if (raw[11] !== 0x00 || raw[12] !== 0x00 || raw[13] !== 0x00) return false;
  if (raw[1]! < MIN_TEMP + TEMP_OFFSET || raw[1]! > MAX_TEMP + TEMP_OFFSET) return false;
  if (!VALID_MODES.has(raw[4]! >> 4) || !VALID_FANS.has(raw[4]! & 0x0f)) return false;
  if ((raw[3]! & ~(SILENT_BIT | SIXTH_BIT3 | DIM_BIT | ECO_BIT)) !== 0) return false;
  if ((raw[6]! & ~(SIXTH_BIT6 | SLEEP_BIT)) !== 0) return false;
  if ((raw[8]! & ~TURBO_BIT) !== 0) return false;
  // byte 5: either the power-off code, or power-on with valid swing and no stray bits.
  if (raw[5]! !== POWER_OFF_BYTE5) {
    if ((raw[5]! & POWER_BIT) === 0) return false; // power-on bit must be set
    if ((raw[5]! & 0xe0) !== 0) return false; // bits 5,6,7 unused when on
    if (!VALID_SWINGS.has((raw[5]! >> 2) & 0x07)) return false;
  }
  return true;
}

/**
 * Decode raw IR timings as a Whirlpool Magicool (NEC-style) A/C message.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeWhirlpoolMagicool2(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): WhirlpoolMagicool2State | null {
  const result = matchGenericBytes(
    timings, offset, timings.length - offset, WHIRLPOOL_MAGICOOL2_STATE_LENGTH,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MIN_GAP, false, TOLERANCE, 0, false, headerOptional,
  );
  if (!result) return null;
  if (!structureOk(result.data)) return null;
  if (!whirlpoolMagicool2ValidChecksum(result.data)) return null;
  return parseWhirlpoolMagicool2State(result.data);
}
