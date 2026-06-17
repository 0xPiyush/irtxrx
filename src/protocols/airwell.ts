/**
 * Airwell A/C IR protocol encoder and decoder. (AIRWELL)
 *
 * Ported from IRremoteESP8266 `ir_Airwell.cpp` / `ir_Airwell.h` — full coverage
 * of the `IRAirwellAc` class and the `sendAirwell` / `decodeAirwell` wire format.
 *
 * Unlike every other protocol in this library, Airwell is **Manchester-encoded**
 * (bi-phase): each of the 34 data bits is two 950µs half-periods, and adjacent
 * same-polarity half-periods merge into 1900µs intervals. A `0` bit is mark→space
 * and a `1` is space→mark (the `GEThomas=false` convention, i.e. data is sent
 * inverted then bi-phase encoded). The frame is a 2850/2850 header, 34 data bits
 * MSB-first, and a 3800µs footer mark. There is no checksum.
 *
 * The Manchester encode (a merging mark/space accumulator) and decode (the
 * "bank"/half-period state machine) are ported inline here, as this is the only
 * Manchester protocol.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Airwell.cpp
 */

import { matchTiming, matchMark, matchSpace, matchAtLeast } from "../decode.js";

const HALF = 950; // kAirwellHalfClockPeriod
const HDR_MARK = 3 * HALF; // 2850
const HDR_SPACE = 3 * HALF; // 2850
const FOOTER_MARK = HDR_MARK + HALF; // 3800
const GAP = 100000; // kDefaultMessageGap

export const AIRWELL_BITS = 34;
const MASK = (1n << 34n) - 1n;
const DEFAULT_STATE = 0x140500002n; // Mode Fan, Speed 1, 25C
const MIN_REPEAT = 2;

export const AirwellMode = { Cool: 1, Heat: 2, Auto: 3, Dry: 4, Fan: 5 } as const;
export type AirwellModeValue = (typeof AirwellMode)[keyof typeof AirwellMode];
export const AirwellFan = { Low: 0, Medium: 1, High: 2, Auto: 3 } as const;
export type AirwellFanValue = (typeof AirwellFan)[keyof typeof AirwellFan];

const TEMP_MIN = 16;
const TEMP_MAX = 30;

