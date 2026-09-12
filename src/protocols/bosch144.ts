/**
 * Bosch 144-bit A/C IR protocol encoder and decoder. (BOSCH144)
 *
 * Ported from IRremoteESP8266 `ir_Bosch.{h,cpp}`.
 *
 * Supports:
 *   Brand: Bosch,    Model: CL3000i-Set 26 E A/C
 *   Brand: Bosch,    Model: RG10A(G2S)BGEF remote
 *   Brand: Durastar, Model: RG10R(M2S)/BGEFU1 remote
 *
 * An 18-byte (144-bit) MSB-first message sent as **three 6-byte sections**,
 * each with its own header (mark + space) and footer (mark + space). The
 * timings are Coolix-like, and sections 1 and 2 are in fact well-formed Coolix
 * frames (`0xB2 0x4D` signature, every byte followed by its inverse) — which is
 * why the dispatcher must try this protocol *before* Coolix, exactly as the
 * upstream library does. Section 3 (`0xD5` signature) carries the remaining
 * bits plus a byte-sum checksum.
 *
 * Mode, fan and temperature are each split across sections 1/2 and section 3,
 * so the state ↔ bytes mapping goes through lookup tables rather than plain
 * bit fields.
 *
 * Layout (bit numbering LSB = bit 0, as in the upstream C++ bit-fields):
 *
 *   Section 1 (bytes 0-5) — repeated verbatim as section 2 (bytes 6-11):
 *     byte 0  0xB2                          constant
 *     byte 1  ~byte0                        inverse
 *     byte 2  bits 7-5 FanS1, bits 4-0 unused (0b11111 without timer)
 *     byte 3  ~byte2
 *     byte 4  bits 7-4 TempS1, bits 3-2 ModeS1, bits 1-0 unused
 *     byte 5  ~byte4
 *   Section 3 (bytes 12-17):
 *     byte 12 0xD5                          constant
 *     byte 13 bit 0 ModeS3, bits 6-1 FanS3
 *     byte 14 bit 5 TempS4 (the ½-degree bit), bit 7 Quiet
 *     byte 15 bit 0 UseFahrenheit, bit 4 TempS3
 *     byte 16 unknown (0)
 *     byte 17 checksum: sum(bytes 12-16) & 0xFF
 *
 * **Power off** is a separate 96-bit message: the Coolix "Off" frame
 * (`B2 4D 7B 84 E0 1F`) sent as two sections. Because that is byte- and
 * timing-identical to a genuine Coolix off command, `decodeBosch144` decodes
 * only the strict 144-bit form (like upstream `decodeBosch144`), and the blind
 * `decode()` dispatcher reports the off frame as `coolix`. `sendBosch144`
 * emits it when `power === false`.
 */

import { sendGenericBytes, sumBytes } from "../encode.js";
import { matchGenericBytes, kTolerance, kMarkExcess } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants (µs) — from ir_Bosch.h
// ---------------------------------------------------------------------------

const HDR_MARK = 4366;
const HDR_SPACE = 4415;
const BIT_MARK = 456;
const ONE_SPACE = 1645;
const ZERO_SPACE = 610;
const FOOTER_SPACE = 5235;
/** kDefaultMessageGap — appended after the final section ("complete guess"). */
const MESSAGE_GAP = 100000;

export const BOSCH144_SECTIONS = 3;
export const BOSCH144_BYTES_PER_SECTION = 6;
export const BOSCH144_STATE_LENGTH = BOSCH144_SECTIONS * BOSCH144_BYTES_PER_SECTION; // 18
export const BOSCH144_BITS = BOSCH144_STATE_LENGTH * 8; // 144

export const BOSCH144_CELSIUS_MIN = 16;
export const BOSCH144_CELSIUS_MAX = 30;
export const BOSCH144_FAHRENHEIT_MIN = 60;
export const BOSCH144_FAHRENHEIT_MAX = 86;

/** The 96-bit (12-byte) "Off" message: the Coolix Off frame, twice. */
export const BOSCH144_OFF: Uint8Array = Uint8Array.from([
  0xb2, 0x4d, 0x7b, 0x84, 0xe0, 0x1f,
  0xb2, 0x4d, 0x7b, 0x84, 0xe0, 0x1f,
]);

/** Upstream `kBosch144DefaultState`: On, 25°C, Mode Auto. */
const DEFAULT_STATE: readonly number[] = [
  0xb2, 0x4d, 0x1f, 0xe0, 0xc8, 0x37,
  0xb2, 0x4d, 0x1f, 0xe0, 0xc8, 0x37,
  0xd5, 0x65, 0x00, 0x00, 0x00, 0x3a,
];

