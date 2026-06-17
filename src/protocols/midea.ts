/**
 * Midea A/C IR protocol encoder and decoder. (MIDEA)
 *
 * Ported from IRremoteESP8266 `ir_Midea.cpp` / `ir_Midea.h` — full coverage of
 * the `IRMideaAC` class and the `sendMidea` / `decodeMidea` wire format.
 * Models: Pioneer, Comfee, Kaysun, Keystone, MrCool, Danby, Trotec, Lennox …
 *
 * Wire format: a 48-bit value sent MSB-first, then **repeated with every bit
 * inverted**; each phase is framed by a 4480/4480 header and a bit-mark + ≈5.6ms
 * gap. byte 0 (LSB) is a checksum; byte 5 carries the fixed `0b10100` header
 * nibble + a 3-bit message type (command / special / follow-me).
 *
 * The main message carries power / mode / fan / temp / sleep, plus — depending
 * on the message type — either a FollowMe sensor temperature (`Type=Follow`) or
 * an On-Timer (`Type=Command`, sharing byte 1), and an Off-Timer (byte 2).
 *
 * `IRMideaAC::send()` additionally emits one-shot **special messages** after the
 * main frame for any pending toggle (swing-V, econo, turbo, light, self-clean,
 * 8 °C-heat) and for a quiet on/off change. These are fixed opaque 48-bit codes;
 * {@link sendMidea} reproduces that sequence, and {@link decodeMidea} recognises
 * a standalone special code via {@link MideaState.special}.
 *
 * Temperature is modelled in its native unit: Celsius (17–30 °C) by default, or
 * Fahrenheit (62–86 °F) when {@link MideaState.celsius} is false.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Midea.cpp
 */

import { encodeData, reverseBits } from "../encode.js";
import { matchGeneric, kMarkExcess } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Midea.cpp exactly (tick = 80µs)
// ---------------------------------------------------------------------------

const TICK = 80;
const BIT_MARK = 7 * TICK; // 560
const ONE_SPACE = 21 * TICK; // 1680
const ZERO_SPACE = 7 * TICK; // 560
const HDR_MARK = 56 * TICK; // 4480
const HDR_SPACE = 56 * TICK; // 4480
const MIN_GAP = (56 + 7 + 7) * TICK; // 5600
const MESSAGE_GAP = 100000; // kDefaultMessageGap
/** kMideaTolerance — 30% (wider than the 25% default). */
const TOLERANCE = 30;

export const MIDEA_BITS = 48;
const MASK = (1n << 48n) - 1n;

/** stateReset(): Power On, Mode Auto, Fan Auto, 25°C / 77°F, sensor disabled. */
const BASE_STATE = 0xa1826fffff62n;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const MideaMode = {
  Cool: 0,
  Dry: 1,
  Auto: 2,
  Heat: 3,
  Fan: 4,
} as const;
export type MideaModeValue = (typeof MideaMode)[keyof typeof MideaMode];

export const MideaFan = {
  Auto: 0,
  Low: 1,
  Med: 2,
  High: 3,
} as const;
export type MideaFanValue = (typeof MideaFan)[keyof typeof MideaFan];

const TEMP_MIN_C = 17;
const TEMP_MAX_C = 30;
const TEMP_MIN_F = 62;
const TEMP_MAX_F = 86;
const SENSOR_MIN_C = 0;
const SENSOR_MAX_C = 37;
const SENSOR_MIN_F = 32;
const SENSOR_MAX_F = 99;
const SENSOR_ONTIMER_OFF = 0b1111111; // kMideaACSensorTempOnTimerOff (0x7F)
const TIMER_OFF = 0b111111; // kMideaACTimerOff (0x3F)
const TIMER_MAX_MINS = 24 * 60;

// Message types (byte 5, bits 40-42).
const TYPE_COMMAND = 0b001;
const TYPE_SPECIAL = 0b010;
const TYPE_FOLLOW = 0b100;

