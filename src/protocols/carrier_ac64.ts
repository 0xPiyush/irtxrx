/**
 * Carrier 64-bit HVAC IR protocol encoder and decoder. (CARRIER_AC64)
 *
 * Ported from IRremoteESP8266 `ir_Carrier.cpp` (the `IRCarrierAc64` class).
 * A 64-bit LSB-first message with a 4-bit nibble-sum checksum, carrying power,
 * mode, temperature, fan, vertical swing, sleep, and 1-hour-resolution on/off
 * timers.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1127
 */

import { sendGeneric } from "../encode.js";
import { matchGeneric } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Carrier.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 8940;
const HDR_SPACE = 4556;
const BIT_MARK = 503;
const ONE_SPACE = 1736;
const ZERO_SPACE = 615;
const GAP = 100000; // kDefaultMessageGap

export const CARRIER_AC64_BITS = 64;
const MASK64 = (1n << 64n) - 1n;

const CHECKSUM_OFFSET = 16;
const CHECKSUM_SIZE = 4;
const TEMP_MIN = 16;
const TEMP_MAX = 30;
const TIMER_MAX = 9; // hours
const TIMER_MIN = 1; // hours

/** Reset value from `IRCarrierAc64::stateReset` (powered off). */
export const CARRIER_AC64_KNOWN_GOOD = 0x109000002c2a5584n;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const CarrierAc64Mode = {
  Heat: 0b01,
  Cool: 0b10,
  Fan: 0b11,
} as const;
export type CarrierAc64ModeValue = (typeof CarrierAc64Mode)[keyof typeof CarrierAc64Mode];

export const CarrierAc64Fan = {
  Auto: 0b00,
  Low: 0b01,
  Medium: 0b10,
  High: 0b11,
} as const;
export type CarrierAc64FanValue = (typeof CarrierAc64Fan)[keyof typeof CarrierAc64Fan];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface CarrierAc64State {
  power?: boolean;
  mode?: CarrierAc64ModeValue;
  /** Temperature in °C (16–30). */
  temp?: number;
  fan?: CarrierAc64FanValue;
  swingV?: boolean;
  sleep?: boolean;
  /** On-timer in minutes (1-hour resolution, 0 = off). */
  onTimer?: number;
  /** Off-timer in minutes (1-hour resolution, 0 = off). */
  offTimer?: number;
}

// ---------------------------------------------------------------------------
// Bit / checksum helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function getBits(raw: bigint, off: number, size: number): number {
  return Number((raw >> BigInt(off)) & ((1n << BigInt(size)) - 1n));
}

function setBits(raw: bigint, off: number, size: number, val: number): bigint {
  const mask = ((1n << BigInt(size)) - 1n) << BigInt(off);
  return (raw & ~mask) | ((BigInt(val) << BigInt(off)) & mask);
}

/** Matches `IRCarrierAc64::calcChecksum`: nibble-sum of bits 20–63. */
export function carrierAc64Checksum(raw: bigint): number {
  let data = (raw >> BigInt(CHECKSUM_OFFSET + CHECKSUM_SIZE)) &
    ((1n << BigInt(CARRIER_AC64_BITS - (CHECKSUM_OFFSET + CHECKSUM_SIZE))) - 1n);
  let result = 0;
  for (; data; data >>= 4n) result += Number(data & 0xfn);
  return result & 0xf;
}

/** Verify the 4-bit checksum of a raw state. */
export function carrierAc64ValidChecksum(raw: bigint): boolean {
  return getBits(raw, CHECKSUM_OFFSET, CHECKSUM_SIZE) === carrierAc64Checksum(raw);
}

// ---------------------------------------------------------------------------
// Build raw 64-bit value — emulates the IRCarrierAc64 setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 64-bit Carrier value from a state object.
 *
 * Mirrors the `IRCarrierAc64` setter order used by the cross-check runner,
 * including the sleep/timer mutual-exclusion side effects.
 */