// ---------------------------------------------------------------------------
// Mode / fan vocabularies (raw wire values)
// ---------------------------------------------------------------------------

/** 3-bit mode: bit 0 → section 3 (ModeS3), bits 2-1 → section 1 (ModeS1). */
export const Bosch144Mode = {
  Cool: 0b000,
  Dry: 0b011,
  Auto: 0b101,
  Heat: 0b110,
  Fan: 0b010,
} as const;
export type Bosch144ModeValue = (typeof Bosch144Mode)[keyof typeof Bosch144Mode];

/** 9-bit fan: bits 5-0 → section 3 (FanS3), bits 8-6 → section 1 (FanS1). */
export const Bosch144Fan = {
  /** 20 % */
  Fan20: 0b111001010,
  /** 40 % */
  Fan40: 0b100010100,
  /** 60 % */
  Fan60: 0b010011110,
  /** 80 % */
  Fan80: 0b001101000,
  /** 100 % */
  Fan100: 0b001110010,
  Auto: 0b101110011,
  /** The Auto variant the remote emits in Auto and Dry modes. */
  Auto0: 0b000110011,
} as const;
export type Bosch144FanValue = (typeof Bosch144Fan)[keyof typeof Bosch144Fan];

/**
 * 6-bit temperature codes, index = temp - min.
 * bit 0 → TempS4, bit 1 → TempS3 (section 3); bits 5-2 → TempS1 (section 1).
 */
const CELSIUS_MAP: readonly number[] = [
  0b000010, // 16C
  0b000000, // 17C
  0b000100, // 18C
  0b001100, // 19C
  0b001000, // 20C
  0b011000, // 21C
  0b011100, // 22C
  0b010100, // 23C
  0b010000, // 24C
  0b110000, // 25C
  0b110100, // 26C
  0b100100, // 27C
  0b100000, // 28C
  0b101000, // 29C
  0b101100, // 30C
];

const FAHRENHEIT_MAP: readonly number[] = [
  0b000010, // 60F
  0b000011, // 61F
  0b000000, // 62F
  0b000001, // 63F
  0b000100, // 64F
  0b000101, // 65F
  0b001100, // 66F
  0b001101, // 67F
  0b001000, // 68F
  0b001001, // 69F
  0b011000, // 70F
  0b011001, // 71F
  0b011100, // 72F
  0b010100, // 73F
  0b010101, // 74F
  0b010000, // 75F
  0b010001, // 76F
  0b110000, // 77F
  0b110001, // 78F
  0b110100, // 79F
  0b110101, // 80F
  0b100100, // 81F
  0b100000, // 82F
  0b100001, // 83F
  0b101000, // 84F
  0b101001, // 85F
  0b101100, // 86F
];

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface Bosch144State {
  /** Default `true` (upstream `stateReset()` powers on). `false` makes
   *  {@link sendBosch144} emit the 96-bit Coolix-style Off frame instead of
   *  the 144-bit state. `decodeBosch144` only ever sees 144-bit frames and
   *  therefore always reports `true`. */
  power?: boolean;
  mode?: Bosch144ModeValue;
  /** 9-bit raw fan code. When omitted: `Auto` when `quiet` is set, `Auto0` in
   *  Auto/Dry modes (mirroring upstream `setMode`), otherwise `Auto`. */
  fan?: Bosch144FanValue;
  /** Set-point in the unit selected by `fahrenheit`: 16-30 °C or 60-86 °F.
   *  Default 25 °C / 77 °F. */
  temp?: number;
  /** Interpret and transmit `temp` in °F (sets the UseFahrenheit bit). */
  fahrenheit?: boolean;
  /** Silent mode. */
  quiet?: boolean;
}

// ---------------------------------------------------------------------------
// Bit helpers
// ---------------------------------------------------------------------------

function setBits(raw: Uint8Array, byteIdx: number, bitOffset: number, size: number, value: number) {
  const mask = ((1 << size) - 1) << bitOffset;
  raw[byteIdx] = (raw[byteIdx]! & ~mask) | ((value << bitOffset) & mask);
}

function getBits(raw: Uint8Array, byteIdx: number, bitOffset: number, size: number): number {
  return (raw[byteIdx]! >> bitOffset) & ((1 << size) - 1);
}

/** Section-3 checksum: byte-sum of bytes 12-16. */
export function bosch144Checksum(raw: Uint8Array): number {
  return sumBytes(raw, 12, 17);
}

// --- field accessors on the 18-byte image (upstream setters/getters) ---------

