/**
 * Blue Star A/C IR protocol encoder and decoder. (BLUESTAR)
 *
 * A 10-byte (80-bit) MSB-first main frame, followed by an inter-section gap and
 * an 11-bit trailer that uses a *different* modulation (longer mark/spaces). The
 * trailer is a command/button code that does not map 1:1 to AC state (identical
 * buttons can emit different codes, and several buttons collide), so it is
 * preserved verbatim as `commandCode` to guarantee a lossless decode→encode
 * roundtrip rather than modelled as a typed field.
 *
 * This is NOT the same protocol as {@link ./bluestar_heavy.ts} (BluestarHeavy,
 * a 13-byte frame with a 4912µs header). This variant has no captured header —
 * real hardware captures begin directly on the first data bit — and carries a
 * one's-complement checksum: the sum of all 10 bytes is 0xFF (mod 256).
 *
 * Reverse-engineered from labelled captures (session e758df30); there is no
 * IRremoteESP8266 reference. Frame layout (MSB-first):
 *
 *   byte 0  0x33                      constant
 *   byte 1  fan (bits 7-5) | mode (bits 4-0)
 *   byte 2  b7 power, b6 sleep, b4 turbo, b3 light, b1 swing, b0 vane-active
 *   byte 3  temperature (°C, direct: 0x10=16 … 0x1E=30)
 *   byte 4  room-temperature sensor
 *   byte 5  byte4 | 0x80             (derived)
 *   byte 6  0x3C - byte4             (derived)
 *   byte 7  0x60                      constant
 *   byte 8  b0=1, b2=(fan present), b6=timer
 *   byte 9  checksum: sum(bytes 0-9) & 0xFF == 0xFF
 */

import { encodeData, sendGenericBytes } from "../encode.js";
import { matchData, matchGenericBytes, kTolerance, kMarkExcess } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants (µs) — derived from hardware captures
// ---------------------------------------------------------------------------

const BIT_MARK = 990;
const ONE_SPACE = 2600;
const ZERO_SPACE = 590;
/** Inter-section gap between the main frame and the trailer. */
const SECTION_GAP = 8940;

/** The trailer uses its own, longer modulation. */
const TR_BIT_MARK = 700;
const TR_ONE_SPACE = 6500;
const TR_ZERO_SPACE = 3650;

/** Trailing inter-message gap. */
const GAP = 100000;

export const BLUESTAR_STATE_LENGTH = 10;
const TRAILER_BITS = 11;

/** Default 11-bit trailer (the power-button code) used when building a frame
 *  from scratch. */
const DEFAULT_COMMAND = 0b10111001101; // 1485

export const BLUESTAR_MIN_TEMP = 16;
export const BLUESTAR_MAX_TEMP = 30;

// ---------------------------------------------------------------------------
// Mode / fan vocabularies (raw wire values)
// ---------------------------------------------------------------------------

/** Mode occupies byte 1 bits 4-0 (one-hot). */
export const BluestarMode = {
  Auto: 0x02,
  Cool: 0x08,
  Dry: 0x04,
  Fan: 0x01,
} as const;
export type BluestarModeValue = (typeof BluestarMode)[keyof typeof BluestarMode];

/** Fan occupies byte 1 bits 7-5. `None` (0) only appears in feature-only
 *  frames (convertible/light/sleep). */
export const BluestarFan = {
  Auto: 0b111,
  Low: 0b100,
  Medium: 0b010,
  High: 0b001,
  None: 0b000,
} as const;
export type BluestarFanValue = (typeof BluestarFan)[keyof typeof BluestarFan];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface BluestarState {
  power?: boolean;
  mode?: BluestarModeValue;
  fan?: BluestarFanValue;
  /** °C, 16-30. */
  temp?: number;
  swing?: boolean;
  turbo?: boolean;
  sleep?: boolean;
  light?: boolean;
  timer?: boolean;
  /** byte2 bit0 — the vane/swing feature latch (stays set once swing is used).
   *  Preserved for lossless roundtrip. */
  vaneActive?: boolean;
  /** Room-temperature sensor reading (byte 4). Environmental, not user-set. */
  roomTemp?: number;
  /** The 11-bit trailer command/button code. Preserved verbatim. */
  commandCode?: number;
}

// ---------------------------------------------------------------------------
// Bit helpers
// ---------------------------------------------------------------------------

function setBit(raw: Uint8Array, byteIdx: number, bitIdx: number, on: boolean) {
  if (on) raw[byteIdx] = raw[byteIdx]! | (1 << bitIdx);
  else raw[byteIdx] = raw[byteIdx]! & ~(1 << bitIdx);
}

function setBitsRange(
  raw: Uint8Array, byteIdx: number, bitOffset: number, size: number, value: number,
) {
  const mask = ((1 << size) - 1) << bitOffset;
  raw[byteIdx] = (raw[byteIdx]! & ~mask) | ((value << bitOffset) & mask);
}

/** One's-complement checksum: byte 9 makes the sum of all 10 bytes == 0xFF. */
function bluestarChecksum(raw: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < BLUESTAR_STATE_LENGTH - 1; i++) sum += raw[i]!;
  return (0xff - (sum & 0xff)) & 0xff;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function defaultState(): Uint8Array {
  const raw = new Uint8Array(BLUESTAR_STATE_LENGTH);
  raw[0] = 0x33;
  raw[7] = 0x60;
  raw[8] = 0x01;
  return raw;
}