export interface AirwellState {
  /** Power **toggle** (one-shot button, not an absolute state). */
  powerToggle?: boolean;
  mode?: AirwellModeValue;
  /** Temperature in °C (16–30). */
  temp?: number;
  fan?: AirwellFanValue;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
function getF(v: bigint, pos: number, width: number): number {
  return Number((v >> BigInt(pos)) & ((1n << BigInt(width)) - 1n));
}
function setF(v: bigint, pos: number, width: number, val: number): bigint {
  const m = ((1n << BigInt(width)) - 1n) << BigInt(pos);
  return (v & ~m) | ((BigInt(val) << BigInt(pos)) & m);
}

function validMode(m: number): number {
  return m === AirwellMode.Cool || m === AirwellMode.Heat || m === AirwellMode.Auto ||
    m === AirwellMode.Dry || m === AirwellMode.Fan ? m : AirwellMode.Auto;
}

/** Build the raw 34-bit Airwell value from a state object. Dry mode forces low fan. */
export function buildAirwellRaw(state: AirwellState): bigint {
  const mode = validMode(state.mode ?? AirwellMode.Auto);
  const fan = mode === AirwellMode.Dry ? AirwellFan.Low : Math.min(state.fan ?? AirwellFan.Auto, AirwellFan.Auto);
  let v = DEFAULT_STATE;
  v = setF(v, 33, 1, (state.powerToggle ?? false) ? 1 : 0); // PowerToggle
  v = setF(v, 30, 3, mode); // Mode
  v = setF(v, 28, 2, fan); // Fan
  v = setF(v, 19, 4, clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - TEMP_MIN + 1); // Temp
  return v & MASK;
}

// ---------------------------------------------------------------------------
// Manchester encode (merging mark/space accumulator)
// ---------------------------------------------------------------------------

/** Encode a raw 34-bit Airwell value into IR timings (`IRsend::sendAirwell`). */
export function encodeAirwellRaw(data: bigint, repeat: number = MIN_REPEAT): number[] {
  const arr: number[] = [];
  let pol: "m" | "s" | null = null;
  const add = (p: "m" | "s", t: number): void => {
    if (pol === p) arr[arr.length - 1]! += t;
    else { arr.push(t); pol = p; }
  };
  const mark = (t: number): void => add("m", t);
  const space = (t: number): void => add("s", t);

  const value = data & MASK;
  // Header + data is repeated back-to-back (no inter-message footer); a single
  // footer mark + gap is emitted once at the very end, matching `sendAirwell`.
  for (let r = 0; r <= repeat; r++) {
    mark(HDR_MARK);
    space(HDR_SPACE);
    // Manchester data, MSB-first, GEThomas=false (copy = ~data).
    for (let i = AIRWELL_BITS - 1; i >= 0; i--) {
      const bit = (value >> BigInt(i)) & 1n;
      if (bit === 0n) { mark(HALF); space(HALF); } // copy bit 1 → mark,space
      else { space(HALF); mark(HALF); } // copy bit 0 → space,mark
    }
  }
  mark(FOOTER_MARK);
  space(GAP);
  return arr;
}

/** Build + encode an Airwell state into IR timings. */
export function sendAirwell(state: AirwellState, repeat: number = MIN_REPEAT): number[] {
  return encodeAirwellRaw(buildAirwellRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Manchester decode (ported from IRrecv::matchManchester[Data])
// ---------------------------------------------------------------------------

const TOL = 25; // kTolerance
const EXCESS = 50; // kMarkExcess

/** Port of `matchManchesterData`: returns the decoded value + entries used. */
function matchManchesterData(
  timings: number[], start: number, remaining: number, nbits: number, startingBalance: number,
): { data: bigint; used: number } | null {
  let offset = 0;
  let data = 0n;
  let nrHalf = 0;
  const expected = nbits * 2;
  let currentBit = startingBalance !== 0; // GEThomas=false
  let bank = startingBalance;
  if (remaining < nbits) return null;

  while ((offset < remaining || bank) && nrHalf < expected) {
    if (!bank) { bank = timings[start + offset]!; offset++; }
    if (!matchTiming(bank, HALF, TOL, EXCESS)) return null;
    nrHalf++;
    if (offset < remaining) { bank = timings[start + offset]!; offset++; }
    else if (offset === remaining) { bank = HALF; }
    else return null;

    data = (data << 1n) | (currentBit ? 1n : 0n);

    if (matchTiming(bank, HALF * 2, TOL, EXCESS)) { currentBit = !currentBit; bank -= HALF; }
    else if (matchTiming(bank, HALF, TOL, EXCESS)) { bank = 0; }
    else if (nrHalf === expected - 1 && matchAtLeast(bank, HALF, TOL)) { bank = 0; offset--; }
    else return null;
    nrHalf++;
  }
  return { data: data & ((1n << BigInt(nbits)) - 1n), used: offset };
}

/**
 * Decode raw IR timings as an Airwell A/C message (`IRrecv::decodeAirwell`):
 * match the Manchester-encoded header + 34 data bits + footer.
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeAirwell(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): AirwellState | null {
  let pos = offset;
  let bank = 0;
  const minRemaining = AIRWELL_BITS + 3; // hdrmark + hdrspace + footermark
  if (timings.length - pos < minRemaining) return null;

  // Header mark (hdrspace is non-zero, so a plain header mark is required).
  if (pos < timings.length && matchMark(timings[pos]!, HDR_MARK, TOL, EXCESS)) {
    pos++;
  } else if (!headerOptional) {
    return null;
  }
  // Header space — may have merged with the first data half-period (→ 3800).
  if (pos < timings.length && matchSpace(timings[pos]!, HDR_SPACE + HALF, TOL, EXCESS)) {
    bank = timings[pos]! - HDR_SPACE;
    pos++;
  } else if (pos < timings.length && matchSpace(timings[pos]!, HDR_SPACE, TOL, EXCESS)) {
    pos++;
  } else if (!headerOptional) {
    return null;
  }
  if (!matchTiming(bank, HALF, TOL, EXCESS)) bank = 0;

  const result = matchManchesterData(timings, pos, timings.length - pos, AIRWELL_BITS, bank);
  if (!result) return null;
  pos += result.used;

  // Footer mark (may be merged with a trailing data half-period).
  if (pos < timings.length &&
      !(matchMark(timings[pos]!, FOOTER_MARK + HALF, TOL, EXCESS) ||
        matchMark(timings[pos]!, FOOTER_MARK, TOL, EXCESS))) {
    return null;
  }

  const v = result.data & MASK;
  return parseAirwellState(v);
}

/** Parse a 34-bit Airwell value into a state object. */
export function parseAirwellState(v: bigint): AirwellState {
  return {
    powerToggle: getF(v, 33, 1) === 1,
    mode: getF(v, 30, 3) as AirwellModeValue,
    temp: getF(v, 19, 4) + TEMP_MIN - 1,
    fan: getF(v, 28, 2) as AirwellFanValue,
  };
}
