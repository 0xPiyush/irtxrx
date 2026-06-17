/**
 * Rhoss A/C IR protocol encoder and decoder. (RHOSS)
 *
 * Ported from IRremoteESP8266 `ir_Rhoss.cpp` / `ir_Rhoss.h` — full coverage of
 * the `IRRhossAc` class and the `sendRhoss` / `decodeRhoss` wire format. Models:
 * Rhoss Idrowall split A/Cs.
 *
 * Wire format: a 12-byte state sent LSB-first behind a 3042/4248 header. The
 * data frame ends with a bit-mark + zero-space, then an extra bit-mark + ≈100ms
 * gap. byte 0 is `0xAA`, byte 2 is `0x60`, byte 6 is `0x54` (fixed); byte 11 is
 * a plain sum of bytes 0–10.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Rhoss.cpp
 */

import { sendGenericBytes, sumBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

const HDR_MARK = 3042;
const HDR_SPACE = 4248;
const BIT_MARK = 648;
const ONE_SPACE = 1545;
const ZERO_SPACE = 457;
const GAP = 100000;

export const RHOSS_STATE_LENGTH = 12;

export const RhossMode = { Heat: 0b0001, Cool: 0b0010, Dry: 0b0011, Fan: 0b0100, Auto: 0b0101 } as const;
export type RhossModeValue = (typeof RhossMode)[keyof typeof RhossMode];
export const RhossFan = { Auto: 0b00, Min: 0b01, Med: 0b10, Max: 0b11 } as const;
export type RhossFanValue = (typeof RhossFan)[keyof typeof RhossFan];

const TEMP_MIN = 16;
const TEMP_MAX = 30;
const POWER_ON = 0b10;
const POWER_OFF = 0b01;

export interface RhossState {
  power?: boolean;
  mode?: RhossModeValue;
  /** Temperature in °C (16–30). */
  temp?: number;
  fan?: RhossFanValue;
  swing?: boolean;
}

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

/** Verify the byte-11 checksum (sum of bytes 0–10) of a Rhoss state. */
export function rhossValidChecksum(raw: Uint8Array): boolean {
  return raw[RHOSS_STATE_LENGTH - 1] === (sumBytes(raw, 0, RHOSS_STATE_LENGTH - 1) & 0xff);
}

function isMode(m: number | undefined): boolean {
  return m === RhossMode.Heat || m === RhossMode.Cool || m === RhossMode.Dry ||
    m === RhossMode.Fan || m === RhossMode.Auto;
}
function isFan(f: number | undefined): boolean {
  return f === RhossFan.Auto || f === RhossFan.Min || f === RhossFan.Med || f === RhossFan.Max;
}

/** Build the raw 12-byte Rhoss state (mirrors `stateReset` + setters). */
export function buildRhossRaw(state: RhossState): Uint8Array {
  const raw = new Uint8Array(RHOSS_STATE_LENGTH);
  raw[0] = 0xaa;
  raw[2] = 0x60;
  raw[6] = 0x54;

  setBits(raw, 1, 0, 4, clamp(state.temp ?? 21, TEMP_MIN, TEMP_MAX) - TEMP_MIN); // Temp
  setBits(raw, 4, 0, 2, isFan(state.fan) ? state.fan! : RhossFan.Auto); // Fan
  setBits(raw, 4, 4, 4, isMode(state.mode) ? state.mode! : RhossMode.Cool); // Mode
  setBits(raw, 5, 0, 1, (state.swing ?? false) ? 1 : 0); // Swing
  setBits(raw, 5, 6, 2, (state.power ?? false) ? POWER_ON : POWER_OFF); // Power

  raw[11] = sumBytes(raw, 0, RHOSS_STATE_LENGTH - 1) & 0xff;
  return raw;
}

/** Encode a raw 12-byte Rhoss state into IR timings (`IRsend::sendRhoss`). */
export function encodeRhossRaw(raw: Uint8Array, repeat: number = 0): number[] {
  const out: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    const frame = sendGenericBytes({
      headerMark: HDR_MARK, headerSpace: HDR_SPACE,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: ZERO_SPACE, data: raw, msbFirst: false,
    });
    for (const t of frame) out.push(t);
    out.push(BIT_MARK, GAP); // extra footer per repeat
  }
  return out;
}

/** Build + encode a Rhoss state into IR timings. */
export function sendRhoss(state: RhossState, repeat: number = 0): number[] {
  return encodeRhossRaw(buildRhossRaw(state), repeat);
}

/** Parse a validated 12-byte Rhoss state. */
export function parseRhossState(raw: Uint8Array): RhossState {
  return {
    power: getBits(raw, 5, 6, 2) === POWER_ON,
    mode: getBits(raw, 4, 4, 4) as RhossModeValue,
    temp: getBits(raw, 1, 0, 4) + TEMP_MIN,
    fan: getBits(raw, 4, 0, 2) as RhossFanValue,
    swing: !!getBits(raw, 5, 0, 1),
  };
}

/**
 * Decode raw IR timings as a Rhoss A/C message (`IRrecv::decodeRhoss`): match the
 * header + 12 LSB-first bytes + footer, then validate the byte-sum checksum.
 */
export function decodeRhoss(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): RhossState | null {
  const result = matchGenericBytes(
    timings, offset, timings.length - offset, RHOSS_STATE_LENGTH,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, ZERO_SPACE, false, undefined, undefined, false, headerOptional,
  );
  if (!result) return null;
  if (result.data[0] !== 0xaa || result.data[2] !== 0x60 || result.data[6] !== 0x54) return null;
  if (!rhossValidChecksum(result.data)) return null;
  return parseRhossState(result.data);
}
