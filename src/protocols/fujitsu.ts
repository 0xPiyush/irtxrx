/**
 * Fujitsu A/C IR protocol encoder and decoder. (FUJITSU_AC)
 *
 * Ported from IRremoteESP8266 `ir_Fujitsu.cpp` / `ir_Fujitsu.h`.
 * Brands/models: Fujitsu, Fujitsu General, OGeneral — remotes AR-RAH2E /
 * AR-DB1 / AR-REB1E / AR-JW2 / AR-RY4 / AR-REW4E (models ARRAH2E, ARDB1,
 * ARREB1E, ARJW2, ARRY4, ARREW4E) and the OGeneral AR-RCL1E (ARRAH2E).
 *
 * Header 3324/1574, LSB-first. Frames are one of four fixed lengths:
 *   - 6 bytes  — short command (ARDB1 / ARJW2)
 *   - 7 bytes  — short command (ARRAH2E / ARREB1E / ARRY4 / ARREW4E)
 *   - 15 bytes — full state (ARDB1 / ARJW2)
 *   - 16 bytes — full state (ARRAH2E / ARREB1E / ARRY4 / ARREW4E)
 *
 * Every frame begins with the fixed `0x14 0x63` header bytes; integrity is a
 * size-dependent checksum (byte-sum for the long codes, penultimate-byte
 * inversion for the 7-byte short code, none for the 6-byte short code).
 *
 * Two layers are provided:
 *   - **Raw** — {@link encodeFujitsuRaw} / {@link decodeFujitsuRaw} operate on
 *     the verbatim byte array (capture & replay, lossless).
 *   - **Semantic** — {@link FujitsuState} + {@link buildFujitsuRaw} /
 *     {@link parseFujitsuState} / {@link sendFujitsu} / {@link decodeFujitsu}
 *     mirror `IRFujitsuAC` so fields can be set/read programmatically.
 *
 * @warning Sending a frame built for the wrong `model` can lock up some A/C
 *   units (per the upstream library). Match the model to your remote.
 * @see https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Fujitsu.cpp
 */

import { sendGenericBytes, sumBytes } from "../encode.js";
import { matchGenericBytes } from "../decode.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Fujitsu.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3324;
const HDR_SPACE = 1574;
const BIT_MARK = 448;
const ONE_SPACE = 1182;
const ZERO_SPACE = 390;
const MIN_GAP = 8100;
/** _tolerance(25) + kFujitsuAcExtraTolerance(5). */
const TOLERANCE = 30;

export const FUJITSU_AC_STATE_LENGTH = 16;
export const FUJITSU_AC_STATE_LENGTH_SHORT = 7;

/** Fixed header bytes that prefix every Fujitsu frame. */
const SIG0 = 0x14;
const SIG1 = 0x63;
/** Byte 5 (`Cmd`) marker values that indicate a full (long) code. */
const LONG_CMD_16 = 0xfe; // ARRAH2E / ARREB1E / ARRY4 / ARREW4E
const LONG_CMD_15 = 0xfc; // ARDB1 / ARJW2

/** Valid frame lengths in bytes, longest first (decode probe order). */
export const FUJITSU_AC_LENGTHS: readonly number[] = [16, 15, 7, 6];

// ---------------------------------------------------------------------------
// Enumerations / constants
// ---------------------------------------------------------------------------

/** Remote model numbers (match `fujitsu_ac_remote_model_t`). */
export const FujitsuModel = {
  ARRAH2E: 1,
  ARDB1: 2,
  ARREB1E: 3,
  ARJW2: 4,
  ARRY4: 5,
  ARREW4E: 6,
} as const;
export type FujitsuModelValue = (typeof FujitsuModel)[keyof typeof FujitsuModel];

export const FujitsuMode = {
  Auto: 0,
  Cool: 1,
  Dry: 2,
  Fan: 3,
  Heat: 4,
} as const;
export type FujitsuModeValue = (typeof FujitsuMode)[keyof typeof FujitsuMode];

export const FujitsuFan = {
  Auto: 0,
  High: 1,
  Med: 2,
  Low: 3,
  Quiet: 4,
} as const;
export type FujitsuFanValue = (typeof FujitsuFan)[keyof typeof FujitsuFan];

export const FujitsuSwing = {
  Off: 0,
  Vert: 1,
  Horiz: 2,
  Both: 3,
} as const;
export type FujitsuSwingValue = (typeof FujitsuSwing)[keyof typeof FujitsuSwing];

