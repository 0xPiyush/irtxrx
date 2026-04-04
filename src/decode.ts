/**
 * Core IR decoding engine.
 *
 * Mirrors the decoding logic of IRremoteESP8266's IRrecv, but operates
 * on plain timing arrays (in microseconds) instead of hardware capture buffers.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default percentage tolerance for timing matches (±25%). */
export const kTolerance = 25;

/**
 * Default mark excess in microseconds.
 * Compensates for sensor lag: marks are captured too long, spaces too short.
 * Set to 0 for ideal timings (encoder output); increase for real hardware.
 */
export const kMarkExcess = 0;

// ---------------------------------------------------------------------------
// Tolerance bounds (internal)
// ---------------------------------------------------------------------------

/** Lower bound: desired × (1 − tolerance%) − delta, clamped to 0. */
function ticksLow(usecs: number, tolerance: number, delta: number = 0): number {
  return Math.max(Math.floor(usecs * (1.0 - tolerance / 100.0) - delta), 0);
}

/** Upper bound: desired × (1 + tolerance%) + 1 + delta. */
function ticksHigh(usecs: number, tolerance: number, delta: number = 0): number {
  return Math.floor(usecs * (1.0 + tolerance / 100.0)) + 1 + delta;
}

// ---------------------------------------------------------------------------
// Match functions
// ---------------------------------------------------------------------------

/** Check if a measured timing is within tolerance of a desired value. */
export function matchTiming(
  measured: number,
  desired: number,
  tolerance: number = kTolerance,
  delta: number = 0,
): boolean {
  return measured >= ticksLow(desired, tolerance, delta) &&
         measured <= ticksHigh(desired, tolerance, delta);
}

/**
 * Match a mark (IR ON) timing.
 * Adds excess to desired to compensate for marks being captured too long.
 */
export function matchMark(
  measured: number,
  desired: number,
  tolerance: number = kTolerance,
  excess: number = kMarkExcess,
): boolean {
  return matchTiming(measured, desired + excess, tolerance);
}

/**
 * Match a space (IR OFF) timing.
 * Subtracts excess from desired to compensate for spaces being too short.
 */
export function matchSpace(
  measured: number,
  desired: number,
  tolerance: number = kTolerance,
  excess: number = kMarkExcess,
): boolean {
  return matchTiming(measured, desired - excess, tolerance);
}

/**
 * Match a timing that should be at least as long as desired.
 * Used for trailing gaps which can be arbitrarily long.
 */
export function matchAtLeast(
  measured: number,
  desired: number,
  tolerance: number = kTolerance,
  delta: number = 0,
): boolean {
  if (measured === 0) return true;
  return measured >= ticksLow(desired, tolerance, delta);
}

// ---------------------------------------------------------------------------
// Bit-level reversal for bigint (internal)
// ---------------------------------------------------------------------------

function reverseBitsBigInt(input: bigint, nbits: number): bigint {
  if (nbits <= 1) return input;
  let output = 0n;
  let inp = input;
  for (let i = 0; i < nbits; i++) {
    output = (output << 1n) | (inp & 1n);
    inp >>= 1n;
  }
  return (inp << BigInt(nbits)) | output;
}

// ---------------------------------------------------------------------------
// Bit decoding
// ---------------------------------------------------------------------------

export interface MatchDataResult {
  success: boolean;
  data: bigint;
  used: number;
}

/**
 * Decode `nbits` of data from mark/space pairs in a timing array.
 *
 * Inverse of `encodeData`. Matches IRremoteESP8266 `IRrecv::matchData`.
 */
export function matchData(
  timings: number[],
  offset: number,
  nbits: number,
  oneMark: number,
  oneSpace: number,
  zeroMark: number,
  zeroSpace: number,
  tolerance: number = kTolerance,
  excess: number = kMarkExcess,
  msbFirst: boolean = true,
  expectLastSpace: boolean = true,
): MatchDataResult {
  let data = 0n;
  let pos = offset;

  for (let i = 0; i < nbits; i++) {
    if (pos >= timings.length) {
      return { success: false, data: 0n, used: pos - offset };
    }

    const isLast = i === nbits - 1;
    const mark = timings[pos]!;

    if (isLast && !expectLastSpace) {
      // Last bit without trailing space: match mark only.
      if (matchMark(mark, oneMark, tolerance, excess)) {
        data = (data << 1n) | 1n;
      } else if (matchMark(mark, zeroMark, tolerance, excess)) {
        data = data << 1n;
      } else {
        if (!msbFirst) data = reverseBitsBigInt(data, i);
        return { success: false, data, used: pos - offset };
      }
      pos++;
    } else {
      // Normal bit: mark + space.
      if (pos + 1 >= timings.length) {
        return { success: false, data: 0n, used: pos - offset };
      }
      const space = timings[pos + 1]!;

      if (matchMark(mark, oneMark, tolerance, excess) &&
          matchSpace(space, oneSpace, tolerance, excess)) {
        data = (data << 1n) | 1n;
      } else if (matchMark(mark, zeroMark, tolerance, excess) &&
                 matchSpace(space, zeroSpace, tolerance, excess)) {
        data = data << 1n;
      } else {
        if (!msbFirst) data = reverseBitsBigInt(data, i);
        return { success: false, data, used: pos - offset };
      }
      pos += 2;
    }
  }

  if (!msbFirst) data = reverseBitsBigInt(data, nbits);

  return { success: true, data, used: pos - offset };
}