function setTempRaw(raw: Uint8Array, code: number) {
  setBits(raw, 4, 4, 4, code >> 2);        // TempS1 (section 1)
  setBits(raw, 10, 4, 4, code >> 2);       // TempS2 (section 2)
  setBits(raw, 15, 4, 1, (code >> 1) & 1); // TempS3 (section 3)
  setBits(raw, 14, 5, 1, code & 1);        // TempS4 (section 3)
}

function getTempRaw(raw: Uint8Array): number {
  return (getBits(raw, 4, 4, 4) << 2) | (getBits(raw, 15, 4, 1) << 1) | getBits(raw, 14, 5, 1);
}

function setFanRaw(raw: Uint8Array, speed: number) {
  setBits(raw, 2, 5, 3, speed >> 6);      // FanS1
  setBits(raw, 8, 5, 3, speed >> 6);      // FanS2
  setBits(raw, 13, 1, 6, speed & 0x3f);   // FanS3
}

function getFanRaw(raw: Uint8Array): number {
  return (getBits(raw, 2, 5, 3) << 6) | getBits(raw, 13, 1, 6);
}

function setModeRaw(raw: Uint8Array, mode: number) {
  setBits(raw, 4, 2, 2, mode >> 1);       // ModeS1
  setBits(raw, 10, 2, 2, mode >> 1);      // ModeS2
  setBits(raw, 13, 0, 1, mode & 1);       // ModeS3
}

function getModeRaw(raw: Uint8Array): number {
  return (getBits(raw, 4, 2, 2) << 1) | getBits(raw, 13, 0, 1);
}

/** Bytes 1, 3, 5, 7, 9, 11 are the inverse of the byte before them. */
function setInvertBytes(raw: Uint8Array) {
  for (let i = 0; i <= 10; i += 2) raw[i + 1] = ~raw[i]! & 0xff;
}

/** Upstream `getTemp()`: table lookup in the active unit, falling back to
 *  25 °C / 77 °F for a code that is not in the table. */
