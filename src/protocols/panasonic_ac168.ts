/**
 * Panasonic Window A/C IR protocol encoder and decoder. (PANASONIC_AC168)
 *
 * A 21-byte (168-bit) two-section Panasonic-family frame — distinct from the
 * 27-byte {@link ./panasonic_ac.ts}. It shares Panasonic's timing, the
 * `02 20 E0 04` section signatures, and a byte-sum section-2 checksum, but the
 * section 2 is only 13 bytes and the field layout differs, so the 27-byte
 * decoder rejects it. There is no IRremoteESP8266 reference (identify.cpp
 * reports UNKNOWN); reverse-engineered from labelled captures (session 09bb3a1a).
 *
 * Frame layout (LSB-first):
 *
 *   Section 1 (bytes 0-7):  02 20 E0 04 00 00 00 06   constant
 *   Section 2 (bytes 8-20): 02 20 E0 04               constant signature
 *     byte 12  mode (bits 4-7) | fan (bits 0-3)
 *     byte 13  temperature - 16  (16-30 -> 0-14)
 *     byte 14  bit0 power, bit6 powerful, bit7 swing
 *     bytes 15-19  00 60 60 00 06   constant
 *     byte 20  checksum = sum(bytes 8-19) & 0xFF
 */

import { sumBytes, sendGenericBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — shared with the 27-byte Panasonic AC frame
// ---------------------------------------------------------------------------

const HDR_MARK = 3456;
const HDR_SPACE = 1728;
const BIT_MARK = 432;
const ONE_SPACE = 1296;
const ZERO_SPACE = 432;
const SECTION_GAP = 10000;
const MESSAGE_GAP = 100000;
const TOLERANCE = 40; // kPanasonicAcTolerance

export const PANASONIC_AC168_STATE_LENGTH = 21;
const SECTION1_LENGTH = 8;

export const PANASONIC_AC168_MIN_TEMP = 16;
export const PANASONIC_AC168_MAX_TEMP = 30;

// ---------------------------------------------------------------------------
// Mode / fan vocabularies (raw wire values)
// ---------------------------------------------------------------------------

/** Operating mode — byte 12 bits 4-7. */
export const PanasonicAc168Mode = {
  Dry: 0x2,
  Cool: 0x3,
  Fan: 0x4,
} as const;
export type PanasonicAc168ModeValue = (typeof PanasonicAc168Mode)[keyof typeof PanasonicAc168Mode];

/** Fan speed — byte 12 bits 0-3. */
export const PanasonicAc168Fan = {
  Low: 0x3,
  Medium: 0x5,
  High: 0x7,
  Auto: 0xa,
} as const;
export type PanasonicAc168FanValue = (typeof PanasonicAc168Fan)[keyof typeof PanasonicAc168Fan];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface PanasonicAc168State {
  power?: boolean;
  mode?: PanasonicAc168ModeValue;
  fan?: PanasonicAc168FanValue;
  /** °C, 16-30. */
  temp?: number;
  swing?: boolean;
  powerful?: boolean;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** The two constant sections, minus the mutable section-2 bytes (12-14) and
 *  the checksum (20). */
function defaultState(): Uint8Array {
  const raw = new Uint8Array(PANASONIC_AC168_STATE_LENGTH);
  raw.set([0x02, 0x20, 0xe0, 0x04, 0x00, 0x00, 0x00, 0x06], 0);
  raw.set([0x02, 0x20, 0xe0, 0x04], 8);
  raw[16] = 0x60;
  raw[17] = 0x60;
  raw[19] = 0x06;
  return raw;
}

export function buildPanasonicAc168Raw(state: PanasonicAc168State): Uint8Array {
  const raw = defaultState();

  const mode = state.mode ?? PanasonicAc168Mode.Cool;
  const fan = state.fan ?? PanasonicAc168Fan.Auto;
  raw[12] = ((mode & 0x0f) << 4) | (fan & 0x0f);

  const temp = Math.min(Math.max(state.temp ?? 24, PANASONIC_AC168_MIN_TEMP), PANASONIC_AC168_MAX_TEMP);
  raw[13] = (temp - PANASONIC_AC168_MIN_TEMP) & 0xff;

  raw[14] =
    ((state.power ?? false) ? 0x01 : 0) |
    ((state.powerful ?? false) ? 0x40 : 0) |
    ((state.swing ?? false) ? 0x80 : 0);

  // Section-2 checksum: sum of bytes 8-19.
  raw[20] = sumBytes(raw, SECTION1_LENGTH, PANASONIC_AC168_STATE_LENGTH - 1);

  return raw;
}

// ---------------------------------------------------------------------------
// Send / encode
// ---------------------------------------------------------------------------

export function sendPanasonicAc168(state: PanasonicAc168State, repeat = 0): number[] {
  return encodePanasonicAc168Raw(buildPanasonicAc168Raw(state), repeat);
}

export function encodePanasonicAc168Raw(data: Uint8Array, repeat = 0): number[] {
  const result: number[] = [];
  const common = {
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, msbFirst: false,
  };
  for (let r = 0; r <= repeat; r++) {
    const s1 = sendGenericBytes({ ...common, gap: SECTION_GAP, data: data.subarray(0, SECTION1_LENGTH) });
    for (let i = 0; i < s1.length; i++) result.push(s1[i]!);
    const s2 = sendGenericBytes({ ...common, gap: MESSAGE_GAP, data: data.subarray(SECTION1_LENGTH) });
    for (let i = 0; i < s2.length; i++) result.push(s2[i]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Panasonic Window (21-byte) message.
 *
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodePanasonicAc168(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): PanasonicAc168State | null {
  // Section 1 — 8 bytes, closed by the 10ms section gap (exact match).
  const s1 = matchGenericBytes(
    timings, offset, timings.length - offset, SECTION1_LENGTH,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, SECTION_GAP,
    false, TOLERANCE, 0, false, headerOptional,
  );
  if (!s1) return null;

  // Section 2 — remaining 13 bytes, closed by the inter-message gap (atLeast).
  const section2Len = PANASONIC_AC168_STATE_LENGTH - SECTION1_LENGTH;
  const s2 = matchGenericBytes(
    timings, offset + s1.used, timings.length - offset - s1.used, section2Len,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MESSAGE_GAP,
    true, TOLERANCE, 0, false, false,
  );
  if (!s2) return null;

  const raw = new Uint8Array(PANASONIC_AC168_STATE_LENGTH);
  raw.set(s1.data, 0);
  raw.set(s2.data, SECTION1_LENGTH);

  // Section signatures + checksum gate false matches.
  if (raw[0] !== 0x02 || raw[1] !== 0x20 || raw[8] !== 0x02 || raw[9] !== 0x20) return null;
  if (raw[PANASONIC_AC168_STATE_LENGTH - 1] !== sumBytes(raw, SECTION1_LENGTH, PANASONIC_AC168_STATE_LENGTH - 1)) return null;

  return {
    power: !!(raw[14]! & 0x01),
    mode: ((raw[12]! >> 4) & 0x0f) as PanasonicAc168ModeValue,
    fan: (raw[12]! & 0x0f) as PanasonicAc168FanValue,
    temp: (raw[13]! & 0xff) + PANASONIC_AC168_MIN_TEMP,
    swing: !!(raw[14]! & 0x80),
    powerful: !!(raw[14]! & 0x40),
  };
}
