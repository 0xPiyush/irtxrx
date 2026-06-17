/**
 * Whirlpool Magicool A/C IR protocol encoder and decoder. (WHIRLPOOL_MAGICOOL)
 *
 * NOT a port of IRremoteESP8266 — the Magicool protocol is unsupported upstream
 * (only an open discussion, crankyoldgit/IRremoteESP8266#2193). This is a clean
 * reverse-engineering from real remote captures (appliance ec8089b9…, remotes
 * branded "Whirlpool" / "Magicool"; also seen on Marq and Indian-market
 * Kelvinator rebadges). It is distinct from the vendor `WHIRLPOOL_AC` protocol
 * (that one is 168-bit / 21-byte with an ~8950/4484 header).
 *
 * Wire format: a 14-byte (112-bit) state sent **LSB-first** behind a ~3346/1350
 * header, each bit a ~580µs mark + space (one ≈1064µs, zero ≈300µs), ending in a
 * bit-mark trailer. There is a fixed `0x57 0x4C 0x50` ("WLP") signature and a
 * plain modulo-256 byte-sum checksum in byte 13.
 *
 * Byte layout (LSB-first):
 * ```
 * 57 4c 50 | 00 00 | 2P | 2M | 31-T | SSSFFF | 00 00 | 0c | NN | CK
 *  0  1  2    3  4   5    6    7       8        9 10    11   12   13
 * ```
 * - bytes 0–2 = `57 4c 50`, bytes 3–4 = `00 00`, bytes 9–10 = `00 00`,
 *   byte 11 = `0x0c` — all constant.
 * - byte 5 = `0x20 | (power << 2)` — power on `0x24`, off `0x20`.
 * - byte 6 = `0x20 | mode` — Cool `3`, Dry `2`, Fan `7` (no Heat on this unit).
 * - byte 7 = `31 - tempC` (16–30 °C).
 * - byte 8 = `(swing << 3) | fan` — swing bits[5:3] (off 0, steps 1–5, full 7),
 *   fan bits[2:0] (auto 0, low 2, med 3, high 5).
 * - byte 12 = a session nonce/counter the unit ignores (preserved on decode for
 *   lossless round-trips; emitted as `0x00` by default).
 * - byte 13 = `sum(bytes 0..12) & 0xFF`.
 */