// Bit positions within the 48-bit value (byte 0 = least-significant byte).
const POS_SUM = 0n;
const POS_SENSOR_TEMP = 8n; // byte 1, bits 0-6
const POS_DISABLE_SENSOR = 15n; // byte 1, bit 7
const POS_OFF_TIMER = 17n; // byte 2, bits 1-6
const POS_BEEP_DISABLE = 23n; // byte 2, bit 7
const POS_TEMP = 24n; // byte 3, bits 0-4
const POS_FAHRENHEIT = 29n; // byte 3, bit 5
const POS_MODE = 32n; // byte 4, bits 0-2
const POS_FAN = 35n; // byte 4, bits 3-4
const POS_SLEEP = 38n; // byte 4, bit 6
const POS_POWER = 39n; // byte 4, bit 7
const POS_TYPE = 40n; // byte 5, bits 0-2

// ---------------------------------------------------------------------------
// Special / toggle one-shot codes (ir_Midea.h) — fixed opaque 48-bit values.
// ---------------------------------------------------------------------------

const TOGGLE_SWINGV = 0xa201ffffff7cn;
const TOGGLE_ECONO = 0xa202ffffff7en;
const TOGGLE_LIGHT = 0xa208ffffff75n;
const TOGGLE_TURBO = 0xa209ffffff74n;
const TOGGLE_SELF_CLEAN = 0xa20dffffff70n;
const TOGGLE_8C_HEAT = 0xa20fffffff73n;
const QUIET_ON = 0xa212ffffff6en;
const QUIET_OFF = 0xa213ffffff6fn;

export type MideaSpecial =
  | "swing_v_toggle"
  | "econo_toggle"
  | "light_toggle"
  | "turbo_toggle"
  | "clean_toggle"
  | "8c_heat_toggle"
  | "quiet_on"
  | "quiet_off";

/** Map of standalone special codes ↔ their {@link MideaSpecial} name. */
export const MIDEA_SPECIALS: Readonly<Record<MideaSpecial, bigint>> = {
  swing_v_toggle: TOGGLE_SWINGV,
  econo_toggle: TOGGLE_ECONO,
  light_toggle: TOGGLE_LIGHT,
  turbo_toggle: TOGGLE_TURBO,
  clean_toggle: TOGGLE_SELF_CLEAN,
  "8c_heat_toggle": TOGGLE_8C_HEAT,
  quiet_on: QUIET_ON,
  quiet_off: QUIET_OFF,
};

const SPECIAL_BY_CODE = new Map<bigint, MideaSpecial>(
  (Object.entries(MIDEA_SPECIALS) as [MideaSpecial, bigint][]).map(([k, v]) => [v, k]),
);

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface MideaState {
  power?: boolean;
  mode?: MideaModeValue;
  fan?: MideaFanValue;
  /** Whether {@link temp}/{@link sensorTemp} are Celsius. Defaults to true. */
  celsius?: boolean;
  /** Temperature in the native unit: °C (17–30) by default, °F (62–86). */
  temp?: number;
  sleep?: boolean;
  /**
   * FollowMe sensor temperature in the native unit (°C 0–37 / °F 32–99).
   * Setting it enables FollowMe (message type → Follow). Mutually exclusive
   * with {@link onTimer}.
   */
  sensorTemp?: number;
  /**
   * On-Timer in minutes (rounded down to 30-min steps; < 30 disables). Shares
   * byte 1 with the sensor, so it forces a Command-type message and clears
   * FollowMe.
   */
  onTimer?: number;
  /** Off-Timer in minutes (rounded down to 30-min steps; < 30 disables). */
  offTimer?: number;
  /** Append a one-shot vertical-swing toggle message after the main frame. */
  swingVToggle?: boolean;
  econoToggle?: boolean;
  turboToggle?: boolean;
  lightToggle?: boolean;
  /** Self-clean toggle — only emitted in Cool/Dry/Auto mode. */
  cleanToggle?: boolean;
  /** 8 °C-heat (freeze protect) toggle — only emitted in Heat mode. */
  eightCHeatToggle?: boolean;
  /** Quiet (silent). Emits a Quiet on/off special when it differs from
   *  {@link quietPrev}. */
  quiet?: boolean;
  /** The previous quiet state (defaults to false), per `IRMideaAC::send`. */
  quietPrev?: boolean;
  /** Set by decode when the captured frame is a standalone special code; when
   *  present, {@link sendMidea} emits only that code. */
  special?: MideaSpecial;
}

