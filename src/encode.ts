/**
 * Core IR encoding engine.
 *
 * Mirrors the encoding logic of IRremoteESP8266's IRsend::sendGeneric /
 * IRsend::sendData, but produces a plain timing array instead of driving
 * hardware.
 */

// ---------------------------------------------------------------------------
// Bit utilities
// ---------------------------------------------------------------------------

/**
 * Reverse the least-significant `nbits` bits of `input`.
 * Any higher bits are preserved above the reversed region.
 *
 * Matches IRremoteESP8266 `reverseBits(uint64_t, uint16_t)`.
 */
export function reverseBits(input: number, nbits: number): number {
  if (nbits <= 1) return input;
  let output = 0;
  let inp = input;
  for (let i = 0; i < nbits; i++) {
    output = (output << 1) | (inp & 1);
    inp >>>= 1;
  }
  return (inp << nbits) | output;
}

// ---------------------------------------------------------------------------
// BCD utilities
// ---------------------------------------------------------------------------

/** Convert a BCD-encoded byte to a plain integer. */
export function bcdToUint8(bcd: number): number {
  if (bcd > 0x99) return 255;
  return ((bcd >> 4) * 10) + (bcd & 0xf);
}

/** Convert an integer (0–99) to BCD encoding. */
export function uint8ToBcd(integer: number): number {
  if (integer > 99) return 255;
  return (Math.trunc(integer / 10) << 4) + (integer % 10);
}

// ---------------------------------------------------------------------------
// Checksum utilities
// ---------------------------------------------------------------------------

/** Sum all bytes in a Uint8Array (or slice). Returns result & 0xFF. */
export function sumBytes(data: Uint8Array, start = 0, end = data.length): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i]!;
  return sum & 0xff;
}

/** Sum all nibbles of a uint64 up to `nbits` bits. Returns result & 0xF. */
export function sumNibbles64(value: bigint, nbits: number): number {
  let data = value & ((1n << BigInt(nbits)) - 1n);
  let result = 0;
  for (; data; data >>= 4n) result += Number(data & 0xfn);
  return result & 0xf;
}

/** Sum all nibbles (upper + lower) of each byte in a range. */
export function sumNibbles(
  data: Uint8Array, start: number, length: number, init = 0,
): number {
  let sum = init;
  for (let i = start; i < start + length; i++)
    sum += (data[i]! >> 4) + (data[i]! & 0xf);
  return sum & 0xff;
}

// ---------------------------------------------------------------------------
// Data encoding
// ---------------------------------------------------------------------------

/**
 * Encode `nbits` of `data` as mark/space pairs.
 *
 * Matches IRremoteESP8266 `IRsend::sendData`.
 */
export function encodeData(
  oneMark: number,
  oneSpace: number,
  zeroMark: number,
  zeroSpace: number,
  data: bigint,
  nbits: number,
  msbFirst: boolean,
): number[] {
  if (nbits === 0) return [];
  const timings: number[] = [];

  if (msbFirst) {
    // Send leading zeros for bits beyond 64.
    let bits = nbits;
    while (bits > 64) {
      timings.push(zeroMark, zeroSpace);
      bits--;
    }
    for (let i = bits - 1; i >= 0; i--) {
      if (data & (1n << BigInt(i))) {
        timings.push(oneMark, oneSpace);
      } else {
        timings.push(zeroMark, zeroSpace);
      }
    }
  } else {
    let d = data;
    for (let i = 0; i < nbits; i++) {
      if (d & 1n) {
        timings.push(oneMark, oneSpace);
      } else {
        timings.push(zeroMark, zeroSpace);
      }
      d >>= 1n;
    }
  }

  return timings;
}

// ---------------------------------------------------------------------------
// Generic frame encoder
// ---------------------------------------------------------------------------

export interface SendGenericOptions {
  headerMark: number;
  headerSpace: number;
  oneMark: number;
  oneSpace: number;
  zeroMark: number;
  zeroSpace: number;
  footerMark: number;
  gap: number;
  /** Minimum total message time in µs. 0 = no minimum. */
  mesgTime?: number;
  data: bigint;
  nbits: number;
  msbFirst: boolean;
  repeat?: number;
}

/**
 * Generic IR protocol encoder.
 *
 * Produces a flat array of alternating mark (IR LED on) / space (IR LED off)
 * durations in microseconds, matching the output of
 * IRremoteESP8266's `IRsend::sendGeneric`.
 */
export function sendGeneric(opts: SendGenericOptions): number[] {
  const {
    headerMark,
    headerSpace,
    oneMark,
    oneSpace,
    zeroMark,
    zeroSpace,
    footerMark,
    gap,
    mesgTime = 0,
    data,
    nbits,
    msbFirst,
    repeat = 0,
  } = opts;

  const result: number[] = [];

  for (let r = 0; r <= repeat; r++) {
    const frame: number[] = [];

    // Header
    if (headerMark) frame.push(headerMark);
    if (headerSpace) frame.push(headerSpace);

    // Data bits
    const bits = encodeData(
      oneMark,
      oneSpace,
      zeroMark,
      zeroSpace,
      data,
      nbits,
      msbFirst,
    );
    for (let i = 0; i < bits.length; i++) frame.push(bits[i]!);

    // Footer mark
    if (footerMark) frame.push(footerMark);

    // Gap — adjusted to meet minimum message time
    let elapsed = 0;
    for (let i = 0; i < frame.length; i++) elapsed += frame[i]!;

    const gapTime =
      elapsed >= mesgTime ? gap : Math.max(gap, mesgTime - elapsed);
    frame.push(gapTime);

    for (let i = 0; i < frame.length; i++) result.push(frame[i]!);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Byte-array frame encoder (used by AC protocols)
// ---------------------------------------------------------------------------

export interface SendGenericBytesOptions {
  headerMark: number;
  headerSpace: number;
  oneMark: number;
  oneSpace: number;
  zeroMark: number;
  zeroSpace: number;
  footerMark: number;
  gap: number;
  data: Uint8Array;
  msbFirst: boolean;
  repeat?: number;
}

/**
 * Generic IR encoder for byte-array payloads (AC protocols).
 *
 * Encodes each byte individually (8 bits each) via `encodeData`, matching
 * the `sendGeneric(uint8_t *dataptr, uint16_t nbytes, ...)` overload in
 * IRremoteESP8266.
 */
export function sendGenericBytes(opts: SendGenericBytesOptions): number[] {
  const {
    headerMark,
    headerSpace,
    oneMark,
    oneSpace,
    zeroMark,
    zeroSpace,
    footerMark,
    gap,
    data,
    msbFirst,
    repeat = 0,
  } = opts;

  const result: number[] = [];

  for (let r = 0; r <= repeat; r++) {
    // Header
    if (headerMark) result.push(headerMark);
    if (headerSpace) result.push(headerSpace);

    // Data — encode each byte individually (8 bits)
    for (let i = 0; i < data.length; i++) {
      const bits = encodeData(
        oneMark,
        oneSpace,
        zeroMark,
        zeroSpace,
        BigInt(data[i]!),
        8,
        msbFirst,
      );
      for (let j = 0; j < bits.length; j++) result.push(bits[j]!);
    }

    // Footer
    if (footerMark) result.push(footerMark);
    result.push(gap);
  }

  return result;
}
