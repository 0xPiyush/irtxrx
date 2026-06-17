/**
 * Argo A/C IR protocol encoder and decoder — WREM-3 remote. (ARGO / WREM3)
 *
 * Ported from IRremoteESP8266 `ir_Argo.cpp` / `ir_Argo.h` (`IRArgoAC_WREM3`,
 * `sendArgoWREM3` / `decodeArgoWREM3`). Models the Argo Ulisse Eco (Wifi) with
 * the WREM-3 remote. Shares Argo timings but is a distinct wire format from
 * {@link sendArgo | WREM-2}.
 *
 * The WREM-3 remote sends **four** message types, distinguished by bits 6–7 of
 * byte 0 (after a fixed `0b1011` preamble nibble + a 2-bit IR channel):
 *   - **AC control** (6 bytes) — power/mode/temp/fan/flap + eco/max/night/filter/light/iFeel
 *   - **iFeel report** (2 bytes) — sensor temperature (3-bit checksum)
 *   - **Timer** (9 bytes) — clock, weekday, delay/schedule timers (5-bit checksum)
 *   - **Config** (4 bytes) — a key/value parameter
 * Each is sent MSB... no — LSB-first behind a 6400/3300 header **with** a footer.
 * The checksum width varies per message type.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Argo.cpp
 */

