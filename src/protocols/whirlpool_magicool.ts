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
 * 57 4c 50 | 00 | E | 2P*T | DM | 31-T | t SSS FFF | 00 00 | NN NN | CK
 *  0  1  2    3   4   5      6    7       8           9 10    11 12   13
 * ```
 * - bytes 0–2 = `57 4c 50`, byte 3 = `00`, bytes 9–10 = `00` — constant.
 * - byte 4: bit 6 = **Eco**, bit 7 = **Silent**.
 * - byte 5: base `0x20`, bit 2 = **power**, bit 6 = **turbo**.
 * - byte 6: bits[3:0] = **mode** (Cool 3 / Dry 2 / Fan 7 / 6th-Sense 8),
 *   bit 5 = **display** lit (the "Dim" button clears it).
 * - byte 7 = `31 - tempC` (16–30 °C).
 * - byte 8: bit 6 = **turbo**, bits[5:3] = **swing** (off 0, steps 1–5, full 7),
 *   bits[2:0] = **fan** (auto 0, sleep 1, low 2, med 3, high 5).
 * - bytes 11–12 = a remote rolling counter/nonce the unit ignores (preserved on
 *   decode for lossless round-trips; emitted as `0x0c00` by default).
 * - byte 13 = `sum(bytes 0..12) & 0xFF`.
 *
 * Turbo and 6th-Sense have no "off" frame — they are cleared by changing mode.
 * The timer (likely in bytes 9–10) is not yet mapped; timer frames don't decode.
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
const ZERO_SPACE = 320; // centred on the captured zero-space spread (~244–396µs)
const MIN_GAP = 100000; // inter-frame gap unobserved in captures; default large gap
// Real captures jitter heavily (±~30%); the "WLP" signature + checksum make a
// false match implausible, so we decode generously.
const TOLERANCE = 35;

export const WHIRLPOOL_MAGICOOL_STATE_LENGTH = 14;
const DEFAULT_NONCE = 0x0c00; // bytes 11-12 as first observed on the remote

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const WhirlpoolMagicoolMode = {
  Dry: 0x2,
  Cool: 0x3,
  Fan: 0x7,
  /** Whirlpool "6th Sense" — auto-everything mode (cleared by changing mode). */
  SixthSense: 0x8,
} as const;
export type WhirlpoolMagicoolModeValue = (typeof WhirlpoolMagicoolMode)[keyof typeof WhirlpoolMagicoolMode];

export const WhirlpoolMagicoolFan = {
  Auto: 0,
  /** Quiet "sleep" fan curve — the Sleep button selects this fan value. */
  Sleep: 1,
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

const ECO_BIT = 0x40; // byte 4
const SILENT_BIT = 0x80; // byte 4
const POWER_BIT = 0x04; // byte 5
const TURBO_BIT = 0x40; // byte 5 and byte 8
const BYTE5_BASE = 0x20; // byte 5 constant bit
const DISPLAY_BIT = 0x20; // byte 6

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
  /** Turbo / Jet boost (no off frame — cleared by changing mode). */
  turbo?: boolean;
  /** Eco / energy-saving. */
  eco?: boolean;
  /** Silent / quiet operation. */
  silent?: boolean;
  /** Display backlight lit. Defaults to true; the "Dim" button turns it off. */
  light?: boolean;
  /**
   * Bytes 11–12 remote rolling counter/nonce (16-bit, big-endian). The unit
   * ignores it; preserved here so a decoded frame re-encodes byte-for-byte.
   * Defaults to 0x0c00.
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
 * Defaults: power on, Cool, 24 °C, fan Auto, swing Off, display on, all
 * features off, nonce 0x0c00.
 */
export function buildWhirlpoolMagicoolRaw(state: WhirlpoolMagicoolState): Uint8Array {
  const raw = new Uint8Array(WHIRLPOOL_MAGICOOL_STATE_LENGTH);
  // Constant signature byte.
  raw[0] = 0x57;
  raw[1] = 0x4c;
  raw[2] = 0x50;

  const mode = VALID_MODES.has(state.mode as number) ? state.mode! : WhirlpoolMagicoolMode.Cool;
  const fan = VALID_FANS.has(state.fan as number) ? state.fan! : WhirlpoolMagicoolFan.Auto;
  const swing = VALID_SWINGS.has(state.swing as number) ? state.swing! : WhirlpoolMagicoolSwing.Off;
  const turbo = state.turbo ?? false;
  const nonce = (state.remoteState ?? DEFAULT_NONCE) & 0xffff;

  raw[4] = (state.eco ?? false ? ECO_BIT : 0) | (state.silent ?? false ? SILENT_BIT : 0);
  raw[5] = BYTE5_BASE | ((state.power ?? true) ? POWER_BIT : 0) | (turbo ? TURBO_BIT : 0);
  raw[6] = ((state.light ?? true) ? DISPLAY_BIT : 0) | mode;
  raw[7] = 31 - clamp(Math.round(state.temp ?? 24), MIN_TEMP, MAX_TEMP);
  raw[8] = (turbo ? TURBO_BIT : 0) | (swing << 3) | fan;
  raw[11] = (nonce >> 8) & 0xff;
  raw[12] = nonce & 0xff;

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
    power: !!(raw[5]! & POWER_BIT),
    mode: (raw[6]! & 0x0f) as WhirlpoolMagicoolModeValue,
    temp: 31 - raw[7]!,
    fan: (raw[8]! & 0x07) as WhirlpoolMagicoolFanValue,
    swing: ((raw[8]! >> 3) & 0x07) as WhirlpoolMagicoolSwingValue,
    turbo: !!(raw[5]! & TURBO_BIT),
    eco: !!(raw[4]! & ECO_BIT),
    silent: !!(raw[4]! & SILENT_BIT),
    light: !!(raw[6]! & DISPLAY_BIT),
    remoteState: (raw[11]! << 8) | raw[12]!,
  };
}

/** Reject frames whose constant/structural bytes don't match. */
function structureOk(raw: Uint8Array): boolean {
  if (raw[0] !== 0x57 || raw[1] !== 0x4c || raw[2] !== 0x50) return false;
  if (raw[3] !== 0x00) return false;
  if (raw[9] !== 0x00 || raw[10] !== 0x00) return false; // timer (bytes 9-10) not yet mapped
  if ((raw[4]! & ~(ECO_BIT | SILENT_BIT)) !== 0) return false; // byte 4: only eco/silent bits
  if ((raw[5]! & ~(POWER_BIT | TURBO_BIT)) !== BYTE5_BASE) return false; // byte 5: base + power/turbo
  if ((raw[6]! & 0xd0) !== 0) return false; // byte 6: bits 4,6,7 unused
  if (!VALID_MODES.has(raw[6]! & 0x0f)) return false;
  if ((raw[8]! & 0x80) !== 0) return false; // byte 8 bit 7 unused
  if (!VALID_FANS.has(raw[8]! & 0x07)) return false;
  if (!VALID_SWINGS.has((raw[8]! >> 3) & 0x07)) return false;
  // Turbo is mirrored in byte 5 bit 6 and byte 8 bit 6 — they must agree.
  if (((raw[5]! & TURBO_BIT) !== 0) !== ((raw[8]! & TURBO_BIT) !== 0)) return false;
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