/** Special command codes (produce short frames). */
export const FujitsuCmd = {
  StayOn: 0x00,
  TurnOn: 0x01,
  TurnOff: 0x02,
  Econo: 0x09,
  Powerful: 0x39,
  StepVert: 0x6c,
  ToggleSwingVert: 0x6d,
  StepHoriz: 0x79,
  ToggleSwingHoriz: 0x7a,
} as const;
export type FujitsuCmdValue = (typeof FujitsuCmd)[keyof typeof FujitsuCmd];

export const FujitsuTimer = {
  Stop: 0,
  Sleep: 1,
  Off: 2,
  On: 3,
} as const;
export type FujitsuTimerValue = (typeof FujitsuTimer)[keyof typeof FujitsuTimer];

const TIMER_MAX = 12 * 60; // minutes
const MODE_MAX = FujitsuMode.Heat;
const FAN_MAX = FujitsuFan.Quiet;

/** Commands that are sent as short frames. */
const SHORT_CMDS = new Set<number>([
  FujitsuCmd.TurnOff, FujitsuCmd.Econo, FujitsuCmd.Powerful,
  FujitsuCmd.StepVert, FujitsuCmd.ToggleSwingVert,
  FujitsuCmd.StepHoriz, FujitsuCmd.ToggleSwingHoriz,
]);

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
function isShortModel(model: number): boolean {
  return model === FujitsuModel.ARDB1 || model === FujitsuModel.ARJW2;
}

// ---------------------------------------------------------------------------
// Checksum / integrity (raw layer)
// ---------------------------------------------------------------------------

/**
 * Validate a Fujitsu frame's header + size-specific integrity.
 *
 * Mirrors `IRFujitsuAC::validChecksum` plus the per-size compliance checks in
 * `IRrecv::decodeFujitsuAC` (the `Cmd` byte must agree with the frame length).
 */
export function validFujitsuFrame(data: Uint8Array): boolean {
  const len = data.length;
  if (len < 6) return false;
  if (data[0] !== SIG0 || data[1] !== SIG1) return false;
  const cmd = data[5]!;
  switch (len) {
    case 16:
      if (cmd !== LONG_CMD_16) return false;
      return data[15] === ((-sumBytes(data, 7, 15)) & 0xff);
    case 15:
      if (cmd !== LONG_CMD_15) return false;
      return data[14] === ((0x9b - sumBytes(data, 0, 14)) & 0xff);
    case 7:
      if (cmd === LONG_CMD_16) return false;
      return data[6] === ((~cmd) & 0xff);
    case 6:
      return cmd !== LONG_CMD_15;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Raw encode / decode
// ---------------------------------------------------------------------------

/**
 * Encode a raw Fujitsu payload (6/7/15/16 bytes) into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendFujitsuAC` (header 3324/1574, LSB-first,
 * bit-mark footer + 8100µs gap). The payload is sent verbatim.
 */
export function encodeFujitsuRaw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK, headerSpace: HDR_SPACE,
    oneMark: BIT_MARK, oneSpace: ONE_SPACE, zeroMark: BIT_MARK, zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK, gap: MIN_GAP,
    data, msbFirst: false, repeat,
  });
}

/**
 * Decode raw IR timings as a Fujitsu A/C message into the verbatim byte array.
 *
 * Tries each valid length (longest first) and returns the first that frames
 * cleanly and passes {@link validFujitsuFrame}.
 */