import { sendGenericBytes, sumBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

const HDR_MARK = 6400;
const HDR_SPACE = 3300;
const BIT_MARK = 400;
const ONE_SPACE = 2200;
const ZERO_SPACE = 900;
const GAP = 100000; // kArgoGap (kDefaultMessageGap)

const PREAMBLE = 0b1011; // kArgoWrem3Preamble
const POSTFIX_ACCONTROL = 0b110000;
const POSTFIX_TIMER = 0b1;

// Message types (byte 0 bits 6–7).
const TYPE_AC = 0b00;
const TYPE_IFEEL = 0b01;
const TYPE_TIMER = 0b10;
const TYPE_CONFIG = 0b11;

const LEN_AC = 6;
const LEN_IFEEL = 2;
const LEN_TIMER = 9;
const LEN_CONFIG = 4;

export type ArgoWrem3MessageType = "ac_control" | "ifeel" | "timer" | "config";
const TYPE_VALUE: Record<ArgoWrem3MessageType, number> = {
  ac_control: TYPE_AC, ifeel: TYPE_IFEEL, timer: TYPE_TIMER, config: TYPE_CONFIG,
};
const TYPE_NAME: Record<number, ArgoWrem3MessageType> = {
  [TYPE_AC]: "ac_control", [TYPE_IFEEL]: "ifeel", [TYPE_TIMER]: "timer", [TYPE_CONFIG]: "config",
};
const TYPE_LEN: Record<number, number> = {
  [TYPE_AC]: LEN_AC, [TYPE_IFEEL]: LEN_IFEEL, [TYPE_TIMER]: LEN_TIMER, [TYPE_CONFIG]: LEN_CONFIG,
};

export const ArgoWrem3Mode = { Cool: 1, Dry: 2, Heat: 3, Fan: 4, Auto: 5 } as const;
export type ArgoWrem3ModeValue = (typeof ArgoWrem3Mode)[keyof typeof ArgoWrem3Mode];
export const ArgoWrem3Fan = {
  Auto: 0, Lowest: 1, Lower: 2, Low: 3, Medium: 4, High: 5, Highest: 6,
} as const;
export type ArgoWrem3FanValue = (typeof ArgoWrem3Fan)[keyof typeof ArgoWrem3Fan];
export const ArgoWrem3Flap = { Auto: 0, Pos1: 1, Pos2: 2, Pos3: 3, Pos4: 4, Pos5: 5, Pos6: 6, Full: 7 } as const;
export type ArgoWrem3FlapValue = (typeof ArgoWrem3Flap)[keyof typeof ArgoWrem3Flap];
export const ArgoWrem3TimerType = { None: 0, Delay: 1, Schedule1: 2, Schedule2: 3, Schedule3: 4 } as const;
export type ArgoWrem3TimerTypeValue = (typeof ArgoWrem3TimerType)[keyof typeof ArgoWrem3TimerType];

const TEMP_MIN = 10;
const TEMP_MAX = 32;
const DELTA = 4;
const ROOM_MAX = 35;
const MAX_CHANNEL = 3;

export interface ArgoWrem3State {
  /** Which message to build (default `ac_control`). */
  messageType?: ArgoWrem3MessageType;
  /** IR channel 0–3 (all message types). */
  channel?: number;
  // --- ac_control ---
  power?: boolean;
  mode?: ArgoWrem3ModeValue;
  temp?: number; // °C 10–32
  fan?: ArgoWrem3FanValue;
  flap?: ArgoWrem3FlapValue;
  roomTemp?: number; // °C 4–35
  night?: boolean;
  eco?: boolean;
  max?: boolean;
  filter?: boolean;
  light?: boolean;
  iFeel?: boolean;
  // --- ifeel ---
  sensorTemp?: number; // °C 4–35
  // --- config ---
  configKey?: number;
  configValue?: number;
  // --- timer ---
  timerOn?: boolean;
  timerType?: ArgoWrem3TimerTypeValue;
  currentTime?: number; // minutes past midnight
  currentDay?: number; // 0=Sun … 6=Sat
  delayMinutes?: number; // 10-min resolution
  scheduleStart?: number; // minutes, 10-min resolution
  scheduleStop?: number; // minutes, 10-min resolution
  /** Active-days bitmap (bit 0 = Sunday). */
  activeDays?: number;
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
function toBytes(v: bigint, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Number((v >> BigInt(i * 8)) & 0xffn);
  return out;
}
function round10(mins: number): number {
  return Math.floor(mins / 10 + 0.5) * 10;
}

/** WREM-3 checksum (width varies by message type), matching `calcChecksum`. */
export function argoWrem3CalcChecksum(raw: Uint8Array): number {
  const len = raw.length;
  const type = raw[0]! >> 6;
  let payloadBits = (len - 1) * 8;
  if (type === TYPE_IFEEL) payloadBits += 5;
  else if (type === TYPE_TIMER) payloadBits += 3;
  let sum = sumBytes(raw, 0, Math.floor(payloadBits / 8));
  const rem = payloadBits % 8;
  if (rem) sum += raw[len - 1]! & (0xff >> (8 - rem));
  return sum & (0xff >> rem);
}

/** Verify a WREM-3 message's checksum (in its type-specific field). */
export function argoWrem3ValidChecksum(raw: Uint8Array): boolean {
  const type = raw[0]! >> 6;
  const calc = argoWrem3CalcChecksum(raw);
  switch (type) {
    case TYPE_IFEEL: return (raw[1]! >> 5) === calc;
    case TYPE_TIMER: return (raw[8]! >> 3) === calc;
    case TYPE_CONFIG: return raw[3] === calc;
    default: return raw[5] === calc;
  }
}

function hasValidPreamble(raw: Uint8Array): boolean {
  return (raw[0]! & 0x0f) === PREAMBLE;
}

/** Build the raw WREM-3 byte array for the message type in `state`. */
export function buildArgoWrem3Raw(state: ArgoWrem3State): Uint8Array {
  const type = TYPE_VALUE[state.messageType ?? "ac_control"];
  const channel = Math.min(state.channel ?? 0, MAX_CHANNEL);
  let v = 0n;
  v = setF(v, 0, 4, PREAMBLE);
  v = setF(v, 4, 2, channel);
  v = setF(v, 6, 2, type);

  switch (type) {
    case TYPE_IFEEL: {
      v = setF(v, 8, 5, clamp(state.sensorTemp ?? 25, DELTA, ROOM_MAX) - DELTA); // SensorT
      break;
    }
    case TYPE_CONFIG: {
      v = setF(v, 8, 8, (state.configKey ?? 0) & 0xff); // Key
      v = setF(v, 16, 8, (state.configValue ?? 0) & 0xff); // Value
      break;
    }
    case TYPE_TIMER: {
      v = setF(v, 8, 1, (state.timerOn ?? false) ? 1 : 0); // IsOn
      v = setF(v, 9, 3, Math.min(state.timerType ?? ArgoWrem3TimerType.None, ArgoWrem3TimerType.Schedule3)); // TimerType
      const ct = clamp(state.currentTime ?? 0, 0, 23 * 60 + 59);
      v = setF(v, 12, 4, ct & 0b1111); // CurrentTimeLo
      v = setF(v, 16, 7, ct >> 4); // CurrentTimeHi
      const day = clamp(state.currentDay ?? 0, 0, 6);
      v = setF(v, 23, 1, day & 0b1); // CurrentWeekdayLo
      v = setF(v, 24, 2, day >> 1); // CurrentWeekdayHi
      const delay = round10(clamp(state.delayMinutes ?? 0, 0, 19 * 60 + 50));
      v = setF(v, 26, 6, delay & 0b111111); // DelayTimeLo
      v = setF(v, 32, 5, delay >> 6); // DelayTimeHi
      const start = round10(clamp(state.scheduleStart ?? 0, 0, 23 * 60 + 50));
      v = setF(v, 37, 3, start & 0b111); // TimerStartLo
      v = setF(v, 40, 8, start >> 3); // TimerStartHi
      const stop = round10(clamp(state.scheduleStop ?? 0, 0, 23 * 60 + 50));
      v = setF(v, 48, 8, stop & 0xff); // TimerEndLo
      v = setF(v, 56, 3, stop >> 8); // TimerEndHi
      const days = (state.activeDays ?? 0) & 0x7f;
      v = setF(v, 59, 5, days & 0b11111); // TimerActiveDaysLo
      v = setF(v, 64, 2, days >> 5); // TimerActiveDaysHi
      v = setF(v, 66, 1, POSTFIX_TIMER); // Post1
      break;
    }
    default: { // AC_CONTROL
      v = setF(v, 8, 5, clamp(state.roomTemp ?? DELTA, DELTA, ROOM_MAX) - DELTA); // RoomTemp
      v = setF(v, 13, 3, validMode(state.mode ?? ArgoWrem3Mode.Auto)); // Mode
      v = setF(v, 16, 5, clamp(state.temp ?? 25, TEMP_MIN, TEMP_MAX) - DELTA); // Temp
      v = setF(v, 21, 3, validFan(state.fan ?? ArgoWrem3Fan.Auto)); // Fan
      v = setF(v, 24, 3, (state.flap ?? ArgoWrem3Flap.Auto) & 0b111); // Flap
      v = setF(v, 27, 1, (state.power ?? false) ? 1 : 0); // Power
      v = setF(v, 28, 1, (state.iFeel ?? false) ? 1 : 0); // iFeel
      v = setF(v, 29, 1, (state.night ?? false) ? 1 : 0); // Night
      v = setF(v, 30, 1, (state.eco ?? false) ? 1 : 0); // Eco
      v = setF(v, 31, 1, (state.max ?? false) ? 1 : 0); // Max
      v = setF(v, 32, 1, (state.filter ?? false) ? 1 : 0); // Filter
      v = setF(v, 33, 1, (state.light ?? false) ? 1 : 0); // Light
      v = setF(v, 34, 6, POSTFIX_ACCONTROL); // Post1
      break;
    }
  }

  const len = TYPE_LEN[type]!;
  const raw = toBytes(v, len);
  const sum = argoWrem3CalcChecksum(raw);
  switch (type) {
    case TYPE_IFEEL: raw[1] = (raw[1]! & 0x1f) | ((sum & 0x07) << 5); break;
    case TYPE_TIMER: raw[8] = (raw[8]! & 0x07) | ((sum & 0x1f) << 3); break;
    case TYPE_CONFIG: raw[3] = sum & 0xff; break;
    default: raw[5] = sum & 0xff; break;
  }
  return raw;
}

function validMode(m: number): number {
  return m >= ArgoWrem3Mode.Cool && m <= ArgoWrem3Mode.Auto ? m : ArgoWrem3Mode.Auto;
}
function validFan(f: number): number {
  return f >= ArgoWrem3Fan.Auto && f <= ArgoWrem3Fan.Highest ? f : ArgoWrem3Fan.Auto;
}

/** Encode a raw WREM-3 message into IR timings (`IRsend::sendArgoWREM3`). */
export function encodeArgoWrem3Raw(raw: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: GAP, data: raw, msbFirst: false, repeat,
  });
}