function lookupTemp(code: number, fahrenheit: boolean): number {
  const table = fahrenheit ? FAHRENHEIT_MAP : CELSIUS_MAP;
  const idx = table.indexOf(code);
  if (idx >= 0) return (fahrenheit ? BOSCH144_FAHRENHEIT_MIN : BOSCH144_CELSIUS_MIN) + idx;
  return fahrenheit ? 77 : 25;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Build the 18-byte Bosch144 state image from a state object. Unknown/unused
 * bits take the values of the upstream default state. This always returns the
 * 144-bit image, even for `power: false` — see {@link sendBosch144} for the
 * Off frame.
 */
export function buildBosch144Raw(state: Bosch144State): Uint8Array {
  const raw = Uint8Array.from(DEFAULT_STATE);

  const mode: number = state.mode ?? Bosch144Mode.Auto;
  setModeRaw(raw, mode);

  const quiet = state.quiet ?? false;
  setBits(raw, 14, 7, 1, quiet ? 1 : 0);

  // Upstream: setMode(Auto|Dry) forces Auto0; setQuiet(true) forces Auto.
  // An explicit `fan` is honoured verbatim so decode → encode is lossless.
  let fan: number;
  if (state.fan !== undefined) fan = state.fan;
  else if (quiet) fan = Bosch144Fan.Auto;
  else if (mode === Bosch144Mode.Auto || mode === Bosch144Mode.Dry) fan = Bosch144Fan.Auto0;
  else fan = Bosch144Fan.Auto;
  setFanRaw(raw, fan);

  const fahrenheit = state.fahrenheit ?? false;
  const [min, max, table] = fahrenheit
    ? [BOSCH144_FAHRENHEIT_MIN, BOSCH144_FAHRENHEIT_MAX, FAHRENHEIT_MAP]
    : [BOSCH144_CELSIUS_MIN, BOSCH144_CELSIUS_MAX, CELSIUS_MAP];
  const temp = Math.min(Math.max(Math.round(state.temp ?? (fahrenheit ? 77 : 25)), min), max);
  setTempRaw(raw, table[temp - min]!);
  setBits(raw, 15, 0, 1, fahrenheit ? 1 : 0);

  setInvertBytes(raw);
  raw[17] = bosch144Checksum(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// Send / encode
// ---------------------------------------------------------------------------

/**
 * Encode a state as IR timings. `power: false` emits the 96-bit Off frame
 * (upstream `IRBosch144AC::send`); anything else emits the 144-bit state.
 */
export function sendBosch144(state: Bosch144State, repeat = 0): number[] {
  if (state.power === false) return encodeBosch144Raw(BOSCH144_OFF, repeat);
  return encodeBosch144Raw(buildBosch144Raw(state), repeat);
}

/**
 * Encode raw Bosch144 bytes into IR timings (upstream `IRsend::sendBosch144`).
 * `data.length` must be a multiple of 6; each 6-byte section gets its own
 * header + footer, and the whole message is followed by a 100 ms gap.
 */
export function encodeBosch144Raw(data: Uint8Array, repeat = 0): number[] {
  if (data.length === 0 || data.length % BOSCH144_BYTES_PER_SECTION !== 0) {
    throw new RangeError(
      `irtxrx: Bosch144 payload must be a non-zero multiple of ${BOSCH144_BYTES_PER_SECTION} bytes (got ${data.length})`,
    );
  }
  const result: number[] = [];
  for (let r = 0; r <= repeat; r++) {
    for (let off = 0; off < data.length; off += BOSCH144_BYTES_PER_SECTION) {
      const section = sendGenericBytes({
        headerMark: HDR_MARK, headerSpace: HDR_SPACE,
        oneMark: BIT_MARK, oneSpace: ONE_SPACE,
        zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
        footerMark: BIT_MARK, gap: FOOTER_SPACE,
        data: data.subarray(off, off + BOSCH144_BYTES_PER_SECTION), msbFirst: true,
      });
      for (let i = 0; i < section.length; i++) result.push(section[i]!);
    }
    // space(kDefaultMessageGap) merges into the last section's footer space.
    result[result.length - 1] = result[result.length - 1]! + MESSAGE_GAP;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Match the three 6-byte sections and return the raw 18-byte image, or null.
 * Only the first section's header is optional (`headerOptional`) — sections 2
 * and 3 follow an inter-section space and always keep theirs.
 */
export function decodeBosch144Raw(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): { data: Uint8Array; used: number } | null {
  // Minimum: 288 data timings + 3 footer marks + the two inter-section footer
  // spaces + the headers of sections 2 and 3 (4) = 297, plus section 1's
  // header (2) unless it is optional. The trailing gap may be absent.
  const minLen = BOSCH144_BITS * 2 + BOSCH144_SECTIONS + (BOSCH144_SECTIONS - 1) * 3 + (headerOptional ? 0 : 2);
  if (timings.length - offset < minLen) return null;

  const raw = new Uint8Array(BOSCH144_STATE_LENGTH);
  let pos = offset;
  for (let s = 0; s < BOSCH144_SECTIONS; s++) {
    const last = s === BOSCH144_SECTIONS - 1;
    const m = matchGenericBytes(
      timings, pos, timings.length - pos, BOSCH144_BYTES_PER_SECTION,
      HDR_MARK, HDR_SPACE,
      BIT_MARK, ONE_SPACE,
      BIT_MARK, ZERO_SPACE,
      BIT_MARK, FOOTER_SPACE,
      last, kTolerance, kMarkExcess, true, s === 0 && headerOptional,
    );
    if (!m) return null;
    raw.set(m.data, s * BOSCH144_BYTES_PER_SECTION);
    pos += m.used;
  }
  return { data: raw, used: pos - offset };
}

/** Structural validation beyond the upstream decoder (which has none): the
 *  section signatures, the inverse byte pairs of sections 1/2, and the
 *  section-3 checksum. */
export function isValidBosch144(raw: Uint8Array): boolean {
  if (raw.length !== BOSCH144_STATE_LENGTH) return false;
  if (raw[0] !== 0xb2 || raw[6] !== 0xb2 || raw[12] !== 0xd5) return false;
  for (let i = 0; i <= 10; i += 2) {
    if (raw[i + 1] !== (~raw[i]! & 0xff)) return false;
  }
  return raw[17] === bosch144Checksum(raw);
}

/**
 * Decode raw IR timings as a Bosch144 state.
 *
 * @param timings Raw mark/space timing array in microseconds.
 * @param offset  Starting index in the timings array (default 0).
 * @param headerOptional Allow the first section's header to be missing.
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeBosch144(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Bosch144State | null {
  const m = decodeBosch144Raw(timings, offset, headerOptional);
  if (!m) return null;
  if (!isValidBosch144(m.data)) return null;
  return parseBosch144State(m.data);
}

/** Extract the state fields from a validated 18-byte image (upstream getters). */
export function parseBosch144State(raw: Uint8Array): Bosch144State {
  const fahrenheit = getBits(raw, 15, 0, 1) === 1;
  return {
    power: true,
    mode: getModeRaw(raw) as Bosch144ModeValue,
    fan: getFanRaw(raw) as Bosch144FanValue,
    temp: lookupTemp(getTempRaw(raw), fahrenheit),
    fahrenheit,
    quiet: getBits(raw, 14, 7, 1) === 1,
  };
}