import { sendGenericBytes, sumBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — measured from real Magicool remote captures
// ---------------------------------------------------------------------------

const HDR_MARK = 3346;
const HDR_SPACE = 1350;
const BIT_MARK = 580;
const ONE_SPACE = 1064;
const ZERO_SPACE = 300;
const MIN_GAP = 100000; // inter-frame gap unobserved in captures; default large gap
const TOLERANCE = 30; // captures drift well past the 25% default

export const WHIRLPOOL_MAGICOOL_STATE_LENGTH = 14;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const WhirlpoolMagicoolMode = {
  Dry: 0x2,
  Cool: 0x3,
  Fan: 0x7,
} as const;
export type WhirlpoolMagicoolModeValue = (typeof WhirlpoolMagicoolMode)[keyof typeof WhirlpoolMagicoolMode];

export const WhirlpoolMagicoolFan = {
  Auto: 0,
  Low: 2,
  Med: 3,
  High: 5,
} as const;
export type WhirlpoolMagicoolFanValue = (typeof WhirlpoolMagicoolFan)[keyof typeof WhirlpoolMagicoolFan];

/** Vertical swing: Off, five fixed louvre positions, or Full (oscillate). */
export const WhirlpoolMagicoolSwing = {
  Off: 0,
  Pos1: 1,
  Pos2: 2,
  Pos3: 3,
  Pos4: 4,
  Pos5: 5,
  Full: 7,
} as const;
export type WhirlpoolMagicoolSwingValue = (typeof WhirlpoolMagicoolSwing)[keyof typeof WhirlpoolMagicoolSwing];

const MIN_TEMP = 16;
const MAX_TEMP = 30;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface WhirlpoolMagicoolState {
  /** Power. Defaults to true. */
  power?: boolean;
  mode?: WhirlpoolMagicoolModeValue;
  /** Temperature in °C (16–30). */
  temp?: number;
  fan?: WhirlpoolMagicoolFanValue;
  swing?: WhirlpoolMagicoolSwingValue;
  /**
   * Byte-12 remote nonce/counter. The unit ignores it; preserved here so a
   * decoded frame re-encodes byte-for-byte. Defaults to 0.
   */
  remoteState?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Verify the byte-13 checksum (sum of bytes 0–12) of a Magicool state. */
export function whirlpoolMagicoolValidChecksum(raw: Uint8Array): boolean {
  if (raw.length < WHIRLPOOL_MAGICOOL_STATE_LENGTH) return false;
  return raw[13] === (sumBytes(raw, 0, 13) & 0xff);
}

const VALID_MODES = new Set<number>(Object.values(WhirlpoolMagicoolMode));
const VALID_FANS = new Set<number>(Object.values(WhirlpoolMagicoolFan));
const VALID_SWINGS = new Set<number>(Object.values(WhirlpoolMagicoolSwing));

// ---------------------------------------------------------------------------
// Build raw 14-byte state
// ---------------------------------------------------------------------------

/**
 * Build the raw 14-byte Magicool state from a state object.
 *
 * Defaults: power on, Cool, 24 °C, fan Auto, swing Off, nonce 0.
 */
export function buildWhirlpoolMagicoolRaw(state: WhirlpoolMagicoolState): Uint8Array {
  const raw = new Uint8Array(WHIRLPOOL_MAGICOOL_STATE_LENGTH);
  // Constant signature / framing bytes.
  raw[0] = 0x57;
  raw[1] = 0x4c;
  raw[2] = 0x50;
  raw[11] = 0x0c;

  const mode = VALID_MODES.has(state.mode as number) ? state.mode! : WhirlpoolMagicoolMode.Cool;
  const fan = VALID_FANS.has(state.fan as number) ? state.fan! : WhirlpoolMagicoolFan.Auto;
  const swing = VALID_SWINGS.has(state.swing as number) ? state.swing! : WhirlpoolMagicoolSwing.Off;

  raw[5] = 0x20 | ((state.power ?? true) ? 0x04 : 0x00);
  raw[6] = 0x20 | mode;
  raw[7] = 31 - clamp(Math.round(state.temp ?? 24), MIN_TEMP, MAX_TEMP);
  raw[8] = (swing << 3) | fan;
  raw[12] = (state.remoteState ?? 0) & 0xff;

  raw[13] = sumBytes(raw, 0, 13) & 0xff;
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw 14-byte Magicool state into IR timings. */
export function encodeWhirlpoolMagicoolRaw(raw: Uint8Array, repeat: number = 0): number[] {
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

/** Build + encode a Magicool state into IR timings. */
export function sendWhirlpoolMagicool(state: WhirlpoolMagicoolState, repeat: number = 0): number[] {
  return encodeWhirlpoolMagicoolRaw(buildWhirlpoolMagicoolRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 14-byte Magicool state. */
export function parseWhirlpoolMagicoolState(raw: Uint8Array): WhirlpoolMagicoolState {
  return {
    power: !!(raw[5]! & 0x04),
    mode: (raw[6]! & 0x0f) as WhirlpoolMagicoolModeValue,
    temp: 31 - raw[7]!,
    fan: (raw[8]! & 0x07) as WhirlpoolMagicoolFanValue,
    swing: ((raw[8]! >> 3) & 0x07) as WhirlpoolMagicoolSwingValue,
    remoteState: raw[12]!,
  };
}

/** Reject frames whose constant signature/framing bytes don't match. */
function structureOk(raw: Uint8Array): boolean {
  if (raw[0] !== 0x57 || raw[1] !== 0x4c || raw[2] !== 0x50) return false;
  if (raw[3] !== 0x00 || raw[4] !== 0x00) return false;
  if (raw[9] !== 0x00 || raw[10] !== 0x00 || raw[11] !== 0x0c) return false;
  if ((raw[5]! & ~0x04) !== 0x20) return false; // byte 5 = 0x20 | power
  if ((raw[6]! & 0xf0) !== 0x20) return false; // byte 6 high nibble
  if ((raw[8]! & 0xc0) !== 0x00) return false; // byte 8 top 2 bits unused
  if (!VALID_MODES.has(raw[6]! & 0x0f)) return false;
  return true;
}

/**
 * Decode raw IR timings as a Whirlpool Magicool A/C message.
 *
 * Matches the header + 14 LSB-first bytes + trailer mark, then validates the
 * "WLP" signature, constant framing bytes and the modulo-256 checksum.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeWhirlpoolMagicool(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): WhirlpoolMagicoolState | null {
  const result = matchGenericBytes(
    timings, offset, timings.length - offset, WHIRLPOOL_MAGICOOL_STATE_LENGTH,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MIN_GAP, false, TOLERANCE, 0, false, headerOptional,
  );
  if (!result) return null;
  if (!structureOk(result.data)) return null;
  if (!whirlpoolMagicoolValidChecksum(result.data)) return null;
  return parseWhirlpoolMagicoolState(result.data);
}