// ---------------------------------------------------------------------------
// Bit + checksum helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function getField(v: bigint, pos: bigint, width: number): number {
  return Number((v >> pos) & ((1n << BigInt(width)) - 1n));
}

function setField(v: bigint, pos: bigint, width: number, val: number): bigint {
  const mask = ((1n << BigInt(width)) - 1n) << pos;
  return (v & ~mask) | ((BigInt(val) << pos) & mask);
}

/**
 * Compute the Midea checksum (stored in byte 0).
 *
 * Matches `IRMideaAC::calcChecksum`: sum the bit-reversed bytes 1–5, negate
 * mod 256, then bit-reverse the result.
 */
export function mideaCalcChecksum(state: bigint): number {
  let sum = 0;
  let temp = state;
  for (let i = 0; i < 5; i++) {
    temp >>= 8n;
    sum += reverseBits(Number(temp & 0xffn), 8);
  }
  sum = (256 - (sum & 0xff)) & 0xff;
  return reverseBits(sum, 8) & 0xff;
}

/** Verify the byte-0 checksum of a 48-bit Midea value. */
export function mideaValidChecksum(state: bigint): boolean {
  return Number((state >> POS_SUM) & 0xffn) === mideaCalcChecksum(state);
}

/** Apply the byte-0 checksum to a value (mirrors `getRaw`'s `checksum()`). */
function withChecksum(v: bigint): bigint {
  return ((v & ~0xffn) | BigInt(mideaCalcChecksum(v))) & MASK;
}

/** Set the message type field, mirroring `IRMideaAC::setType` (incl. beep). */
function setType(v: bigint, type: number): bigint {
  switch (type) {
    case TYPE_FOLLOW:
      v = setField(v, POS_BEEP_DISABLE, 1, 0);
      return setField(v, POS_TYPE, 3, TYPE_FOLLOW);
    case TYPE_SPECIAL:
      return setField(v, POS_TYPE, 3, TYPE_SPECIAL);
    default:
      v = setField(v, POS_TYPE, 3, TYPE_COMMAND);
      return setField(v, POS_BEEP_DISABLE, 1, 1);
  }
}

function validMode(mode: number): number {
  return mode >= MideaMode.Cool && mode <= MideaMode.Fan ? mode : MideaMode.Auto;
}

// ---------------------------------------------------------------------------
// Build raw 48-bit value — mirrors the IRMideaAC setter sequence
// ---------------------------------------------------------------------------

/**
 * Build the raw 48-bit Midea **main** message value from a state object.
 *
 * Reproduces `stateReset()` then `setUseCelsius` / `setPower` / `setMode` /
 * `setFan` / `setTemp` / `setSleep`, followed by the FollowMe-sensor, On-Timer
 * and Off-Timer settings (in that precedence, since the sensor and On-Timer
 * share byte 1), then recomputes the checksum. Toggle/quiet specials are not
 * part of this value — see {@link sendMidea}.
 */