// ---------------------------------------------------------------------------
// Generic frame decoder
// ---------------------------------------------------------------------------

export interface MatchGenericResult {
  data: bigint;
  used: number;
}

/**
 * Generic IR frame decoder for protocols with ≤ 64 data bits.
 *
 * Inverse of `sendGeneric`. Matches IRremoteESP8266 `IRrecv::matchGeneric`.
 *
 * @returns Decoded data and entries consumed, or null on mismatch.
 */
export function matchGeneric(
  timings: number[],
  offset: number,
  remaining: number,
  nbits: number,
  headerMark: number,
  headerSpace: number,
  oneMark: number,
  oneSpace: number,
  zeroMark: number,
  zeroSpace: number,
  footerMark: number,
  footerSpace: number,
  atLeast: boolean = true,
  tolerance: number = kTolerance,
  excess: number = kMarkExcess,
  msbFirst: boolean = true,
): MatchGenericResult | null {
  let pos = offset;
  const end = offset + remaining;

  // Header mark
  if (headerMark) {
    if (pos >= end) return null;
    if (!matchMark(timings[pos]!, headerMark, tolerance, excess)) return null;
    pos++;
  }

  // Header space
  if (headerSpace) {
    if (pos >= end) return null;
    if (!matchSpace(timings[pos]!, headerSpace, tolerance, excess)) return null;
    pos++;
  }

  // Data bits
  const expectLastSpace = !!footerMark || (oneSpace !== zeroSpace);
  const dataResult = matchData(
    timings, pos, nbits,
    oneMark, oneSpace, zeroMark, zeroSpace,
    tolerance, excess, msbFirst, expectLastSpace,
  );
  if (!dataResult.success) return null;
  pos += dataResult.used;

  // Footer mark
  if (footerMark) {
    if (pos >= end) return null;
    if (!matchMark(timings[pos]!, footerMark, tolerance, excess)) return null;
    pos++;
  }

  // Footer space
  if (footerSpace && pos < end) {
    if (atLeast) {
      if (!matchAtLeast(timings[pos]!, footerSpace, tolerance)) return null;
    } else {
      if (!matchSpace(timings[pos]!, footerSpace, tolerance, excess)) return null;
    }
    pos++;
  }

  return { data: dataResult.data, used: pos - offset };
}

// ---------------------------------------------------------------------------
// Byte-array frame decoder (for AC protocols)
// ---------------------------------------------------------------------------

export interface MatchGenericBytesResult {
  data: Uint8Array;
  used: number;
}

/**
 * Generic IR frame decoder for byte-array protocols (AC protocols).
 *
 * Inverse of `sendGenericBytes`. Decodes each byte individually (8 bits).
 *
 * @returns Decoded byte array and entries consumed, or null on mismatch.
 */
export function matchGenericBytes(
  timings: number[],
  offset: number,
  remaining: number,
  nbytes: number,
  headerMark: number,
  headerSpace: number,
  oneMark: number,
  oneSpace: number,
  zeroMark: number,
  zeroSpace: number,
  footerMark: number,
  footerSpace: number,
  atLeast: boolean = true,
  tolerance: number = kTolerance,
  excess: number = kMarkExcess,
  msbFirst: boolean = true,
): MatchGenericBytesResult | null {
  let pos = offset;
  const end = offset + remaining;

  // Header mark
  if (headerMark) {
    if (pos >= end) return null;
    if (!matchMark(timings[pos]!, headerMark, tolerance, excess)) return null;
    pos++;
  }

  // Header space
  if (headerSpace) {
    if (pos >= end) return null;
    if (!matchSpace(timings[pos]!, headerSpace, tolerance, excess)) return null;
    pos++;
  }

  // Data bytes — decode each byte as 8 bits.
  const data = new Uint8Array(nbytes);
  const expectLastSpace = !!footerMark || (oneSpace !== zeroSpace);

  for (let i = 0; i < nbytes; i++) {
    const isLastByte = i === nbytes - 1;
    const byteResult = matchData(
      timings, pos, 8,
      oneMark, oneSpace, zeroMark, zeroSpace,
      tolerance, excess, msbFirst,
      isLastByte ? expectLastSpace : true,
    );
    if (!byteResult.success) return null;
    data[i] = Number(byteResult.data & 0xFFn);
    pos += byteResult.used;
  }

  // Footer mark
  if (footerMark) {
    if (pos >= end) return null;
    if (!matchMark(timings[pos]!, footerMark, tolerance, excess)) return null;
    pos++;
  }

  // Footer space
  if (footerSpace && pos < end) {
    if (atLeast) {
      if (!matchAtLeast(timings[pos]!, footerSpace, tolerance)) return null;
    } else {
      if (!matchSpace(timings[pos]!, footerSpace, tolerance, excess)) return null;
    }
    pos++;
  }

  return { data, used: pos - offset };
}