/** Build + encode a WREM-3 state into IR timings. */
export function sendArgoWrem3(state: ArgoWrem3State, repeat: number = 0): number[] {
  return encodeArgoWrem3Raw(buildArgoWrem3Raw(state), repeat);
}

/** Parse a validated WREM-3 message into a state object. */
export function parseArgoWrem3State(raw: Uint8Array): ArgoWrem3State {
  let v = 0n;
  for (let i = 0; i < raw.length; i++) v |= BigInt(raw[i]!) << BigInt(i * 8);
  const type = getF(v, 6, 2);
  const base: ArgoWrem3State = { messageType: TYPE_NAME[type]!, channel: getF(v, 4, 2) };

  switch (type) {
    case TYPE_IFEEL:
      return { ...base, sensorTemp: getF(v, 8, 5) + DELTA };
    case TYPE_CONFIG:
      return { ...base, configKey: getF(v, 8, 8), configValue: getF(v, 16, 8) };
    case TYPE_TIMER:
      return {
        ...base,
        timerOn: getF(v, 8, 1) === 1,
        timerType: getF(v, 9, 3) as ArgoWrem3TimerTypeValue,
        currentTime: (getF(v, 16, 7) << 4) | getF(v, 12, 4),
        currentDay: (getF(v, 24, 2) << 1) | getF(v, 23, 1),
        delayMinutes: (getF(v, 32, 5) << 6) | getF(v, 26, 6),
        scheduleStart: (getF(v, 40, 8) << 3) | getF(v, 37, 3),
        scheduleStop: (getF(v, 56, 3) << 8) | getF(v, 48, 8),
        activeDays: (getF(v, 64, 2) << 5) | getF(v, 59, 5),
      };
    default:
      return {
        ...base,
        power: getF(v, 27, 1) === 1,
        mode: getF(v, 13, 3) as ArgoWrem3ModeValue,
        temp: getF(v, 16, 5) + DELTA,
        fan: getF(v, 21, 3) as ArgoWrem3FanValue,
        flap: getF(v, 24, 3) as ArgoWrem3FlapValue,
        roomTemp: getF(v, 8, 5) + DELTA,
        iFeel: getF(v, 28, 1) === 1,
        night: getF(v, 29, 1) === 1,
        eco: getF(v, 30, 1) === 1,
        max: getF(v, 31, 1) === 1,
        filter: getF(v, 32, 1) === 1,
        light: getF(v, 33, 1) === 1,
      };
  }
}

/**
 * Decode raw IR timings as an Argo WREM-3 message (`IRrecv::decodeArgoWREM3`).
 * Tries each message length; the correct one matches the footer position, and
 * is gated on the preamble nibble, the type/length agreement, and the checksum.
 *
 * @returns Decoded state, or null on mismatch.
 */
export function decodeArgoWrem3(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): ArgoWrem3State | null {
  for (const len of [LEN_AC, LEN_TIMER, LEN_CONFIG, LEN_IFEEL]) {
    const result = matchGenericBytes(
      timings, offset, timings.length - offset, len,
      HDR_MARK, HDR_SPACE, BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
      BIT_MARK, GAP, true, undefined, 0, false, headerOptional,
    );
    if (!result) continue;
    const raw = result.data;
    if (!hasValidPreamble(raw)) continue;
    if (TYPE_LEN[raw[0]! >> 6] !== len) continue; // type must match this length
    if (!argoWrem3ValidChecksum(raw)) continue;
    return parseArgoWrem3State(raw);
  }
  return null;
}