export function buildCarrierAc64Raw(state: CarrierAc64State): bigint {
  let raw = CARRIER_AC64_KNOWN_GOOD;

  const setOnTimer = (mins: number): void => {
    const hours = Math.min(Math.trunc(mins / 60), TIMER_MAX);
    raw = setBits(raw, 38, 1, hours ? 1 : 0); // OnTimerEnable
    raw = setBits(raw, 52, 4, Math.max(TIMER_MIN, hours)); // OnTimer
    if (hours) {
      raw = setBits(raw, 37, 1, 0); // cancel OffTimer enable
      setSleep(false);
    }
  };

  function setSleep(on: boolean): void {
    if (on) {
      setOffTimer(2 * 60);
      raw = setBits(raw, 38, 1, 0); // cancel OnTimer enable
      raw = setBits(raw, 37, 1, 0); // cancel OffTimer enable
    }
    raw = setBits(raw, 39, 1, on ? 1 : 0);
  }

  function setOffTimer(mins: number): void {
    const hours = Math.min(Math.trunc(mins / 60), TIMER_MAX);
    const sleep = getBits(raw, 39, 1) === 1;
    raw = setBits(raw, 37, 1, hours && !sleep ? 1 : 0); // OffTimerEnable
    raw = setBits(raw, 60, 4, Math.max(TIMER_MIN, hours)); // OffTimer
    if (hours) {
      raw = setBits(raw, 38, 1, 0); // cancel OnTimer enable
      setSleep(false);
    }
  }

  // Mode (bits 20-21) — unknown values fall back to Cool.
  let mode: number = state.mode ?? CarrierAc64Mode.Cool;
  switch (mode) {
    case CarrierAc64Mode.Heat:
    case CarrierAc64Mode.Cool:
    case CarrierAc64Mode.Fan:
      break;
    default:
      mode = CarrierAc64Mode.Cool;
  }
  raw = setBits(raw, 20, 2, mode);

  // Temp (bits 24-27).
  raw = setBits(raw, 24, 4, clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_MIN);

  // Fan (bits 22-23) — out-of-range falls back to Auto.
  const fan = (state.fan ?? CarrierAc64Fan.Auto) > CarrierAc64Fan.High ? CarrierAc64Fan.Auto : (state.fan ?? CarrierAc64Fan.Auto);
  raw = setBits(raw, 22, 2, fan);

  // Vertical swing (bit 29).
  raw = setBits(raw, 29, 1, state.swingV ? 1 : 0);

  // Timers + sleep (order matters; last set wins).
  setOnTimer(state.onTimer ?? 0);
  setOffTimer(state.offTimer ?? 0);
  setSleep(state.sleep ?? false);

  // Power (bit 36).
  raw = setBits(raw, 36, 1, state.power ? 1 : 0);

  // Checksum (bits 16-19).
  raw = setBits(raw, CHECKSUM_OFFSET, CHECKSUM_SIZE, carrierAc64Checksum(raw));
  return raw & MASK64;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 64-bit Carrier value into IR timings (LSB-first).
 *
 * Matches IRremoteESP8266 `IRsend::sendCarrierAC64`.
 */
export function encodeCarrierAc64Raw(
  data: bigint,
  nbits: number = CARRIER_AC64_BITS,
  repeat: number = 0,
): number[] {
  return sendGeneric({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP,
    data: data & MASK64, nbits, msbFirst: false, repeat,
  });
}

/** Encode a Carrier 64-bit state into raw IR timings. */
export function sendCarrierAc64(state: CarrierAc64State, repeat: number = 0): number[] {
  return encodeCarrierAc64Raw(buildCarrierAc64Raw(state), CARRIER_AC64_BITS, repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 64-bit Carrier value into a state object. */
export function parseCarrierAc64State(raw: bigint): CarrierAc64State {
  return {
    power: getBits(raw, 36, 1) === 1,
    mode: getBits(raw, 20, 2) as CarrierAc64ModeValue,
    temp: getBits(raw, 24, 4) + TEMP_MIN,
    fan: getBits(raw, 22, 2) as CarrierAc64FanValue,
    swingV: getBits(raw, 29, 1) === 1,
    sleep: getBits(raw, 39, 1) === 1,
    onTimer: getBits(raw, 38, 1) ? getBits(raw, 52, 4) * 60 : 0,
    offTimer: getBits(raw, 37, 1) ? getBits(raw, 60, 4) * 60 : 0,
  };
}

/**
 * Decode raw IR timings as a Carrier 64-bit message.
 *
 * Matches IRremoteESP8266 `IRrecv::decodeCarrierAC64`, validating the checksum.
 *
 * @returns Decoded state, or null on mismatch / bad checksum.
 */
export function decodeCarrierAc64(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): CarrierAc64State | null {
  const result = matchGeneric(
    timings, offset, timings.length - offset, CARRIER_AC64_BITS,
    HDR_MARK, HDR_SPACE,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, undefined, undefined, false, headerOptional,
  );
  if (!result) return null;
  const raw = result.data & MASK64;
  if (!carrierAc64ValidChecksum(raw)) return null;
  return parseCarrierAc64State(raw);
}