export function decodeFujitsuRaw(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Uint8Array | null {
  for (const nbytes of FUJITSU_AC_LENGTHS) {
    const frame = matchGenericBytes(
      timings, offset, timings.length - offset, nbytes,
      HDR_MARK, HDR_SPACE,
      BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
      BIT_MARK, MIN_GAP,
      // C++ decodeFujitsuAC pins mark-excess to 0 (not the global 50µs).
      true, TOLERANCE, 0, false,
      headerOptional,
    );
    if (frame && validFujitsuFrame(frame.data)) return frame.data;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Semantic state
// ---------------------------------------------------------------------------

export interface FujitsuState {
  /** Remote model (default ARRAH2E — the OGeneral AR-RCL1E variant). */
  model?: FujitsuModelValue;
  /** Device/remote id, 0–3. */
  id?: number;
  /** Power on/off. Ignored when `command` is a special (short) command. */
  power?: boolean;
  mode?: FujitsuModeValue;
  /** Temperature in degrees of `celsius` units. */
  temp?: number;
  /** Celsius (true, default) or Fahrenheit (only honoured for ARREW4E). */
  celsius?: boolean;
  fan?: FujitsuFanValue;
  /** Vertical louver swing (default on, mirroring the remote's reset state). */
  swingV?: boolean;
  /** Horizontal louver swing (only ARRAH2E / ARJW2 support it). */
  swingH?: boolean;
  clean?: boolean;
  filter?: boolean;
  /** Outside-unit quiet mode (ARREB1E / ARREW4E only). */
  outsideQuiet?: boolean;
  /** 10°C heat / minimum-heat mode (ARRAH2E / ARREW4E only). */
  tenCHeat?: boolean;
  timerType?: FujitsuTimerValue;
  /** Timer value in minutes (0–720) for the active `timerType`. */
  timerMinutes?: number;
  /** Special command — when set (and not StayOn/TurnOn) produces a short frame. */
  command?: FujitsuCmdValue;
}

// Mutable working set mirroring the C++ `FujitsuProtocol` bitfield + `_cmd`.
interface Working {
  model: number; id: number; cmd: number;
  mode: number; temp: number; fahrenheit: number;
  fan: number; swing: number; clean: number; filter: number;
  outsideQuiet: number; timerType: number; onTimer: number; offTimer: number;
}

function fahrenheitToCelsius(f: number): number { return (f - 32) * 5 / 9; }

/** Replicates `IRFujitsuAC::setTemp`. */
function applyTemp(w: Working, temp: number, celsius: boolean): void {
  let useCelsius: boolean;
  let t: number;
  if (w.model === FujitsuModel.ARREW4E) {
    useCelsius = celsius;
    t = temp;
  } else {
    useCelsius = true;
    t = celsius ? temp : fahrenheitToCelsius(temp);
  }
  w.fahrenheit = useCelsius ? 0 : 1;
  if (useCelsius) {
    t = clamp(t, 16, 30);
    w.temp = (w.model === FujitsuModel.ARREW4E)
      ? Math.round((t - 8) * 2)
      : Math.round((t - 16) * 4);
  } else {
    t = clamp(t, 60, 88);
    w.temp = Math.round(t - 44);
  }
}

/** Replicates `IRFujitsuAC::setSwing` model clamping. */
function applySwing(w: Working, swing: number): void {
  switch (w.model) {
    case FujitsuModel.ARDB1:
    case FujitsuModel.ARREB1E:
    case FujitsuModel.ARRY4:
      w.swing = swing > FujitsuSwing.Vert ? FujitsuSwing.Vert : swing;
      break;
    default: // ARRAH2E, ARJW2, ARREW4E
      w.swing = swing > FujitsuSwing.Both ? FujitsuSwing.Both : swing;
  }
}

/** True if the working state currently represents 10°C-heat (get10CHeat). */
function is10CHeat(w: Working): boolean {
  if (w.model !== FujitsuModel.ARRAH2E && w.model !== FujitsuModel.ARREW4E) return false;
  return w.clean === 1 && w.mode === FujitsuMode.Fan &&
    w.fan === FujitsuFan.Auto && w.swing === FujitsuSwing.Off;
}

/** Build the raw Fujitsu frame (verbatim bytes incl. checksum) from a state. */
export function buildFujitsuRaw(state: FujitsuState): Uint8Array {
  const model = state.model ?? FujitsuModel.ARRAH2E;
  const stateLength = isShortModel(model) ? 15 : 16;
  const stateLengthShort = isShortModel(model) ? 6 : 7;

  const w: Working = {
    model,
    id: clamp(state.id ?? 0, 0, 3),
    cmd: FujitsuCmd.StayOn,
    mode: Math.min(state.mode ?? FujitsuMode.Cool, MODE_MAX),
    temp: 0, fahrenheit: 0,
    fan: (state.fan ?? FujitsuFan.High) > FAN_MAX ? FujitsuFan.High : (state.fan ?? FujitsuFan.High),
    swing: 0, clean: 0, filter: 0, outsideQuiet: 0,
    timerType: FujitsuTimer.Stop, onTimer: 0, offTimer: 0,
  };

  applyTemp(w, state.temp ?? 24, state.celsius ?? true);
  const swing = ((state.swingV ?? true) ? FujitsuSwing.Vert : 0) |
    ((state.swingH ?? true) ? FujitsuSwing.Horiz : 0);
  applySwing(w, swing);
  w.clean = state.clean ? 1 : 0;
  w.filter = state.filter ? 1 : 0;
  w.outsideQuiet = state.outsideQuiet ? 1 : 0;

  // Timers (mirror setOnTimer / setOffTimer / setSleepTimer).
  const tt = state.timerType ?? FujitsuTimer.Stop;
  const tv = clamp(state.timerMinutes ?? 0, 0, TIMER_MAX);
  if (tt === FujitsuTimer.On) { w.onTimer = tv; w.timerType = FujitsuTimer.On; }
  else if (tt === FujitsuTimer.Off) { w.offTimer = tv; w.timerType = FujitsuTimer.Off; }
  else if (tt === FujitsuTimer.Sleep) { w.offTimer = tv; w.timerType = FujitsuTimer.Sleep; }

  // 10°C heat overrides mode/fan/swing/clean (set10CHeat).
  if (state.tenCHeat && (model === FujitsuModel.ARRAH2E || model === FujitsuModel.ARREW4E)) {
    w.clean = 1;
    w.mode = FujitsuMode.Fan;
    w.fan = FujitsuFan.Auto;
    w.swing = FujitsuSwing.Off;
  }

  // Final command / power (setCmd vs setPower).
  const cmd = state.command;
  if (cmd !== undefined && cmd !== FujitsuCmd.StayOn) {
    w.cmd = setCmdForModel(model, cmd);
  } else {
    w.cmd = state.power === false ? FujitsuCmd.TurnOff : FujitsuCmd.TurnOn;
  }

  return finalizeFujitsu(w, stateLength, stateLengthShort);
}

/** Replicates `IRFujitsuAC::setCmd` model gating for special commands. */
function setCmdForModel(model: number, cmd: number): number {
  switch (cmd) {
    case FujitsuCmd.TurnOff:
    case FujitsuCmd.TurnOn:
    case FujitsuCmd.StayOn:
    case FujitsuCmd.StepVert:
    case FujitsuCmd.ToggleSwingVert:
      return cmd;
    case FujitsuCmd.StepHoriz:
    case FujitsuCmd.ToggleSwingHoriz:
      return (model === FujitsuModel.ARRAH2E || model === FujitsuModel.ARJW2)
        ? cmd : FujitsuCmd.StayOn;
    case FujitsuCmd.Econo:
    case FujitsuCmd.Powerful:
      return (model === FujitsuModel.ARREB1E || model === FujitsuModel.ARREW4E)
        ? cmd : FujitsuCmd.StayOn;
    default:
      return FujitsuCmd.StayOn;
  }
}

/** Assemble bytes + checksum (mirrors `IRFujitsuAC::checkSum` / `getRaw`). */
function finalizeFujitsu(w: Working, stateLength: number, stateLengthShort: number): Uint8Array {
  const isShort = SHORT_CMDS.has(w.cmd);
  const b = new Uint8Array(16);
  b[0] = SIG0; b[1] = SIG1; b[3] = 0x10; b[4] = 0x10;
  b[2] = (w.id & 0x3) << 4;

  if (!isShort) {
    // Long code.
    b[5] = (w.model === FujitsuModel.ARRY4 || w.model === FujitsuModel.ARRAH2E ||
      w.model === FujitsuModel.ARREB1E || w.model === FujitsuModel.ARREW4E)
      ? LONG_CMD_16 : LONG_CMD_15;
    b[6] = stateLength - 7;
    b[7] = w.model === FujitsuModel.ARREW4E ? 0x31 : 0x30;

    const power = (w.cmd === FujitsuCmd.TurnOn) || is10CHeat(w) ? 1 : 0;

    // Model-specific field gating.
    let outsideQuiet = w.outsideQuiet;
    let timerType = w.timerType;
    let clean = w.clean;
    let filter = w.filter;
    let swing = w.swing;
    let unknown = 0;
    if (w.model !== FujitsuModel.ARREB1E && w.model !== FujitsuModel.ARREW4E) {
      outsideQuiet = 0;
      if (w.model !== FujitsuModel.ARRAH2E) timerType = FujitsuTimer.Stop;
    }
    if (w.model !== FujitsuModel.ARRY4) {
      if (w.model !== FujitsuModel.ARRAH2E && w.model !== FujitsuModel.ARREW4E) clean = 0;
      filter = 0;
    }

    // Timer values are gated by the (possibly forced) timer type.
    const effTimerType = (w.model === FujitsuModel.ARRAH2E || w.model === FujitsuModel.ARREB1E)
      ? timerType : FujitsuTimer.Stop;
    const offTimer = (effTimerType === FujitsuTimer.Off || effTimerType === FujitsuTimer.Sleep) ? w.offTimer : 0;
    const onTimer = effTimerType === FujitsuTimer.On ? w.onTimer : 0;
    const offEnable = offTimer > 0 ? 1 : 0;
    const onEnable = onTimer > 0 ? 1 : 0;

    if (w.model === FujitsuModel.ARDB1 || w.model === FujitsuModel.ARJW2) {
      swing = FujitsuSwing.Off;
    } else if (w.model === FujitsuModel.ARREB1E || w.model === FujitsuModel.ARRAH2E ||
      w.model === FujitsuModel.ARRY4) {
      unknown = 1;
    }

    b[8] = (power & 1) | ((w.fahrenheit & 1) << 1) | ((w.temp & 0x3f) << 2);
    b[9] = (w.mode & 0x7) | ((clean & 1) << 3) | ((timerType & 0x3) << 4);
    b[10] = (w.fan & 0x7) | ((swing & 0x3) << 4);
    b[11] = offTimer & 0xff;
    b[12] = ((offTimer >> 8) & 0x07) | ((offEnable & 1) << 3) | ((onTimer & 0x0f) << 4);
    b[13] = ((onTimer >> 4) & 0x7f) | ((onEnable & 1) << 7);
    b[14] = ((filter & 1) << 3) | ((unknown & 1) << 5) | ((outsideQuiet & 1) << 7);

    // Checksum.
    if (w.model === FujitsuModel.ARDB1 || w.model === FujitsuModel.ARJW2) {
      // 15-byte: byte14 is the checksum slot (overwrites filter/quiet, all 0 here).
      const sum = sumBytes(b, 0, stateLength - 1);
      b[stateLength - 1] = (0x9b - sum) & 0xff;
    } else {
      const sum = sumBytes(b, stateLengthShort, stateLength - 1);
      b[stateLength - 1] = (-sum) & 0xff;
    }
    return b.slice(0, stateLength);
  }

  // Short code.
  b[5] = w.cmd;
  if (stateLengthShort === 7) b[6] = (~w.cmd) & 0xff;
  return b.slice(0, stateLengthShort);
}

// ---------------------------------------------------------------------------
// Parse bytes → semantic state (mirrors setRaw + buildFromState + getters)
// ---------------------------------------------------------------------------

/** Decode the raw frame's model the way `IRFujitsuAC::buildFromState` does. */
function detectModel(b: Uint8Array): number {
  const length = b.length;
  let model: number;
  const swing = (b[10]! >> 4) & 0x3;
  if (length === 15 || length === 6) {
    model = FujitsuModel.ARDB1;
    if (swing > FujitsuSwing.Vert) model = FujitsuModel.ARJW2;
  } else {
    model = (b[5] === FujitsuCmd.Econo || b[5] === FujitsuCmd.Powerful)
      ? FujitsuModel.ARREB1E : FujitsuModel.ARRAH2E;
  }
  const restLength = b[6]!;
  if (restLength === 8) {
    if (model !== FujitsuModel.ARJW2) model = FujitsuModel.ARDB1;
  } else if (restLength === 9) {
    if (model !== FujitsuModel.ARREB1E) model = FujitsuModel.ARRAH2E;
  }
  const power = b[8]! & 1;
  const clean = (b[9]! >> 3) & 1;
  const filter = (b[14]! >> 3) & 1;
  const outsideQuiet = (b[14]! >> 7) & 1;
  const tenC = model === FujitsuModel.ARRAH2E &&
    power === 1 && ((b[9]! & 0x7) === FujitsuMode.Fan) &&
    ((b[10]! & 0x7) === FujitsuFan.Auto) && (((b[10]! >> 4) & 0x3) === FujitsuSwing.Off) &&
    clean === 1;
  if (model === FujitsuModel.ARRAH2E && (filter || clean) && !tenC)
    model = FujitsuModel.ARRY4;
  if (length === 16 && outsideQuiet) model = FujitsuModel.ARREB1E;
  if (b[7] === 0x31) model = FujitsuModel.ARREW4E;
  return model;
}

/** Parse a validated Fujitsu frame into a {@link FujitsuState}, or null. */
export function parseFujitsuState(data: Uint8Array): FujitsuState | null {
  if (!validFujitsuFrame(data)) return null;
  const model = detectModel(data) as FujitsuModelValue;
  const cmd = data[5]!;
  const isShort = data.length === 6 || data.length === 7;

  // Power / command.
  let command: FujitsuCmdValue | undefined;
  let power: boolean;
  if (isShort) {
    power = cmd !== FujitsuCmd.TurnOff;
    if (SHORT_CMDS.has(cmd)) command = cmd as FujitsuCmdValue;
  } else {
    power = (data[8]! & 1) === 1; // long frame Power bit → on
  }

  const state: FujitsuState = { model, power };
  const id = (data[2]! >> 4) & 0x3;
  if (id) state.id = id;
  if (command !== undefined) state.command = command;

  if (isShort) return state; // short frames carry no settings

  // Long frame fields.
  const fahrenheit = (data[8]! >> 1) & 1;
  const tempRaw = (data[8]! >> 2) & 0x3f;
  const celsius = !fahrenheit;
  state.celsius = celsius;
  if (model === FujitsuModel.ARREW4E) {
    state.temp = fahrenheit ? tempRaw + 44 : tempRaw / 2 + 8;
  } else {
    state.temp = tempRaw / 4 + 16;
  }
  state.mode = (data[9]! & 0x7) as FujitsuModeValue;
  state.fan = (data[10]! & 0x7) as FujitsuFanValue;
  const swing = (data[10]! >> 4) & 0x3;
  state.swingV = (swing & FujitsuSwing.Vert) !== 0;
  state.swingH = (swing & FujitsuSwing.Horiz) !== 0;

  // Clean / filter only meaningful on ARRY4 (per getClean/getFilter).
  if (model === FujitsuModel.ARRY4) {
    state.clean = ((data[9]! >> 3) & 1) === 1;
    state.filter = ((data[14]! >> 3) & 1) === 1;
  }
  if (model === FujitsuModel.ARREB1E || model === FujitsuModel.ARREW4E) {
    state.outsideQuiet = ((data[14]! >> 7) & 1) === 1;
  }
  if (model === FujitsuModel.ARRAH2E || model === FujitsuModel.ARREW4E) {
    const tenC = ((data[9]! >> 3) & 1) === 1 && (data[8]! & 1) === 1 &&
      (data[9]! & 0x7) === FujitsuMode.Fan && (data[10]! & 0x7) === FujitsuFan.Auto &&
      ((data[10]! >> 4) & 0x3) === FujitsuSwing.Off;
    if (tenC) state.tenCHeat = true;
  }

  // Timers (only ARRAH2E / ARREB1E expose them).
  if (model === FujitsuModel.ARRAH2E || model === FujitsuModel.ARREB1E) {
    const timerType = ((data[9]! >> 4) & 0x3) as FujitsuTimerValue;
    const offTimer = data[11]! | ((data[12]! & 0x07) << 8);
    const onTimer = ((data[12]! >> 4) & 0x0f) | ((data[13]! & 0x7f) << 4);
    if (timerType === FujitsuTimer.On && onTimer) {
      state.timerType = FujitsuTimer.On; state.timerMinutes = onTimer;
    } else if ((timerType === FujitsuTimer.Off || timerType === FujitsuTimer.Sleep) && offTimer) {
      state.timerType = timerType; state.timerMinutes = offTimer;
    }
  }

  return state;
}

// ---------------------------------------------------------------------------
// Semantic send / decode (convention: sendFoo(state) / decodeFoo→state)
// ---------------------------------------------------------------------------

/** Encode a Fujitsu A/C state into raw IR timings. */
export function sendFujitsu(state: FujitsuState, repeat: number = 0): number[] {
  return encodeFujitsuRaw(buildFujitsuRaw(state), repeat);
}

/**
 * Decode raw IR timings as a Fujitsu A/C state.
 *
 * @returns The decoded {@link FujitsuState}, or null on mismatch.
 */
export function decodeFujitsu(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): FujitsuState | null {
  const raw = decodeFujitsuRaw(timings, offset, headerOptional);
  return raw ? parseFujitsuState(raw) : null;
}