export function buildBluestarRaw(state: BluestarState): Uint8Array {
  const raw = defaultState();

  const fan = state.fan ?? BluestarFan.Auto;
  const mode = state.mode ?? BluestarMode.Cool;

  // Byte 1: fan (bits 7-5) | mode (bits 4-0)
  setBitsRange(raw, 1, 5, 3, fan);
  setBitsRange(raw, 1, 0, 5, mode);

  // Byte 2: flags
  setBit(raw, 2, 7, state.power ?? false);
  setBit(raw, 2, 6, state.sleep ?? false);
  setBit(raw, 2, 4, state.turbo ?? false);
  setBit(raw, 2, 3, state.light ?? false);
  setBit(raw, 2, 1, state.swing ?? false);
  setBit(raw, 2, 0, state.vaneActive ?? false);

  // Byte 3: temperature
  const temp = Math.min(Math.max(state.temp ?? 24, BLUESTAR_MIN_TEMP), BLUESTAR_MAX_TEMP);
  raw[3] = temp & 0xff;

  // Bytes 4-6: room-temp sensor (byte5/6 derived from byte4)
  const roomTemp = (state.roomTemp ?? 0x1e) & 0xff;
  raw[4] = roomTemp;
  raw[5] = roomTemp | 0x80;
  raw[6] = (0x3c - roomTemp) & 0xff;

  // Byte 8: b0 constant, b2 = fan present, b6 = timer
  setBit(raw, 8, 2, fan !== BluestarFan.None);
  setBit(raw, 8, 6, state.timer ?? false);

  // Byte 9: checksum
  raw[9] = bluestarChecksum(raw);

  return raw;
}

// ---------------------------------------------------------------------------
// Send / encode
// ---------------------------------------------------------------------------

export function sendBluestar(state: BluestarState, repeat = 0): number[] {
  return encodeBluestarRaw(buildBluestarRaw(state), state.commandCode ?? DEFAULT_COMMAND, repeat);
}

/**
 * Encode a raw 10-byte Bluestar payload plus its 11-bit trailer command code
 * into IR timings (MSB-first, headerless).
 */
export function encodeBluestarRaw(
  data: Uint8Array, commandCode: number = DEFAULT_COMMAND, repeat = 0,
): number[] {
  const result: number[] = [];

  for (let r = 0; r <= repeat; r++) {
    // Main frame: 10 bytes, no header, footer mark + inter-section gap.
    const main = sendGenericBytes({
      headerMark: 0, headerSpace: 0,
      oneMark: BIT_MARK, oneSpace: ONE_SPACE,
      zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
      footerMark: BIT_MARK, gap: SECTION_GAP,
      data, msbFirst: true,
    });
    for (let i = 0; i < main.length; i++) result.push(main[i]!);

    // Trailer: 11 bits in the trailer modulation, then a terminating mark + gap.
    const trailer = encodeData(
      TR_BIT_MARK, TR_ONE_SPACE, TR_BIT_MARK, TR_ZERO_SPACE,
      BigInt(commandCode & ((1 << TRAILER_BITS) - 1)), TRAILER_BITS, true,
    );
    for (let i = 0; i < trailer.length; i++) result.push(trailer[i]!);
    result.push(TR_BIT_MARK);
    result.push(GAP);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Bluestar message.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeBluestar(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): BluestarState | null {
  // Main frame: 10 bytes, headerless, footer mark + long inter-section gap.
  const main = matchGenericBytes(
    timings, offset, timings.length - offset, BLUESTAR_STATE_LENGTH,
    0, 0,
    BIT_MARK, ONE_SPACE,
    BIT_MARK, ZERO_SPACE,
    BIT_MARK, SECTION_GAP,
    true, kTolerance, kMarkExcess, true, headerOptional,
  );
  if (!main) return null;
  const raw = main.data;

  // Validate checksum: the sum of all 10 bytes must be 0xFF (mod 256).
  if (raw[BLUESTAR_STATE_LENGTH - 1] !== bluestarChecksum(raw)) return null;

  // Trailer: 11 bits in the trailer's own (longer) modulation. This is
  // REQUIRED, not optional: the base modulation and byte count are shared with
  // Voltas (mark ~1000µs, 10 bytes, MSB-first), and a Voltas frame can happen to
  // satisfy the sum-to-0xFF checksum. The trailer — which Voltas does not emit —
  // is what unambiguously identifies this protocol.
  const tr = matchData(
    timings, offset + main.used, TRAILER_BITS,
    TR_BIT_MARK, TR_ONE_SPACE, TR_BIT_MARK, TR_ZERO_SPACE,
    kTolerance, kMarkExcess, true, true,
  );
  if (!tr.success) return null;

  return extractBluestarState(raw, Number(tr.data));
}

/** Extract the state fields from a validated 10-byte Bluestar frame. */
function extractBluestarState(raw: Uint8Array, commandCode: number): BluestarState {
  return {
    power: !!(raw[2]! & 0x80),
    mode: (raw[1]! & 0x1f) as BluestarModeValue,
    fan: ((raw[1]! >> 5) & 0x07) as BluestarFanValue,
    temp: raw[3]!,
    swing: !!(raw[2]! & 0x02),
    turbo: !!(raw[2]! & 0x10),
    sleep: !!(raw[2]! & 0x40),
    light: !!(raw[2]! & 0x08),
    timer: !!(raw[8]! & 0x40),
    vaneActive: !!(raw[2]! & 0x01),
    roomTemp: raw[4]!,
    commandCode,
  };
}
