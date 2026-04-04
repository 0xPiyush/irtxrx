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
  headerOptional: boolean = false,
): MatchGenericResult | null {
  let pos = offset;
  const end = offset + remaining;

  // Header — consume if present, fail if required but missing.
  if (headerMark || headerSpace) {
    let tmp = pos;
    let found = true;
    if (headerMark) {
      if (tmp < end && matchMark(timings[tmp]!, headerMark, tolerance, excess)) tmp++;
      else found = false;
    }
    if (found && headerSpace) {
      if (tmp < end && matchSpace(timings[tmp]!, headerSpace, tolerance, excess)) tmp++;
      else found = false;
    }
    if (found) pos = tmp;
    else if (!headerOptional) return null;
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
  headerOptional: boolean = false,
): MatchGenericBytesResult | null {
  let pos = offset;
  const end = offset + remaining;

  // Header — consume if present, fail if required but missing.
  if (headerMark || headerSpace) {
    let tmp = pos;
    let found = true;
    if (headerMark) {
      if (tmp < end && matchMark(timings[tmp]!, headerMark, tolerance, excess)) tmp++;
      else found = false;
    }
    if (found && headerSpace) {
      if (tmp < end && matchSpace(timings[tmp]!, headerSpace, tolerance, excess)) tmp++;
      else found = false;
    }
    if (found) pos = tmp;
    else if (!headerOptional) return null;
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

// ---------------------------------------------------------------------------
// Unified decode dispatcher
// ---------------------------------------------------------------------------

// Import all protocol decoders lazily to avoid circular deps — they import
// from this file, so we re-export them through the registry pattern below.

import { decodeNEC } from "./protocols/nec.js";
import type { NECDecodeResult } from "./protocols/nec.js";
import { decodeDaikin64 } from "./protocols/daikin64.js";
import type { Daikin64State } from "./protocols/daikin64.js";
import { decodeDaikin128 } from "./protocols/daikin128.js";
import type { Daikin128State } from "./protocols/daikin128.js";
import { decodeDaikin152 } from "./protocols/daikin152.js";
import type { Daikin152State } from "./protocols/daikin152.js";
import { decodeDaikin160 } from "./protocols/daikin160.js";
import type { Daikin160State } from "./protocols/daikin160.js";
import { decodeDaikin176 } from "./protocols/daikin176.js";
import type { Daikin176State } from "./protocols/daikin176.js";
import { decodeDaikin216 } from "./protocols/daikin216.js";
import type { Daikin216State } from "./protocols/daikin216.js";
import { decodeDaikinESP } from "./protocols/daikin.js";
import type { DaikinESPState } from "./protocols/daikin.js";
import { decodeDaikin2 } from "./protocols/daikin2.js";
import type { Daikin2State } from "./protocols/daikin2.js";
import { decodeDaikin312 } from "./protocols/daikin312.js";
import type { Daikin312State } from "./protocols/daikin312.js";
import { decodeCoolix, decodeCoolixRaw } from "./protocols/coolix.js";
import type { CoolixState } from "./protocols/coolix.js";

/** All supported protocol names. */
export type ProtocolName =
  | "nec"
  | "daikin64" | "daikin128" | "daikin152" | "daikin160"
  | "daikin176" | "daikin216" | "daikin" | "daikin2" | "daikin312"
  | "coolix";

/** Brand groupings for hint-based filtering. */
export type BrandName = "nec" | "daikin" | "coolix";

/** Protocol type groupings. */
export type ProtocolType = "ac" | "simple";

/** Discriminated union of all possible decode results. */
export type DecodeResult =
  | { protocol: "nec"; brand: "nec"; type: "simple"; state: NECDecodeResult; confidence: "timing_match" }
  | { protocol: "daikin64"; brand: "daikin"; type: "ac"; state: Daikin64State; confidence: "checksum_valid" }
  | { protocol: "daikin128"; brand: "daikin"; type: "ac"; state: Daikin128State; confidence: "checksum_valid" }
  | { protocol: "daikin152"; brand: "daikin"; type: "ac"; state: Daikin152State; confidence: "checksum_valid" }
  | { protocol: "daikin160"; brand: "daikin"; type: "ac"; state: Daikin160State; confidence: "checksum_valid" }
  | { protocol: "daikin176"; brand: "daikin"; type: "ac"; state: Daikin176State; confidence: "checksum_valid" }
  | { protocol: "daikin216"; brand: "daikin"; type: "ac"; state: Daikin216State; confidence: "checksum_valid" }
  | { protocol: "daikin"; brand: "daikin"; type: "ac"; state: DaikinESPState; confidence: "checksum_valid" }
  | { protocol: "daikin2"; brand: "daikin"; type: "ac"; state: Daikin2State; confidence: "checksum_valid" }
  | { protocol: "daikin312"; brand: "daikin"; type: "ac"; state: Daikin312State; confidence: "checksum_valid" }
  | { protocol: "coolix"; brand: "coolix"; type: "ac"; state: CoolixState; confidence: "checksum_valid" }
  | { protocol: "coolix"; brand: "coolix"; type: "ac"; state: null; raw: number; confidence: "checksum_valid" };

interface ProtocolEntry {
  protocol: ProtocolName;
  brand: BrandName;
  type: ProtocolType;
  /** Try decoding at the given offset. Returns a DecodeResult or null. */
  tryDecode: (timings: number[], offset: number, headerOptional: boolean) => DecodeResult | null;
}

/** Threshold for detecting inter-frame gaps (µs). Data spaces are <2000µs
 *  for all supported protocols; gaps are >3000µs. */
const GAP_THRESHOLD = 3000;

const PROTOCOL_REGISTRY: ProtocolEntry[] = [
  // AC protocols first (more common use case)
  {
    protocol: "coolix", brand: "coolix", type: "ac",
    tryDecode(timings, offset, headerOptional) {
      const state = decodeCoolix(timings, offset, headerOptional);
      if (state) return { protocol: "coolix", brand: "coolix", type: "ac", state, confidence: "checksum_valid" };
      // Also try raw decode for command codes
      const raw = decodeCoolixRaw(timings, offset, headerOptional);
      if (raw) return { protocol: "coolix", brand: "coolix", type: "ac", state: null, raw: raw.data, confidence: "checksum_valid" };
      return null;
    },
  },
  {
    protocol: "daikin152", brand: "daikin", type: "ac",
    tryDecode(timings, offset, ho) {
      const s = decodeDaikin152(timings, offset, ho);
      return s ? { protocol: "daikin152", brand: "daikin", type: "ac", state: s, confidence: "checksum_valid" } : null;
    },
  },
  {
    protocol: "daikin216", brand: "daikin", type: "ac",
    tryDecode(timings, offset, ho) {
      const s = decodeDaikin216(timings, offset, ho);
      return s ? { protocol: "daikin216", brand: "daikin", type: "ac", state: s, confidence: "checksum_valid" } : null;
    },
  },
  {
    protocol: "daikin160", brand: "daikin", type: "ac",
    tryDecode(timings, offset, ho) {
      const s = decodeDaikin160(timings, offset, ho);
      return s ? { protocol: "daikin160", brand: "daikin", type: "ac", state: s, confidence: "checksum_valid" } : null;
    },
  },
  {
    protocol: "daikin176", brand: "daikin", type: "ac",
    tryDecode(timings, offset, ho) {
      const s = decodeDaikin176(timings, offset, ho);
      return s ? { protocol: "daikin176", brand: "daikin", type: "ac", state: s, confidence: "checksum_valid" } : null;
    },
  },
  {
    protocol: "daikin64", brand: "daikin", type: "ac",
    tryDecode(timings, offset, ho) {
      const s = decodeDaikin64(timings, offset, ho);
      return s ? { protocol: "daikin64", brand: "daikin", type: "ac", state: s, confidence: "checksum_valid" } : null;
    },
  },
  {
    protocol: "daikin128", brand: "daikin", type: "ac",
    tryDecode(timings, offset, ho) {
      const s = decodeDaikin128(timings, offset, ho);
      return s ? { protocol: "daikin128", brand: "daikin", type: "ac", state: s, confidence: "checksum_valid" } : null;
    },
  },
  {
    protocol: "daikin", brand: "daikin", type: "ac",
    tryDecode(timings, offset, ho) {
      const s = decodeDaikinESP(timings, offset, ho);
      return s ? { protocol: "daikin", brand: "daikin", type: "ac", state: s, confidence: "checksum_valid" } : null;
    },
  },
  {
    protocol: "daikin2", brand: "daikin", type: "ac",
    tryDecode(timings, offset, ho) {
      const s = decodeDaikin2(timings, offset, ho);
      return s ? { protocol: "daikin2", brand: "daikin", type: "ac", state: s, confidence: "checksum_valid" } : null;
    },
  },
  {
    protocol: "daikin312", brand: "daikin", type: "ac",
    tryDecode(timings, offset, ho) {
      const s = decodeDaikin312(timings, offset, ho);
      return s ? { protocol: "daikin312", brand: "daikin", type: "ac", state: s, confidence: "checksum_valid" } : null;
    },
  },
  // Simple protocols last
  {
    protocol: "nec", brand: "nec", type: "simple",
    tryDecode(timings, offset, ho) {
      const s = decodeNEC(timings, offset, undefined, undefined, ho);
      return s ? { protocol: "nec", brand: "nec", type: "simple", state: s, confidence: "timing_match" } : null;
    },
  },
];

export interface DecodeOptions {
  /** Try only this specific protocol. */
  protocol?: ProtocolName;
  /** Try only protocols from this brand. */
  brand?: BrandName;
  /** Try only protocols of this type. */
  type?: ProtocolType;
}

/**
 * Unified IR decode dispatcher.
 *
 * Uses a 3-tier strategy to handle real-world hardware captures where
 * headers may be missing:
 *
 * 1. **Header match at offset 0** — fastest path, handles intact captures.
 * 2. **Find repeat frame** — scan for inter-frame gaps, try after each gap
 *    with header required. Handles missing first-frame headers.
 * 3. **Brute force, header optional** — try at offset 0 relying solely on
 *    checksum/parity validation. Handles single-frame headerless captures.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param options Optional hints to narrow the search.
 * @returns The first matching protocol's decode result, or null.
 */
export function decode(
  timings: number[],
  options?: DecodeOptions,
): DecodeResult | null {
  const candidates = filterCandidates(options);
  if (candidates.length === 0) return null;

  // Fast path: when a specific protocol is hinted, skip tiering —
  // just try offset 0 with header optional. The protocol's own
  // integrity checks (checksum/parity) are sufficient to confirm.
  if (options?.protocol) {
    for (const entry of candidates) {
      const result = entry.tryDecode(timings, 0, true);
      if (result) return result;
    }
    return null;
  }

  // Tier 1: header required at offset 0
  for (const entry of candidates) {
    const result = entry.tryDecode(timings, 0, false);
    if (result) return result;
  }

  // Tier 2: find repeat frames (scan for gaps, try after each)
  for (let i = 1; i < timings.length - 1; i += 2) {
    // Gaps are spaces (odd indices in a mark-start array), but hardware
    // captures with missing headers may shift parity. Check all entries.
    if (timings[i]! >= GAP_THRESHOLD) {
      const afterGap = i + 1;
      if (afterGap >= timings.length) continue;
      for (const entry of candidates) {
        const result = entry.tryDecode(timings, afterGap, false);
        if (result) return result;
      }
    }
  }

  // Tier 3: brute force at offset 0, header optional
  for (const entry of candidates) {
    const result = entry.tryDecode(timings, 0, true);
    if (result) return result;
  }

  return null;
}

function filterCandidates(options?: DecodeOptions): ProtocolEntry[] {
  if (!options) return PROTOCOL_REGISTRY;
  return PROTOCOL_REGISTRY.filter((entry) => {
    if (options.protocol && entry.protocol !== options.protocol) return false;
    if (options.brand && entry.brand !== options.brand) return false;
    if (options.type && entry.type !== options.type) return false;
    return true;
  });
}