export function buildMideaRaw(state: MideaState): bigint {
  let v = BASE_STATE;
  const celsius = state.celsius ?? true;

  v = setField(v, POS_FAHRENHEIT, 1, celsius ? 0 : 1);
  v = setField(v, POS_POWER, 1, (state.power ?? true) ? 1 : 0);
  const mode = validMode(state.mode ?? MideaMode.Auto);
  v = setField(v, POS_MODE, 3, mode);
  const fan = (state.fan ?? MideaFan.Auto) > MideaFan.High ? MideaFan.Auto : (state.fan ?? MideaFan.Auto);
  v = setField(v, POS_FAN, 2, fan);
  const tempField = celsius
    ? clamp(state.temp ?? 25, TEMP_MIN_C, TEMP_MAX_C) - TEMP_MIN_C
    : clamp(state.temp ?? 77, TEMP_MIN_F, TEMP_MAX_F) - TEMP_MIN_F;
  v = setField(v, POS_TEMP, 5, tempField);
  v = setField(v, POS_SLEEP, 1, state.sleep ? 1 : 0);

  // FollowMe sensor (Type → Follow). Mirrors setSensorTemp + setEnableSensorTemp.
  if (state.sensorTemp !== undefined) {
    const min = celsius ? SENSOR_MIN_C : SENSOR_MIN_F;
    const max = celsius ? SENSOR_MAX_C : SENSOR_MAX_F;
    v = setField(v, POS_SENSOR_TEMP, 7, clamp(state.sensorTemp, min, max) - min + 1);
    v = setField(v, POS_DISABLE_SENSOR, 1, 0);
    v = setType(v, TYPE_FOLLOW);
  }

  // On-Timer shares byte 1, so it disables the sensor and forces Command type.
  if (state.onTimer !== undefined) {
    v = setField(v, POS_DISABLE_SENSOR, 1, 1);
    v = setType(v, TYPE_COMMAND);
    const halfHours = Math.floor(clamp(state.onTimer, 0, TIMER_MAX_MINS) / 30);
    v = setField(v, POS_SENSOR_TEMP, 7, halfHours ? (((halfHours - 1) << 1) | 1) : SENSOR_ONTIMER_OFF);
  }

  if (state.offTimer !== undefined) {
    const halfHours = Math.floor(clamp(state.offTimer, 0, TIMER_MAX_MINS) / 30);
    v = setField(v, POS_OFF_TIMER, 6, halfHours ? halfHours - 1 : TIMER_OFF);
  }

  return withChecksum(v);
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a raw 48-bit Midea value into IR timings (a single message).
 *
 * Matches IRremoteESP8266 `IRsend::sendMidea`: the value sent MSB-first, then
 * the same value with every bit inverted; both phases header-framed and
 * bit-mark/gap-terminated. The final gap absorbs the inter-message gap
 * (→ MIN_GAP + 100ms), matching the C++ test harness merging consecutive spaces.
 */
export function encodeMideaRaw(data: bigint, repeat: number = 0): number[] {
  const out: number[] = [];
  const phase = (value: bigint, lastGap: number): void => {
    out.push(HDR_MARK, HDR_SPACE);
    for (const t of encodeData(BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE, value & MASK, MIDEA_BITS, true)) out.push(t);
    out.push(BIT_MARK, lastGap);
  };
  for (let r = 0; r <= repeat; r++) {
    phase(data, MIN_GAP); // normal
    phase(~data & MASK, MIN_GAP + MESSAGE_GAP); // inverted
  }
  return out;
}

/**
 * Encode a Midea state into IR timings.
 *
 * Mirrors `IRMideaAC::send`: the main message, followed by one-shot special
 * messages for each pending toggle (swing-V, econo, turbo, light; self-clean in
 * Cool/Dry/Auto, 8 °C-heat in Heat) and a quiet on/off change. If
 * {@link MideaState.special} is set, only that one special code is emitted.
 */
export function sendMidea(state: MideaState, repeat: number = 0): number[] {
  if (state.special !== undefined) return encodeMideaRaw(MIDEA_SPECIALS[state.special], repeat);

  const out = encodeMideaRaw(buildMideaRaw(state), repeat);
  const append = (code: bigint): void => {
    for (const t of encodeMideaRaw(code, repeat)) out.push(t);
  };

  if (state.swingVToggle) append(TOGGLE_SWINGV);
  if (state.econoToggle) append(TOGGLE_ECONO);
  if (state.turboToggle) append(TOGGLE_TURBO);
  if (state.lightToggle) append(TOGGLE_LIGHT);

  const mode = validMode(state.mode ?? MideaMode.Auto);
  if (mode <= MideaMode.Auto) {
    if (state.cleanToggle) append(TOGGLE_SELF_CLEAN);
  } else if (mode === MideaMode.Heat) {
    if (state.eightCHeatToggle) append(TOGGLE_8C_HEAT);
  }

  if ((state.quiet ?? false) !== (state.quietPrev ?? false)) append(state.quiet ? QUIET_ON : QUIET_OFF);

  return out;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Parse a validated 48-bit Midea main-message value into a state object. */
export function parseMideaState(data: bigint): MideaState {
  const celsius = getField(data, POS_FAHRENHEIT, 1) === 0;
  const tempField = getField(data, POS_TEMP, 5);
  const type = getField(data, POS_TYPE, 3);
  const sensorRaw = getField(data, POS_SENSOR_TEMP, 7);

  const s: MideaState = {
    power: getField(data, POS_POWER, 1) === 1,
    mode: getField(data, POS_MODE, 3) as MideaModeValue,
    fan: getField(data, POS_FAN, 2) as MideaFanValue,
    celsius,
    temp: celsius ? tempField + TEMP_MIN_C : tempField + TEMP_MIN_F,
    sleep: getField(data, POS_SLEEP, 1) === 1,
  };

  if (type === TYPE_FOLLOW) {
    const min = celsius ? SENSOR_MIN_C : SENSOR_MIN_F;
    s.sensorTemp = sensorRaw - 1 + min;
  } else if (sensorRaw !== SENSOR_ONTIMER_OFF) {
    // Command-type with an On-Timer set (shares byte 1 with the sensor).
    s.onTimer = (sensorRaw >> 1) * 30 + 30;
  }

  const offTimer = getField(data, POS_OFF_TIMER, 6);
  if (offTimer !== TIMER_OFF) s.offTimer = offTimer * 30 + 30;

  return s;
}

/** Match a single Midea message (normal + inverted phases) at `offset`,
 *  returning the validated 48-bit value and entries consumed, or null. */
function matchMideaMessage(
  timings: number[],
  offset: number,
  headerOptional: boolean,
): { value: bigint; used: number } | null {
  const p1 = matchGeneric(
    timings, offset, timings.length - offset, MIDEA_BITS,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MIN_GAP, false, TOLERANCE, kMarkExcess, true, headerOptional,
  );
  if (!p1) return null;
  const p2 = matchGeneric(
    timings, offset + p1.used, timings.length - offset - p1.used, MIDEA_BITS,
    HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, MIN_GAP, true, TOLERANCE, kMarkExcess, true, false,
  );
  if (!p2) return null;

  const data = p1.data & MASK;
  if (data !== ((p2.data & MASK) ^ MASK)) return null; // 2nd phase = inverse
  if (!mideaValidChecksum(data)) return null;
  return { value: data, used: p1.used + p2.used };
}

/**
 * Decode raw IR timings as a Midea A/C message.
 *
 * Mirrors `IRrecv::decodeMidea`: match the normal phase, then the inverted
 * phase, verify the second is the bitwise inverse of the first, and validate
 * the checksum. A recognised standalone special/toggle code is returned via
 * {@link MideaState.special}; any other valid frame is parsed as a main message.
 *
 * @returns Decoded state, or null on mismatch / failed inversion / bad checksum.
 */
export function decodeMidea(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): MideaState | null {
  const m = matchMideaMessage(timings, offset, headerOptional);
  if (!m) return null;
  const special = SPECIAL_BY_CODE.get(m.value);
  return special !== undefined ? { special } : parseMideaState(m.value);
}
