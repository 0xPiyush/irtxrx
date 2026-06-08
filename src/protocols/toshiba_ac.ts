/**
 * Toshiba A/C IR protocol encoder and decoder. (TOSHIBA_AC)
 *
 * Ported from IRremoteESP8266 `ir_Toshiba.cpp` (the `IRToshibaAC` class).
 * Also used by several rebadged Carrier 38/42-series units. The message is
 * variable length: a 9-byte "normal" form, or a 10-byte form carrying the
 * Eco/Turbo byte. The first four bytes are stored as bit-inverted pairs
 * (`byte1=~byte0`, `byte3=~byte2`) and the final byte is an XOR checksum.
 *
 * Swing is communicated by a separate short (7-byte) message on real remotes
 * and is out of scope here.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1205
 */

import { sendGenericBytes, xorBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Toshiba.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 4400;
const HDR_SPACE = 4300;
const BIT_MARK = 580;
const ONE_SPACE = 1600;
const ZERO_SPACE = 490;
const GAP = 7400; // kToshibaAcUsualGap

const STATE_LENGTH = 9; // "normal" form
const STATE_LENGTH_LONG = 10; // Eco/Turbo form
const MIN_LENGTH = 6;
const TEMP_MIN = 17;
const TEMP_MAX = 30;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const ToshibaAcMode = {
  Auto: 0,
  Cool: 1,
  Dry: 2,
  Heat: 3,
  Fan: 4,
} as const;
export type ToshibaAcModeValue = (typeof ToshibaAcMode)[keyof typeof ToshibaAcMode];
const MODE_OFF = 7;

export const ToshibaAcFan = {
  Auto: 0,
  Min: 1,
  Med: 3,
  Max: 5,
} as const;
export type ToshibaAcFanValue = (typeof ToshibaAcFan)[keyof typeof ToshibaAcFan];

export const ToshibaAcModel = {
  A: 0,
  B: 1,
} as const;
export type ToshibaAcModelValue = (typeof ToshibaAcModel)[keyof typeof ToshibaAcModel];

const ECO_TURBO_TURBO = 1;
const ECO_TURBO_ECONO = 3;

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface ToshibaAcState {
  model?: ToshibaAcModelValue;
  power?: boolean;
  /** Temperature in °C (17–30). */
  temp?: number;
  mode?: ToshibaAcModeValue;
  /** Fan speed (0 Auto, 1 Min, 2, 3 Med, 4, 5 Max). */
  fan?: number;
  filter?: boolean;
  turbo?: boolean;
  econo?: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ---------------------------------------------------------------------------
// Build raw state
// ---------------------------------------------------------------------------

/** Build the raw Toshiba A/C state (9 or 10 bytes) from a state object. */
export function buildToshibaAcRaw(state: ToshibaAcState): Uint8Array {
  // Turbo/Econo force the long (10-byte) form; they're mutually exclusive
  // (Econo wins, mirroring the last-setter-wins class behaviour). Powering off
  // clears them on a real remote, so the long form only applies when on.
  const power = state.power ?? true;
  const econo = (state.econo ?? false) && power;
  const turbo = (state.turbo ?? false) && !econo && power;
  const long = econo || turbo;
  const length = long ? STATE_LENGTH_LONG : STATE_LENGTH;

  const raw = new Uint8Array(length);
  raw[0] = 0xf2;
  raw[2] = ((length - MIN_LENGTH) & 0x0f) | (((state.model ?? ToshibaAcModel.A) & 0x0f) << 4);
  raw[4] = 0x01 | ((long ? 1 : 0) << 3); // const bit0 + LongMsg bit (ShortMsg stays 0)
  raw[5] = ((clamp(state.temp ?? 22, TEMP_MIN, TEMP_MAX) - TEMP_MIN) & 0x0f) << 4; // Swing nibble = 0

  const mode = power ? (state.mode ?? ToshibaAcMode.Auto) : MODE_OFF;
  const logicalFan = clamp(state.fan ?? ToshibaAcFan.Auto, 0, ToshibaAcFan.Max);
  const storedFan = logicalFan === 0 ? 0 : logicalFan + 1;
  raw[6] = (mode & 0x07) | ((storedFan & 0x07) << 5);
  raw[7] = (state.filter ? 1 : 0) << 4;
  if (long) raw[8] = econo ? ECO_TURBO_ECONO : ECO_TURBO_TURBO;

  // Invert the leading byte pairs, then XOR-checksum the whole message.
  raw[1] = ~raw[0] & 0xff;
  raw[3] = ~raw[2] & 0xff;
  raw[length - 1] = xorBytes(raw, 0, length - 1);
  return raw;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a raw Toshiba A/C payload into IR timings. */
export function encodeToshibaAcRaw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP,
    data, msbFirst: true, repeat,
  });
}

/** Encode a Toshiba A/C state into raw IR timings. */
export function sendToshibaAc(state: ToshibaAcState, repeat: number = 0): number[] {
  return encodeToshibaAcRaw(buildToshibaAcRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Validate the inverted leading byte pairs and the XOR checksum. */
export function toshibaAcValidChecksum(raw: Uint8Array): boolean {
  if (raw.length < MIN_LENGTH) return false;
  if (raw[0] !== 0xf2) return false;
  if (raw[1] !== ((~raw[0]!) & 0xff)) return false;
  if (raw[3] !== ((~raw[2]!) & 0xff)) return false;
  if (((raw[2]! & 0x0f) + MIN_LENGTH) !== raw.length) return false;
  return raw[raw.length - 1] === xorBytes(raw, 0, raw.length - 1);
}

/** Parse a validated Toshiba A/C state into a state object. */
export function parseToshibaAcState(raw: Uint8Array): ToshibaAcState {
  const mode = raw[6]! & 0x07;
  const storedFan = (raw[6]! >> 5) & 0x07;
  const long = raw.length === STATE_LENGTH_LONG;
  const eco = long ? raw[8]! : 0;
  return {
    model: ((raw[2]! >> 4) & 0x0f) as ToshibaAcModelValue,
    power: mode !== MODE_OFF,
    temp: ((raw[5]! >> 4) & 0x0f) + TEMP_MIN,
    mode: (mode === MODE_OFF ? ToshibaAcMode.Auto : mode) as ToshibaAcModeValue,
    fan: storedFan === 0 ? 0 : storedFan - 1,
    filter: !!((raw[7]! >> 4) & 1),
    turbo: eco === ECO_TURBO_TURBO,
    econo: eco === ECO_TURBO_ECONO,
  };
}

/**
 * Decode raw IR timings as a Toshiba A/C message (9 or 10 bytes).
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeToshibaAc(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): ToshibaAcState | null {
  for (const length of [STATE_LENGTH, STATE_LENGTH_LONG]) {
    const frame = matchGenericBytes(
      timings, offset, timings.length - offset, length,
      HDR_MARK, HDR_SPACE,
      BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
      BIT_MARK, GAP,
      true, undefined, undefined, true, headerOptional,
    );
    if (frame && toshibaAcValidChecksum(frame.data)) return parseToshibaAcState(frame.data);
  }
  return null;
}
