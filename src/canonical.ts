/**
 * Canonical capability model — a brand-agnostic overlay on top of the protocol
 * registry.
 *
 * Where {@link ./capabilities.js | capabilities.ts} exposes each protocol's *own*
 * mode/fan names and wire values verbatim, this module adds the missing layers:
 *
 *  1. **Concept** — a fixed, brand-agnostic vocabulary ({@link CanonicalMode},
 *     {@link CanonicalFan}, {@link CanonicalFeature}, {@link CanonicalSwingPosition}).
 *  2. **Mapping** — {@link CAPABILITIES}, a per-protocol bidirectional translation
 *     between canonical tokens and that protocol's raw {@link ProtocolStateMap}
 *     fields/values. Feature keys are typed `keyof ProtocolStateMap[P]`, so a
 *     renamed or removed state field fails the type-check (the real drift guard).
 *  3. **Human-readable** — {@link LABELS}, a shared token → display-string table.
 *
 * Plus {@link toCanonical} / {@link fromCanonical}: normalize a decoded protocol
 * state into canonical form, edit it in protocol-agnostic terms, then feed it
 * straight back through {@link ./codec.js | encode}.
 *
 * The set of fields exposed here is intentionally exhaustive — every boolean
 * toggle, numeric/timer field, enum, and power/swing semantic the encoders
 * accept. Raw/opaque protocols (coolix48, hitachi_ac3, tcl96, nec, mitsubishi,
 * mitsubishi2) carry no structured state and are deliberately absent.
 */

import type { ProtocolName } from "./decode.js";
import type { ProtocolStateMap } from "./codec.js";

import { CoolixMode, CoolixFan } from "./protocols/coolix.js";
import { GreeMode, GreeFan, GreeSwingV, GreeSwingH, GreeDisplayTemp } from "./protocols/gree.js";
import { KelvinatorMode, KelvinatorFan, KelvinatorSwingV } from "./protocols/kelvinator.js";
import { MideaMode, MideaFan } from "./protocols/midea.js";
import { ElectraAcMode, ElectraAcFan } from "./protocols/electra_ac.js";
import { VestelAcMode, VestelAcFan } from "./protocols/vestel_ac.js";
import { TrotecMode, TrotecFan } from "./protocols/trotec.js";
import { NeoclimaMode, NeoclimaFan } from "./protocols/neoclima.js";
import { AirtonMode, AirtonFan } from "./protocols/airton.js";
import { DelonghiAcMode, DelonghiAcFan } from "./protocols/delonghi_ac.js";
import { TrumaMode, TrumaFan } from "./protocols/truma.js";
import { AmcorMode, AmcorFan } from "./protocols/amcor.js";
import { RhossMode, RhossFan } from "./protocols/rhoss.js";
import { TechnibelAcMode, TechnibelAcFan } from "./protocols/technibel_ac.js";
import { EcoclimMode, EcoclimFan } from "./protocols/ecoclim.js";
import { CoronaAcMode, CoronaAcFan } from "./protocols/corona_ac.js";
import { AirwellMode, AirwellFan } from "./protocols/airwell.js";
import { ArgoMode, ArgoFan, ArgoFlap } from "./protocols/argo.js";
import { ArgoWrem3Mode, ArgoWrem3Fan, ArgoWrem3Flap } from "./protocols/argo_wrem3.js";
import { DaikinMode, DaikinFan } from "./protocols/daikin_common.js";
import { Daikin64Mode, Daikin64Fan } from "./protocols/daikin64.js";
import { Daikin128Mode, Daikin128Fan } from "./protocols/daikin128.js";
import { Daikin160SwingV } from "./protocols/daikin160.js";
import { Daikin176Mode, Daikin176SwingH } from "./protocols/daikin176.js";
import { GodrejMode, GodrejFan } from "./protocols/godrej.js";
import { KelonMode, KelonFan } from "./protocols/kelon.js";
import { Kelon168Mode, Kelon168Fan, Kelon168Command } from "./protocols/kelon168.js";
import { MitsubishiAcMode, MitsubishiAcFan, MitsubishiAcVane, MitsubishiAcWideVane } from "./protocols/mitsubishi_ac.js";
import { Mitsubishi112Mode, Mitsubishi112Fan, Mitsubishi112SwingV, Mitsubishi112SwingH } from "./protocols/mitsubishi112.js";
import { Mitsubishi136Mode, Mitsubishi136Fan, Mitsubishi136SwingV } from "./protocols/mitsubishi136.js";
import { TecoMode, TecoFan } from "./protocols/teco.js";
import { VoltasMode, VoltasFan, VoltasModel } from "./protocols/voltas.js";
import { Tcl112Mode, Tcl112Fan, Tcl112SwingV, Tcl112Model } from "./protocols/tcl112.js";
import { TeknopointMode, TeknopointFan, TeknopointSwingV, TeknopointModel } from "./protocols/teknopoint.js";
import { PanasonicAc32Mode, PanasonicAc32Fan, PanasonicAc32SwingV } from "./protocols/panasonic_ac32.js";
import { PanasonicAcMode, PanasonicAcFan, PanasonicAcSwingV, PanasonicAcSwingH, PanasonicAcModel } from "./protocols/panasonic_ac.js";
import { SamsungAcMode, SamsungAcFan } from "./protocols/samsung_ac.js";
import { LgAcMode, LgAcFan, LgAcModel } from "./protocols/lg_ac.js";
import { CarrierAc64Mode, CarrierAc64Fan } from "./protocols/carrier_ac64.js";
import { HaierAcYrw02Mode, HaierAcYrw02Fan, HaierAc176SwingV, HaierAc176SwingH } from "./protocols/haier_ac176.js";
import { HaierAc160SwingV } from "./protocols/haier_ac160.js";
import { HaierAcMode, HaierAcFan, HaierAcSwingV } from "./protocols/haier_ac.js";
import { ToshibaAcMode, ToshibaAcFan, ToshibaAcModel } from "./protocols/toshiba_ac.js";
import { SharpAcMode, SharpAcFan, SharpAcSwingV, SharpAcModel } from "./protocols/sharp_ac.js";
import { SanyoAcMode, SanyoAcFan, SanyoAcSwingV } from "./protocols/sanyo_ac.js";
import { WhirlpoolAcMode, WhirlpoolAcFan, WhirlpoolAcModel } from "./protocols/whirlpool_ac.js";
import { WhirlpoolMagicoolMode, WhirlpoolMagicoolFan, WhirlpoolMagicoolSwing } from "./protocols/whirlpool_magicool.js";
import { WhirlpoolMagicool2Mode, WhirlpoolMagicool2Fan, WhirlpoolMagicool2Swing } from "./protocols/whirlpool_magicool2.js";
import { MitsubishiHeavy152Mode, MitsubishiHeavy152Fan, MitsubishiHeavy152SwingV, MitsubishiHeavy152SwingH } from "./protocols/mitsubishi_heavy152.js";
import { MitsubishiHeavy88Mode, MitsubishiHeavy88Fan, MitsubishiHeavy88SwingV, MitsubishiHeavy88SwingH } from "./protocols/mitsubishi_heavy88.js";
import { SanyoAc88Mode, SanyoAc88Fan } from "./protocols/sanyo_ac88.js";
import { HitachiAcMode, HitachiAcFan } from "./protocols/hitachi.js";
import { HitachiAc1Mode, HitachiAc1Fan, HitachiAc1Model } from "./protocols/hitachi1.js";
import { HitachiAc264Fan } from "./protocols/hitachi264.js";
import { HitachiAc296Mode, HitachiAc296Fan } from "./protocols/hitachi296.js";
import { HitachiAc344SwingH } from "./protocols/hitachi344.js";
import { HitachiAc424Mode, HitachiAc424Fan } from "./protocols/hitachi424.js";
import { LloydMode, LloydFan } from "./protocols/lloyd.js";
import { FujitsuModel, FujitsuMode, FujitsuFan } from "./protocols/fujitsu.js";
import { BluestarMode, BluestarFan } from "./protocols/bluestar.js";

// ===========================================================================
// Layer 1 — canonical vocabulary
// ===========================================================================

/** Brand-agnostic operating mode. */
export type CanonicalMode =
  | "auto" | "cool" | "heat" | "dry" | "fan"
  | "econo" | "smart" | "feel_cool" | "feel_heat"
  // Hitachi296 specialised programs:
  | "dry_cool" | "dehumidify" | "auto_dehumidify" | "quick_laundry" | "condensation_control";

/** Brand-agnostic fan speed. `turbo`/`powerful` exist where a protocol encodes
 *  boost as a fan *speed* rather than a separate flag (Daikin64/128). */
export type CanonicalFan =
  | "auto" | "min" | "low" | "medium" | "high" | "max" | "quiet" | "turbo" | "powerful" | "econo";

/** Brand-agnostic swing position (vertical or horizontal). */
export type CanonicalSwingPosition =
  | "off" | "on" | "auto" | "swing" | "last"
  | "up" | "down" | "highest" | "high" | "middle_up" | "middle" | "middle_down" | "low" | "lowest"
  | "up_auto" | "down_auto" | "middle_auto"
  | "left_max" | "left" | "right" | "right_max" | "wide" | "right_left" | "left_right" | "3d";

/** Brand-agnostic feature token (booleans, numeric/timer fields, enums). */
export type CanonicalFeature =
  // boost / efficiency
  | "turbo" | "quiet" | "econo" | "sleep" | "comfort"
  // lighting / display
  | "light" | "light_ceiling" | "light_wall" | "display_temp"
  // air handling
  | "xfan" | "clean" | "purify" | "filter" | "fresh_air" | "fresh_air_high" | "health" | "humid"
  | "night" | "3d"
  // sensing / presence
  | "ifeel" | "isee" | "absence_detect" | "eye" | "eye_auto" | "natural_flow"
  // connectivity / model
  | "wifi" | "model" | "model_a" | "smart_mode"
  // timers & clock (minutes unless noted)
  | "timer" | "timer_on" | "timer_off" | "clock" | "weekday"
  | "start_clock" | "stop_clock" | "timer_mode" | "weekly_timer"
  // temperatures / levels
  | "sensor_temp" | "isense_temp" | "isave_10c" | "dry_grade" | "convert" | "beep"
  | "vane_left" | "direct_indirect" | "unit_id"
  // misc / metadata
  | "fahrenheit" | "temp_extra_degree_f" | "zone_follow" | "swing_v_auto"
  | "command" | "power_toggle" | "power_flag" | "swing_toggle";

// ===========================================================================
// Layer 3 — human-readable labels (shared, keyed by canonical token)
// ===========================================================================

/** Display label for any canonical token (mode, fan, position, feature, or an
 *  enum-feature's value token). Missing entries fall back to the token itself
 *  via {@link labelFor}. */
export const LABELS: Readonly<Record<string, string>> = {
  // modes
  auto: "Auto", cool: "Cool", heat: "Heat", dry: "Dry", fan: "Fan",
  econo: "Economy", smart: "Smart", feel_cool: "Feel Cool", feel_heat: "Feel Heat",
  dry_cool: "Dry Cool", dehumidify: "Dehumidify", auto_dehumidify: "Auto Dehumidify",
  quick_laundry: "Quick Laundry", condensation_control: "Condensation Control",
  // fan speeds
  min: "Minimum", low: "Low", medium: "Medium", high: "High", max: "Maximum",
  quiet: "Quiet", turbo: "Turbo", powerful: "Powerful",
  // swing positions
  off: "Off", on: "On", swing: "Swing", last: "Last Position",
  up: "Up", down: "Down", highest: "Highest", middle_up: "Middle Up", middle: "Middle",
  middle_down: "Middle Down", lowest: "Lowest",
  up_auto: "Up Auto", down_auto: "Down Auto", middle_auto: "Middle Auto",
  left_max: "Left Max", left: "Left", right: "Right", right_max: "Right Max", wide: "Wide",
  right_left: "Right-Left", left_right: "Left-Right", "3d": "3D Airflow",
  // features
  sleep: "Sleep", comfort: "Comfort", night: "Night", filter: "Filter",
  light: "Light", light_ceiling: "Ceiling Light", light_wall: "Wall Light",
  display_temp: "Display Temperature",
  xfan: "X-Fan / Mold Prevention", clean: "Clean", purify: "Purify",
  fresh_air: "Fresh Air", fresh_air_high: "Fresh Air (High)", health: "Health", humid: "Humid",
  ifeel: "iFeel (follow-me)", isee: "iSee (presence)", absence_detect: "Absence Detect",
  eye: "Eye Sensor", eye_auto: "Eye Sensor (Auto)", natural_flow: "Natural Flow",
  wifi: "WiFi", model: "Model", model_a: "Model A", smart_mode: "Smart Mode",
  timer: "Timer", timer_on: "On Timer", timer_off: "Off Timer", clock: "Clock",
  weekday: "Weekday", start_clock: "Start Clock", stop_clock: "Stop Clock",
  timer_mode: "Timer Mode", weekly_timer: "Weekly Timer",
  sensor_temp: "Sensor Temperature", isense_temp: "iSense Temperature",
  isave_10c: "iSave 10°C", dry_grade: "Dry Grade", convert: "Convert", beep: "Beep",
  vane_left: "Left Vane", direct_indirect: "Direct/Indirect", unit_id: "Unit ID",
  fahrenheit: "Fahrenheit", temp_extra_degree_f: "Extra °F", zone_follow: "Zone Follow",
  swing_v_auto: "Vertical Swing Auto", command: "Command",
  power_toggle: "Power Toggle", power_flag: "Power Flag", swing_toggle: "Swing Toggle",
  // enum-feature value tokens
  set: "Set", inside: "Inside", outside: "Outside",
  full: "Full Function", lzf: "122LZF", a: "Model A", b: "Model B",
  tac09chsd: "TAC09CHSD", gz055be1: "GZ055BE1",
  arrah2e: "AR-RAH2E", ardb1: "AR-DB1", arreb1e: "AR-REB1E",
  arjw2: "AR-JW2", arry4: "AR-RY4", arrew4e: "AR-REW4E",
  temp: "Temperature", super: "Super", on_timer: "On Timer", off_timer: "Off Timer",
  mode: "Mode", fan_speed: "Fan Speed", power: "Power",
};

/** Human-readable label for a canonical token (falls back to the token). */
export function labelFor(token: string): string {
  return LABELS[token] ?? token;
}

// ===========================================================================
// Layer 2 — canonical state shape + per-protocol mapping spec
// ===========================================================================

/** A fan speed: a named canonical speed, or a raw numeric speed (Daikin 1–5). */
export type CanonicalFanValue = CanonicalFan | { numeric: number };

/** A swing setting in canonical terms. */
export type SwingValue =
  | { kind: "bool"; on: boolean }
  | { kind: "toggle"; toggle: boolean }
  | { kind: "position"; position: CanonicalSwingPosition }
  | { kind: "numeric"; value: number };

/** A feature value: a flag, a level, a duration (minutes), or an enum token. */
export type FeatureValue = boolean | { level: number } | { minutes: number } | { token: string };

/** A protocol state normalized to the canonical vocabulary. */
export interface CanonicalState {
  /** On/off intent. `stateful` protocols carry absolute power; `toggle`
   *  protocols (Kelon) only carry a "power button pressed" bit. */
  power?: { kind: "stateful"; on: boolean } | { kind: "toggle"; toggle: boolean };
  mode?: CanonicalMode;
  /** Temperature in °C. Resolution (whole vs half degree) is on the spec's `temp.step`. */
  temp?: number;
  fan?: CanonicalFanValue;
  swingV?: SwingValue;
  swingH?: SwingValue;
  /** Extra capabilities, keyed by canonical token. */
  features?: Partial<Record<CanonicalFeature, FeatureValue>>;
}

// --- spec types -----------------------------------------------------------

interface ModeSpec {
  constants: Readonly<Record<string, number>>;
  map: Readonly<Record<string, CanonicalMode>>;
}

interface FanSpec {
  /** Named-speed constants + name → canonical token map (bijective on the
   *  mapped subset). Unmapped wire values fall back to `{ numeric }`. */
  constants?: Readonly<Record<string, number>>;
  map?: Readonly<Record<string, CanonicalFan>>;
  /** Advisory: the inclusive raw numeric speed range a protocol accepts. */
  numericRange?: { min: number; max: number };
}

interface PositionSpec {
  constants: Readonly<Record<string, number>>;
  map: Readonly<Record<string, CanonicalSwingPosition>>;
}

type SwingSpec<P extends ProtocolName> =
  | { key: keyof ProtocolStateMap[P]; kind: "bool" }
  | { key: keyof ProtocolStateMap[P]; kind: "toggle" }
  | { key: keyof ProtocolStateMap[P]; kind: "position"; positions: PositionSpec }
  | { key: keyof ProtocolStateMap[P]; kind: "numeric"; min: number; max: number };

interface TempSpec {
  min: number;
  max: number;
  step: number;
  /** Modes in which the encoder forces/ignores the temperature (advisory). */
  lockedModes?: readonly CanonicalMode[];
}

type PowerSpec<P extends ProtocolName> =
  | { kind: "stateful" }
  | { kind: "toggle"; key: keyof ProtocolStateMap[P] };

/** One feature of protocol P, bound to a real `keyof ProtocolStateMap[P]`. The
 *  `key` typing is the compile-time drift guard: a typo or removed field fails. */
type FeatureSpec<P extends ProtocolName> =
  | {
      kind: "boolean";
      canonical: CanonicalFeature;
      key: keyof ProtocolStateMap[P];
      /** Advisory: modes in which this flag is effective. */
      validModes?: readonly CanonicalMode[];
    }
  | {
      kind: "range";
      canonical: CanonicalFeature;
      key: keyof ProtocolStateMap[P];
      min: number;
      max: number;
      step?: number;
      /** `"minutes"` → reported as `{ minutes }`; otherwise `{ level }`. */
      unit?: "minutes";
      /** A separate boolean "enabled" field gating this value (timers). */
      enabledKey?: keyof ProtocolStateMap[P];
      validModes?: readonly CanonicalMode[];
    }
  | {
      kind: "enum";
      canonical: CanonicalFeature;
      key: keyof ProtocolStateMap[P];
      constants: Readonly<Record<string, number>>;
      map: Readonly<Record<string, string>>;
    };

/** Full canonical capability description for one protocol. */
export interface CapabilitySpec<P extends ProtocolName> {
  power: PowerSpec<P>;
  modes?: ModeSpec;
  fan?: FanSpec;
  temp?: TempSpec;
  swingV?: SwingSpec<P>;
  swingH?: SwingSpec<P>;
  features: ReadonlyArray<FeatureSpec<P>>;
}

type CapabilitiesMap = { [P in ProtocolName]?: CapabilitySpec<P> };

// --- reusable mode/fan/position maps --------------------------------------

const DAIKIN_MODE: ModeSpec = {
  constants: DaikinMode,
  map: { Auto: "auto", Dry: "dry", Cool: "cool", Heat: "heat", Fan: "fan" },
};
/** Daikin: named Auto/Quiet plus a raw 1–5 numeric speed scale. */
const DAIKIN_FAN: FanSpec = {
  constants: DaikinFan,
  map: { Auto: "auto", Quiet: "quiet" },
  numericRange: { min: 1, max: 5 },
};
const DAIKIN_TEMP: TempSpec = { min: 10, max: 32, step: 1 };
const HITACHI_TEMP: TempSpec = { min: 16, max: 32, step: 1 };

const HITACHI424_MODE: ModeSpec = {
  constants: HitachiAc424Mode,
  map: { Fan: "fan", Cool: "cool", Dry: "dry", Heat: "heat" },
};
const HITACHI424_FAN: FanSpec = {
  constants: HitachiAc424Fan,
  map: { Min: "min", Low: "low", Medium: "medium", High: "high", Auto: "auto", Max: "max" },
};

// ===========================================================================
// The registry — one entry per structured protocol
// ===========================================================================

export const CAPABILITIES: CapabilitiesMap = {
  coolix: {
    power: { kind: "stateful" },
    modes: { constants: CoolixMode, map: { Cool: "cool", Dry: "dry", Auto: "auto", Heat: "heat", Fan: "fan" } },
    fan: { constants: CoolixFan, map: { Max: "max", Med: "medium", Min: "min", Auto: "auto" } },
    temp: { min: 17, max: 30, step: 1 },
    features: [
      { kind: "range", canonical: "sensor_temp", key: "sensorTemp", min: 0, max: 30 },
      { kind: "boolean", canonical: "zone_follow", key: "zoneFollow" },
    ],
  },

  gree: {
    power: { kind: "stateful" },
    modes: { constants: GreeMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat", Econo: "econo" } },
    fan: { constants: GreeFan, map: { Auto: "auto", Min: "min", Med: "medium", Max: "max" } },
    temp: { min: 16, max: 30, step: 1, lockedModes: ["auto"] },
    swingV: { key: "swingV", kind: "position", positions: { constants: GreeSwingV, map: {
      LastPos: "last", Auto: "auto", Up: "up", MiddleUp: "middle_up", Middle: "middle",
      MiddleDown: "middle_down", Down: "down", DownAuto: "down_auto", MiddleAuto: "middle_auto", UpAuto: "up_auto",
    } } },
    swingH: { key: "swingH", kind: "position", positions: { constants: GreeSwingH, map: {
      Off: "off", Auto: "auto", MaxLeft: "left_max", Left: "left", Middle: "middle", Right: "right", MaxRight: "right_max",
    } } },
    features: [
      { kind: "boolean", canonical: "swing_v_auto", key: "swingAuto" },
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "light", key: "light" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "xfan", key: "xfan" },
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "ifeel", key: "iFeel" },
      { kind: "boolean", canonical: "wifi", key: "wifi" },
      { kind: "boolean", canonical: "model_a", key: "modelA" },
      { kind: "boolean", canonical: "fahrenheit", key: "fahrenheit" },
      { kind: "boolean", canonical: "temp_extra_degree_f", key: "tempExtraDegreeF" },
      { kind: "range", canonical: "timer", key: "timerMinutes", min: 0, max: 1440, step: 30, unit: "minutes" },
      { kind: "enum", canonical: "display_temp", key: "displayTemp", constants: GreeDisplayTemp,
        map: { Off: "off", Set: "set", Inside: "inside", Outside: "outside" } },
    ],
  },

  kelvinator: {
    power: { kind: "stateful" },
    modes: { constants: KelvinatorMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" } },
    fan: { constants: KelvinatorFan, map: { Auto: "auto", Min: "min", Low: "low", Medium: "medium", High: "high", Max: "max" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: KelvinatorSwingV, map: {
      Off: "off", Auto: "auto", Highest: "highest", UpperMiddle: "middle_up", Middle: "middle",
      LowerMiddle: "middle_down", Lowest: "lowest", LowAuto: "down_auto", MiddleAuto: "middle_auto", HighAuto: "up_auto",
    } } },
    swingH: { key: "swingH", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "quiet", key: "quiet" },
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "light", key: "light" },
      { kind: "boolean", canonical: "purify", key: "ionFilter" },
      { kind: "boolean", canonical: "xfan", key: "xfan" },
    ],
  },

  midea: {
    power: { kind: "stateful" },
    modes: { constants: MideaMode, map: { Cool: "cool", Dry: "dry", Auto: "auto", Heat: "heat", Fan: "fan" } },
    fan: { constants: MideaFan, map: { Auto: "auto", Low: "low", Med: "medium", High: "high" } },
    temp: { min: 17, max: 30, step: 1 },
    features: [
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "range", canonical: "sensor_temp", key: "sensorTemp", min: 0, max: 37, step: 1 },
      { kind: "range", canonical: "timer_on", key: "onTimer", min: 0, max: 1440, step: 30, unit: "minutes" },
      { kind: "range", canonical: "timer_off", key: "offTimer", min: 0, max: 1440, step: 30, unit: "minutes" },
      { kind: "boolean", canonical: "swing_toggle", key: "swingVToggle" },
      { kind: "boolean", canonical: "econo", key: "econoToggle" },
      { kind: "boolean", canonical: "turbo", key: "turboToggle" },
      { kind: "boolean", canonical: "light", key: "lightToggle" },
      { kind: "boolean", canonical: "clean", key: "cleanToggle" },
      { kind: "boolean", canonical: "quiet", key: "quiet" },
    ],
  },

  electra_ac: {
    power: { kind: "stateful" },
    modes: { constants: ElectraAcMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Heat: "heat", Fan: "fan" } },
    fan: { constants: ElectraAcFan, map: { Auto: "auto", Low: "low", Med: "medium", High: "high" } },
    temp: { min: 16, max: 32, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    swingH: { key: "swingH", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "quiet", key: "quiet" },
      { kind: "boolean", canonical: "clean", key: "clean" },
      { kind: "boolean", canonical: "light", key: "lightToggle" },
      { kind: "boolean", canonical: "ifeel", key: "iFeel" },
      { kind: "range", canonical: "sensor_temp", key: "sensorTemp", min: 0, max: 50, step: 1 },
    ],
  },

  vestel_ac: {
    power: { kind: "stateful" },
    modes: { constants: VestelAcMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" } },
    fan: { constants: VestelAcFan, map: { Auto: "auto", Low: "low", Med: "medium", High: "high" } },
    temp: { min: 18, max: 30, step: 1 },
    swingV: { key: "swing", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "purify", key: "ion" },
    ],
  },

  trotec: {
    power: { kind: "stateful" },
    modes: { constants: TrotecMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan" } },
    fan: { constants: TrotecFan, map: { Low: "low", Med: "medium", High: "high" } },
    temp: { min: 18, max: 32, step: 1 },
    features: [
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "range", canonical: "timer", key: "timer", min: 0, max: 23, step: 1 },
    ],
  },

  trotec_3550: {
    power: { kind: "stateful" },
    modes: { constants: TrotecMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan" } },
    fan: { constants: TrotecFan, map: { Low: "low", Med: "medium", High: "high" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    features: [
      { kind: "range", canonical: "timer", key: "timer", min: 0, max: 480, step: 60, unit: "minutes" },
    ],
  },

  neoclima: {
    power: { kind: "stateful" },
    modes: { constants: NeoclimaMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" } },
    fan: { constants: NeoclimaFan, map: { Auto: "auto", High: "high", Med: "medium", Low: "low" } },
    temp: { min: 16, max: 32, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    swingH: { key: "swingH", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "light", key: "light" },
      { kind: "boolean", canonical: "purify", key: "ion" },
      { kind: "boolean", canonical: "fresh_air", key: "fresh" },
      { kind: "boolean", canonical: "eye", key: "eye" },
    ],
  },

  airton: {
    power: { kind: "stateful" },
    modes: { constants: AirtonMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" } },
    fan: { constants: AirtonFan, map: { Auto: "auto", Min: "min", Low: "low", Med: "medium", High: "high", Max: "max" } },
    temp: { min: 16, max: 31, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "health", key: "health" },
      { kind: "boolean", canonical: "light", key: "light" },
    ],
  },

  delonghi_ac: {
    power: { kind: "stateful" },
    modes: { constants: DelonghiAcMode, map: { Cool: "cool", Dry: "dry", Fan: "fan", Auto: "auto" } },
    fan: { constants: DelonghiAcFan, map: { Auto: "auto", High: "high", Medium: "medium", Low: "low" } },
    temp: { min: 18, max: 32, step: 1 },
    features: [
      { kind: "boolean", canonical: "turbo", key: "boost" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "range", canonical: "timer_on", key: "onTimer", min: 0, max: 1439, step: 1, unit: "minutes" },
      { kind: "range", canonical: "timer_off", key: "offTimer", min: 0, max: 1439, step: 1, unit: "minutes" },
    ],
  },

  truma: {
    power: { kind: "stateful" },
    modes: { constants: TrumaMode, map: { Auto: "auto", Cool: "cool", Fan: "fan" } },
    fan: { constants: TrumaFan, map: { Quiet: "quiet", High: "high", Med: "medium", Low: "low" } },
    temp: { min: 16, max: 31, step: 1 },
    features: [],
  },

  amcor: {
    power: { kind: "stateful" },
    modes: { constants: AmcorMode, map: { Cool: "cool", Heat: "heat", Fan: "fan", Dry: "dry", Auto: "auto" } },
    fan: { constants: AmcorFan, map: { Min: "min", Med: "medium", Max: "max", Auto: "auto" } },
    temp: { min: 12, max: 32, step: 1 },
    features: [
      { kind: "boolean", canonical: "turbo", key: "max" },
    ],
  },

  rhoss: {
    power: { kind: "stateful" },
    modes: { constants: RhossMode, map: { Heat: "heat", Cool: "cool", Dry: "dry", Fan: "fan", Auto: "auto" } },
    fan: { constants: RhossFan, map: { Auto: "auto", Min: "min", Med: "medium", Max: "max" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swing", kind: "bool" },
    features: [],
  },

  argo: {
    power: { kind: "stateful" },
    // HeatAuto has no canonical token; Off is the wire "fan" mode.
    modes: {
      constants: { Cool: ArgoMode.Cool, Dry: ArgoMode.Dry, Auto: ArgoMode.Auto, Off: ArgoMode.Off, Heat: ArgoMode.Heat },
      map: { Cool: "cool", Dry: "dry", Auto: "auto", Off: "fan", Heat: "heat" },
    },
    fan: { constants: ArgoFan, map: { Auto: "auto", Min: "min", Med: "medium", Max: "max" } },
    temp: { min: 10, max: 32, step: 1 },
    swingV: { key: "flap", kind: "position", positions: { constants: ArgoFlap, map: {
      Auto: "auto", Pos1: "highest", Pos2: "high", Pos3: "middle_up", Pos4: "middle_down",
      Pos5: "low", Pos6: "lowest", Full: "swing",
    } } },
    features: [
      { kind: "boolean", canonical: "turbo", key: "max" },
      { kind: "boolean", canonical: "sleep", key: "night" },
      { kind: "boolean", canonical: "ifeel", key: "iFeel" },
      { kind: "range", canonical: "sensor_temp", key: "roomTemp", min: 4, max: 35, step: 1 },
    ],
  },

  argo_wrem3: {
    power: { kind: "stateful" },
    modes: { constants: ArgoWrem3Mode, map: { Cool: "cool", Dry: "dry", Heat: "heat", Fan: "fan", Auto: "auto" } },
    // FAN_LOWER (2) has no canonical token → numeric fallback.
    fan: { constants: ArgoWrem3Fan, map: { Auto: "auto", Lowest: "min", Low: "low", Medium: "medium", High: "high", Highest: "max" } },
    temp: { min: 10, max: 32, step: 1 },
    swingV: { key: "flap", kind: "position", positions: { constants: ArgoWrem3Flap, map: {
      Auto: "auto", Pos1: "highest", Pos2: "high", Pos3: "middle_up", Pos4: "middle_down",
      Pos5: "low", Pos6: "lowest", Full: "swing",
    } } },
    features: [
      { kind: "boolean", canonical: "turbo", key: "max" },
      { kind: "boolean", canonical: "sleep", key: "night" },
      { kind: "boolean", canonical: "econo", key: "eco" },
      { kind: "boolean", canonical: "filter", key: "filter" },
      { kind: "boolean", canonical: "light", key: "light" },
      { kind: "boolean", canonical: "ifeel", key: "iFeel" },
      { kind: "range", canonical: "sensor_temp", key: "roomTemp", min: 4, max: 35, step: 1 },
    ],
  },

  airwell: {
    power: { kind: "toggle", key: "powerToggle" },
    modes: { constants: AirwellMode, map: { Cool: "cool", Heat: "heat", Auto: "auto", Dry: "dry", Fan: "fan" } },
    fan: { constants: AirwellFan, map: { Low: "low", Medium: "medium", High: "high", Auto: "auto" } },
    temp: { min: 16, max: 30, step: 1 },
    features: [],
  },

  corona_ac: {
    power: { kind: "stateful" },
    modes: { constants: CoronaAcMode, map: { Heat: "heat", Dry: "dry", Cool: "cool", Fan: "fan" } },
    fan: { constants: CoronaAcFan, map: { Auto: "auto", Low: "low", Medium: "medium", High: "high" } },
    temp: { min: 17, max: 30, step: 1 },
    features: [
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "swing_toggle", key: "swingVToggle" },
      { kind: "boolean", canonical: "power_toggle", key: "powerButton" },
      { kind: "range", canonical: "timer_on", key: "onTimer", min: 0, max: 720, step: 1, unit: "minutes" },
      { kind: "range", canonical: "timer_off", key: "offTimer", min: 0, max: 720, step: 1, unit: "minutes" },
    ],
  },

  ecoclim: {
    power: { kind: "stateful" },
    // Recycle/Sleep have no canonical mode token; expose only the standard five.
    modes: {
      constants: { Auto: EcoclimMode.Auto, Cool: EcoclimMode.Cool, Dry: EcoclimMode.Dry, Fan: EcoclimMode.Fan, Heat: EcoclimMode.Heat },
      map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" },
    },
    fan: { constants: EcoclimFan, map: { Min: "min", Med: "medium", Max: "max", Auto: "auto" } },
    temp: { min: 5, max: 36, step: 1 },
    features: [
      { kind: "range", canonical: "sensor_temp", key: "sensorTemp", min: 5, max: 36, step: 1 },
      { kind: "range", canonical: "clock", key: "clock", min: 0, max: 1439, unit: "minutes" },
      { kind: "range", canonical: "timer_on", key: "onTimer", min: 0, max: 1439, step: 10, unit: "minutes" },
      { kind: "range", canonical: "timer_off", key: "offTimer", min: 0, max: 1439, step: 10, unit: "minutes" },
    ],
  },

  technibel_ac: {
    power: { kind: "stateful" },
    modes: { constants: TechnibelAcMode, map: { Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" } },
    fan: { constants: TechnibelAcFan, map: { Low: "low", Medium: "medium", High: "high" } },
    temp: { min: 16, max: 31, step: 1 },
    swingV: { key: "swing", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "range", canonical: "timer", key: "timer", min: 0, max: 1440, step: 60, unit: "minutes" },
    ],
  },

  daikin: {
    power: { kind: "stateful" },
    modes: DAIKIN_MODE, fan: DAIKIN_FAN, temp: { min: 10, max: 32, step: 0.5 },
    swingV: { key: "swingVertical", kind: "bool" },
    swingH: { key: "swingHorizontal", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "quiet", key: "quiet" },
      { kind: "boolean", canonical: "turbo", key: "powerful" },
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "xfan", key: "mold" },
      { kind: "boolean", canonical: "comfort", key: "comfort" },
      { kind: "boolean", canonical: "ifeel", key: "sensor" },
      { kind: "boolean", canonical: "weekly_timer", key: "weeklyTimer" },
      { kind: "range", canonical: "clock", key: "currentTime", min: 0, max: 1439, unit: "minutes" },
      { kind: "range", canonical: "weekday", key: "currentDay", min: 1, max: 7 },
      { kind: "range", canonical: "timer_on", key: "onTime", min: 0, max: 1439, unit: "minutes" },
      { kind: "range", canonical: "timer_off", key: "offTime", min: 0, max: 1439, unit: "minutes" },
    ],
  },

  daikin2: {
    power: { kind: "stateful" },
    modes: DAIKIN_MODE, fan: DAIKIN_FAN, temp: { min: 10, max: 32, step: 1 },
    swingV: { key: "swingVertical", kind: "numeric", min: 0, max: 15 },
    swingH: { key: "swingHorizontal", kind: "numeric", min: 0, max: 255 },
    features: [
      { kind: "boolean", canonical: "quiet", key: "quiet" },
      { kind: "boolean", canonical: "turbo", key: "powerful" },
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "clean", key: "clean" },
      { kind: "boolean", canonical: "xfan", key: "mold" },
      { kind: "boolean", canonical: "fresh_air", key: "freshAir" },
      { kind: "boolean", canonical: "fresh_air_high", key: "freshAirHigh" },
      { kind: "boolean", canonical: "eye", key: "eye" },
      { kind: "boolean", canonical: "eye_auto", key: "eyeAuto" },
      { kind: "boolean", canonical: "purify", key: "purify" },
      { kind: "range", canonical: "light", key: "light", min: 0, max: 3 },
      { kind: "range", canonical: "beep", key: "beep", min: 0, max: 3 },
      { kind: "range", canonical: "clock", key: "currentTime", min: 0, max: 1439, unit: "minutes" },
    ],
  },

  daikin312: {
    power: { kind: "stateful" },
    modes: DAIKIN_MODE, fan: DAIKIN_FAN, temp: { min: 10, max: 32, step: 0.5 },
    swingV: { key: "swingVertical", kind: "numeric", min: 0, max: 15 },
    swingH: { key: "swingHorizontal", kind: "numeric", min: 0, max: 15 },
    features: [
      { kind: "boolean", canonical: "quiet", key: "quiet" },
      { kind: "boolean", canonical: "turbo", key: "powerful" },
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "clean", key: "clean" },
      { kind: "boolean", canonical: "xfan", key: "mold" },
      { kind: "boolean", canonical: "fresh_air", key: "freshAir" },
      { kind: "boolean", canonical: "fresh_air_high", key: "freshAirHigh" },
      { kind: "boolean", canonical: "eye", key: "eye" },
      { kind: "boolean", canonical: "eye_auto", key: "eyeAuto" },
      { kind: "boolean", canonical: "purify", key: "purify" },
      { kind: "range", canonical: "light", key: "light", min: 0, max: 3 },
      { kind: "range", canonical: "beep", key: "beep", min: 0, max: 3 },
      { kind: "range", canonical: "clock", key: "currentTime", min: 0, max: 1439, unit: "minutes" },
    ],
  },

  daikin216: {
    power: { kind: "stateful" },
    modes: DAIKIN_MODE, fan: DAIKIN_FAN, temp: DAIKIN_TEMP,
    swingV: { key: "swingVertical", kind: "bool" },
    swingH: { key: "swingHorizontal", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "turbo", key: "powerful" },
    ],
  },

  daikin160: {
    power: { kind: "stateful" },
    modes: DAIKIN_MODE, fan: DAIKIN_FAN, temp: DAIKIN_TEMP,
    swingV: { key: "swingVertical", kind: "position", positions: { constants: Daikin160SwingV, map: {
      Lowest: "lowest", Low: "low", Middle: "middle", High: "high", Highest: "highest", Auto: "auto",
    } } },
    features: [],
  },

  daikin176: {
    power: { kind: "stateful" },
    modes: { constants: Daikin176Mode, map: { Fan: "fan", Heat: "heat", Cool: "cool", Auto: "auto", Dry: "dry" } },
    fan: { numericRange: { min: 1, max: 3 } },
    temp: DAIKIN_TEMP,
    swingH: { key: "swingHorizontal", kind: "position", positions: { constants: Daikin176SwingH, map: { Off: "off", Auto: "auto" } } },
    features: [
      { kind: "range", canonical: "unit_id", key: "id", min: 0, max: 1 },
    ],
  },

  daikin64: {
    power: { kind: "stateful" },
    modes: { constants: Daikin64Mode, map: { Dry: "dry", Cool: "cool", Fan: "fan", Heat: "heat" } },
    fan: { constants: Daikin64Fan, map: { Auto: "auto", High: "high", Med: "medium", Low: "low", Quiet: "quiet", Turbo: "turbo" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingVertical", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "range", canonical: "clock", key: "clock", min: 0, max: 1439, unit: "minutes" },
      { kind: "range", canonical: "timer_on", key: "onTime", min: 0, max: 1439, step: 30, unit: "minutes", enabledKey: "onTimerEnabled" },
      { kind: "range", canonical: "timer_off", key: "offTime", min: 0, max: 1439, step: 30, unit: "minutes", enabledKey: "offTimerEnabled" },
    ],
  },

  daikin128: {
    power: { kind: "stateful" },
    modes: { constants: Daikin128Mode, map: { Dry: "dry", Cool: "cool", Fan: "fan", Heat: "heat", Auto: "auto" } },
    fan: { constants: Daikin128Fan, map: { Auto: "auto", High: "high", Med: "medium", Low: "low", Powerful: "powerful", Quiet: "quiet" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingVertical", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "light_ceiling", key: "ceiling" },
      { kind: "boolean", canonical: "light_wall", key: "wall" },
      { kind: "range", canonical: "clock", key: "clock", min: 0, max: 1439, unit: "minutes" },
      { kind: "range", canonical: "timer_on", key: "onTime", min: 0, max: 1439, step: 30, unit: "minutes", enabledKey: "onTimerEnabled" },
      { kind: "range", canonical: "timer_off", key: "offTime", min: 0, max: 1439, step: 30, unit: "minutes", enabledKey: "offTimerEnabled" },
    ],
  },

  daikin152: {
    power: { kind: "stateful" },
    modes: DAIKIN_MODE, fan: DAIKIN_FAN, temp: DAIKIN_TEMP,
    swingV: { key: "swingVertical", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "quiet", key: "quiet" },
      { kind: "boolean", canonical: "turbo", key: "powerful" },
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "ifeel", key: "sensor" },
      { kind: "boolean", canonical: "comfort", key: "comfort" },
    ],
  },

  voltas: {
    power: { kind: "stateful" },
    modes: { constants: VoltasMode, map: { Fan: "fan", Heat: "heat", Dry: "dry", Cool: "cool" } },
    fan: { constants: VoltasFan, map: { High: "high", Med: "medium", Low: "low", Auto: "auto" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    swingH: { key: "swingH", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "turbo", key: "turbo", validModes: ["cool"] },
      { kind: "boolean", canonical: "sleep", key: "sleep", validModes: ["cool"] },
      { kind: "boolean", canonical: "econo", key: "econo", validModes: ["cool"] },
      { kind: "boolean", canonical: "light", key: "light" },
      { kind: "boolean", canonical: "wifi", key: "wifi" },
      { kind: "range", canonical: "timer_on", key: "onTime", min: 0, max: 1439, unit: "minutes" },
      { kind: "range", canonical: "timer_off", key: "offTime", min: 0, max: 1439, unit: "minutes" },
      { kind: "enum", canonical: "model", key: "model", constants: VoltasModel, map: { Unknown: "full", LZF: "lzf" } },
    ],
  },

  godrej: {
    power: { kind: "stateful" },
    modes: { constants: GodrejMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" } },
    fan: { constants: GodrejFan, map: { Auto: "auto", Low: "low", Med: "medium", High: "high" } },
    temp: { min: 16, max: 31, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "light", key: "display" },
      { kind: "boolean", canonical: "ifeel", key: "iSense" },
      { kind: "range", canonical: "convert", key: "convert", min: 0, max: 5 },
      { kind: "range", canonical: "isense_temp", key: "iSenseTemp", min: 16, max: 31 },
      { kind: "range", canonical: "timer", key: "timerMinutes", min: 0, max: 1440, step: 30, unit: "minutes", enabledKey: "timerEnabled" },
    ],
  },

  kelon: {
    power: { kind: "toggle", key: "powerToggle" },
    modes: { constants: KelonMode, map: { Heat: "heat", Smart: "smart", Cool: "cool", Dry: "dry", Fan: "fan" } },
    fan: { constants: KelonFan, map: { Auto: "auto", Min: "min", Med: "medium", Max: "max" } },
    temp: { min: 18, max: 32, step: 1 },
    swingV: { key: "swingVToggle", kind: "toggle" },
    features: [
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "smart_mode", key: "smartMode" },
      { kind: "boolean", canonical: "turbo", key: "superCool" },
      { kind: "range", canonical: "dry_grade", key: "dryGrade", min: -2, max: 2 },
      { kind: "range", canonical: "timer", key: "timerMinutes", min: 0, max: 1440, unit: "minutes", enabledKey: "timerEnabled" },
    ],
  },

  kelon168: {
    power: { kind: "stateful" },
    modes: { constants: Kelon168Mode, map: { Heat: "heat", Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan" } },
    fan: { constants: Kelon168Fan, map: { Auto: "auto", Min: "min", Low: "low", Medium: "medium", High: "high", Max: "max" } },
    temp: { min: 16, max: 31, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "power_flag", key: "powerFlag" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "turbo", key: "super" },
      { kind: "boolean", canonical: "light", key: "light" },
      { kind: "range", canonical: "clock", key: "clockMinutes", min: 0, max: 1439, unit: "minutes" },
      { kind: "range", canonical: "timer_on", key: "onTimerMinutes", min: 0, max: 1439, unit: "minutes", enabledKey: "onTimerEnabled" },
      { kind: "range", canonical: "timer_off", key: "offTimerMinutes", min: 0, max: 1439, unit: "minutes", enabledKey: "offTimerEnabled" },
      { kind: "enum", canonical: "command", key: "command", constants: Kelon168Command, map: {
        Light: "light", Power: "power", Temp: "temp", Sleep: "sleep", Super: "super", OnTimer: "on_timer",
        Mode: "mode", Swing: "swing", IFeel: "ifeel", FanSpeed: "fan_speed", OffTimer: "off_timer",
      } },
    ],
  },

  teco: {
    power: { kind: "stateful" },
    modes: { constants: TecoMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" } },
    fan: { constants: TecoFan, map: { Auto: "auto", Low: "low", Med: "medium", High: "high" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "light", key: "light" },
      { kind: "boolean", canonical: "humid", key: "humid" },
      { kind: "boolean", canonical: "econo", key: "save" },
      { kind: "range", canonical: "timer", key: "timerMinutes", min: 0, max: 1440, unit: "minutes" },
    ],
  },

  lloyd: {
    power: { kind: "stateful" },
    modes: { constants: LloydMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Heat: "heat", Fan: "fan" } },
    fan: { constants: LloydFan, map: { Auto: "auto", Low: "low", Med: "medium", High: "high" } },
    temp: { min: 16, max: 30, step: 1 },
    // Raw 0–7 swing code; exact angle↔code semantics are not yet confirmed.
    swingV: { key: "swingV", kind: "numeric", min: 0, max: 7 },
    swingH: { key: "swingH", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "econo", key: "eco" },
      { kind: "boolean", canonical: "light", key: "display" },
    ],
  },

  fujitsu_ac: {
    power: { kind: "stateful" },
    modes: { constants: FujitsuMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" } },
    fan: { constants: FujitsuFan, map: { Auto: "auto", High: "max", Med: "medium", Low: "low", Quiet: "quiet" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    swingH: { key: "swingH", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "clean", key: "clean" },
      { kind: "boolean", canonical: "filter", key: "filter" },
      { kind: "boolean", canonical: "quiet", key: "outsideQuiet" },
      { kind: "enum", canonical: "model", key: "model", constants: FujitsuModel, map: {
        ARRAH2E: "arrah2e", ARDB1: "ardb1", ARREB1E: "arreb1e",
        ARJW2: "arjw2", ARRY4: "arry4", ARREW4E: "arrew4e",
      } },
    ],
  },

  bluestar: {
    power: { kind: "stateful" },
    modes: { constants: BluestarMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan" } },
    fan: { constants: BluestarFan, map: { Auto: "auto", Low: "low", Medium: "medium", High: "high" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swing", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "light", key: "light" },
      { kind: "boolean", canonical: "timer", key: "timer" },
    ],
  },

  mitsubishi_ac: {
    power: { kind: "stateful" },
    modes: { constants: MitsubishiAcMode, map: { Heat: "heat", Dry: "dry", Cool: "cool", Auto: "auto", Fan: "fan" } },
    fan: { constants: MitsubishiAcFan, map: { Auto: "auto", Speed1: "min", Speed2: "low", Speed3: "medium", Speed4: "high", Max: "max", Silent: "quiet" } },
    temp: { min: 16, max: 31, step: 0.5 },
    swingV: { key: "swingV", kind: "position", positions: { constants: MitsubishiAcVane, map: {
      Auto: "auto", Highest: "highest", High: "high", Middle: "middle", Low: "low", Lowest: "lowest", Swing: "swing",
    } } },
    swingH: { key: "swingH", kind: "position", positions: { constants: MitsubishiAcWideVane, map: {
      LeftMax: "left_max", Left: "left", Middle: "middle", Right: "right", RightMax: "right_max", Wide: "wide", Auto: "auto",
    } } },
    features: [
      { kind: "boolean", canonical: "isee", key: "iSee" },
      { kind: "boolean", canonical: "natural_flow", key: "naturalFlow" },
      { kind: "boolean", canonical: "econo", key: "ecocool" },
      { kind: "boolean", canonical: "weekly_timer", key: "weeklyTimer" },
      { kind: "boolean", canonical: "absence_detect", key: "absenseDetect" },
      { kind: "boolean", canonical: "isave_10c", key: "iSave10C" },
      { kind: "range", canonical: "vane_left", key: "vaneLeft", min: 0, max: 7 },
      { kind: "range", canonical: "clock", key: "clock", min: 0, max: 255 },
      { kind: "range", canonical: "start_clock", key: "startClock", min: 0, max: 255 },
      { kind: "range", canonical: "stop_clock", key: "stopClock", min: 0, max: 255 },
      { kind: "range", canonical: "timer_mode", key: "timer", min: 0, max: 7 },
      { kind: "range", canonical: "direct_indirect", key: "directIndirect", min: 0, max: 3 },
    ],
  },

  mitsubishi136: {
    power: { kind: "stateful" },
    modes: { constants: Mitsubishi136Mode, map: { Fan: "fan", Cool: "cool", Heat: "heat", Auto: "auto", Dry: "dry" } },
    fan: { constants: Mitsubishi136Fan, map: { Min: "min", Low: "low", Med: "medium", Max: "max" } },
    temp: { min: 17, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: Mitsubishi136SwingV, map: {
      Lowest: "lowest", Low: "low", High: "high", Highest: "highest", Auto: "auto",
    } } },
    features: [],
  },

  mitsubishi112: {
    power: { kind: "stateful" },
    modes: { constants: Mitsubishi112Mode, map: { Heat: "heat", Dry: "dry", Cool: "cool", Auto: "auto" } },
    fan: { constants: Mitsubishi112Fan, map: { Max: "max", Min: "min", Low: "low", Med: "medium" } },
    temp: { min: 16, max: 31, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: Mitsubishi112SwingV, map: {
      Highest: "highest", High: "high", Middle: "middle", Low: "low", Lowest: "lowest", Auto: "auto",
    } } },
    swingH: { key: "swingH", kind: "position", positions: { constants: Mitsubishi112SwingH, map: {
      LeftMax: "left_max", Left: "left", Middle: "middle", Right: "right", RightMax: "right_max", Wide: "wide", Auto: "auto",
    } } },
    features: [],
  },

  tcl112: {
    power: { kind: "stateful" },
    modes: { constants: Tcl112Mode, map: { Heat: "heat", Dry: "dry", Cool: "cool", Fan: "fan", Auto: "auto" } },
    fan: { constants: Tcl112Fan, map: { Auto: "auto", Min: "min", Low: "low", Med: "medium", High: "high" } },
    temp: { min: 16, max: 31, step: 0.5 },
    swingV: { key: "swingV", kind: "position", positions: { constants: Tcl112SwingV, map: {
      Off: "off", Highest: "highest", High: "high", Middle: "middle", Low: "low", Lowest: "lowest", On: "on",
    } } },
    swingH: { key: "swingH", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "health", key: "health" },
      { kind: "boolean", canonical: "light", key: "light" },
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "range", canonical: "timer_on", key: "onTimer", min: 0, max: 720, step: 20, unit: "minutes" },
      { kind: "range", canonical: "timer_off", key: "offTimer", min: 0, max: 720, step: 20, unit: "minutes" },
      { kind: "enum", canonical: "model", key: "model", constants: Tcl112Model, map: { TAC09CHSD: "tac09chsd", GZ055BE1: "gz055be1" } },
    ],
  },

  // Identical mapping to tcl112 — Teknopoint reuses the TCL112AC byte format.
  teknopoint: {
    power: { kind: "stateful" },
    modes: { constants: TeknopointMode, map: { Heat: "heat", Dry: "dry", Cool: "cool", Fan: "fan", Auto: "auto" } },
    fan: { constants: TeknopointFan, map: { Auto: "auto", Min: "min", Low: "low", Med: "medium", High: "high" } },
    temp: { min: 16, max: 31, step: 0.5 },
    swingV: { key: "swingV", kind: "position", positions: { constants: TeknopointSwingV, map: {
      Off: "off", Highest: "highest", High: "high", Middle: "middle", Low: "low", Lowest: "lowest", On: "on",
    } } },
    swingH: { key: "swingH", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "health", key: "health" },
      { kind: "boolean", canonical: "light", key: "light" },
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "range", canonical: "timer_on", key: "onTimer", min: 0, max: 720, step: 20, unit: "minutes" },
      { kind: "range", canonical: "timer_off", key: "offTimer", min: 0, max: 720, step: 20, unit: "minutes" },
      { kind: "enum", canonical: "model", key: "model", constants: TeknopointModel, map: { TAC09CHSD: "tac09chsd", GZ055BE1: "gz055be1" } },
    ],
  },

  panasonic_ac: {
    power: { kind: "stateful" },
    modes: { constants: PanasonicAcMode, map: { Auto: "auto", Dry: "dry", Cool: "cool", Heat: "heat", Fan: "fan" } },
    fan: { constants: PanasonicAcFan, map: { Min: "min", Low: "low", Med: "medium", High: "high", Max: "max", Auto: "auto" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: PanasonicAcSwingV, map: {
      Highest: "highest", High: "high", Middle: "middle", Low: "low", Lowest: "lowest", Auto: "auto",
    } } },
    swingH: { key: "swingH", kind: "position", positions: { constants: PanasonicAcSwingH, map: {
      Middle: "middle", FullLeft: "left_max", Left: "left", Right: "right", FullRight: "right_max", Auto: "auto",
    } } },
    features: [
      { kind: "boolean", canonical: "quiet", key: "quiet" },
      { kind: "boolean", canonical: "turbo", key: "powerful" },
      { kind: "boolean", canonical: "purify", key: "ion" },
      { kind: "range", canonical: "clock", key: "clock", min: 0, max: 1439, unit: "minutes" },
      { kind: "range", canonical: "timer_on", key: "onTimer", min: 0, max: 1439, step: 10, unit: "minutes", enabledKey: "onTimerEnabled" },
      { kind: "range", canonical: "timer_off", key: "offTimer", min: 0, max: 1439, step: 10, unit: "minutes", enabledKey: "offTimerEnabled" },
      { kind: "enum", canonical: "model", key: "model", constants: PanasonicAcModel, map: { Lke: "lke", Nke: "nke", Dke: "dke", Jke: "jke", Ckp: "ckp", Rkr: "rkr" } },
    ],
  },

  lg_ac: {
    power: { kind: "stateful" },
    modes: { constants: LgAcMode, map: { Cool: "cool", Dry: "dry", Fan: "fan", Auto: "auto", Heat: "heat" } },
    fan: { constants: LgAcFan, map: { Lowest: "min", Low: "low", Medium: "medium", High: "high", Max: "max", Auto: "auto" } },
    temp: { min: 16, max: 30, step: 1 },
    features: [
      { kind: "enum", canonical: "model", key: "model", constants: LgAcModel, map: {
        GE6711AR2853M: "ge6711ar2853m", AKB75215403: "akb75215403", AKB74955603: "akb74955603", AKB73757604: "akb73757604", LG6711A20083V: "lg6711a20083v",
      } },
    ],
  },

  toshiba_ac: {
    power: { kind: "stateful" },
    modes: { constants: ToshibaAcMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Heat: "heat", Fan: "fan" } },
    fan: { constants: ToshibaAcFan, map: { Auto: "auto", Min: "min", Med: "medium", Max: "max" } },
    temp: { min: 17, max: 30, step: 1 },
    features: [
      { kind: "boolean", canonical: "purify", key: "filter" },
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "enum", canonical: "model", key: "model", constants: ToshibaAcModel, map: { A: "a", B: "b" } },
    ],
  },

  sharp_ac: {
    power: { kind: "stateful" },
    modes: { constants: SharpAcMode, map: { Auto: "auto", Heat: "heat", Cool: "cool", Dry: "dry" } },
    fan: { constants: SharpAcFan, map: { Auto: "auto", Min: "min", Med: "medium", High: "high", Max: "max" } },
    temp: { min: 15, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: SharpAcSwingV, map: {
      Ignore: "auto", High: "highest", Off: "off", Mid: "middle", Low: "low", Last: "last", Lowest: "lowest", Toggle: "swing",
    } } },
    features: [
      { kind: "boolean", canonical: "purify", key: "ion" },
      { kind: "enum", canonical: "model", key: "model", constants: SharpAcModel, map: { A907: "a907", A705: "a705", A903: "a903" } },
    ],
  },

  sanyo_ac: {
    power: { kind: "stateful" },
    modes: { constants: SanyoAcMode, map: { Heat: "heat", Cool: "cool", Dry: "dry", Auto: "auto" } },
    fan: { constants: SanyoAcFan, map: { Auto: "auto", High: "high", Low: "low", Medium: "medium" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: SanyoAcSwingV, map: {
      Auto: "auto", Lowest: "lowest", Low: "low", LowerMiddle: "middle_down", UpperMiddle: "middle_up", High: "high", Highest: "highest",
    } } },
    features: [
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "beep", key: "beep" },
      { kind: "range", canonical: "timer_off", key: "offTimer", min: 0, max: 900, step: 60, unit: "minutes" },
    ],
  },

  whirlpool_ac: {
    power: { kind: "toggle", key: "powerToggle" },
    modes: { constants: WhirlpoolAcMode, map: { Heat: "heat", Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan" } },
    fan: { constants: WhirlpoolAcFan, map: { Auto: "auto", High: "high", Medium: "medium", Low: "low" } },
    temp: { min: 18, max: 32, step: 1 },
    swingV: { key: "swing", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "light", key: "light" },
      { kind: "boolean", canonical: "turbo", key: "super" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "enum", canonical: "model", key: "model", constants: WhirlpoolAcModel, map: { DG11J13A: "dg11j13a", DG11J191: "dg11j191" } },
    ],
  },

  whirlpool_magicool: {
    power: { kind: "stateful" },
    modes: { constants: WhirlpoolMagicoolMode, map: { Cool: "cool", Dry: "dry", Fan: "fan", SixthSense: "smart" } },
    fan: { constants: WhirlpoolMagicoolFan, map: { Auto: "auto", Sleep: "quiet", Low: "low", Med: "medium", High: "high" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swing", kind: "position", positions: { constants: WhirlpoolMagicoolSwing, map: {
      Off: "off", Pos1: "highest", Pos2: "high", Pos3: "middle", Pos4: "low", Pos5: "lowest", Full: "swing",
    } } },
    features: [
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "econo", key: "eco" },
      { kind: "boolean", canonical: "quiet", key: "silent" },
      { kind: "boolean", canonical: "light", key: "light" },
    ],
  },

  whirlpool_magicool2: {
    power: { kind: "stateful" },
    modes: { constants: WhirlpoolMagicool2Mode, map: { Cool: "cool", Dry: "dry", Fan: "fan" } },
    fan: { constants: WhirlpoolMagicool2Fan, map: { Auto: "auto", High: "high", Low: "low", Med: "medium" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swing", kind: "position", positions: { constants: WhirlpoolMagicool2Swing, map: {
      Pos1: "lowest", Pos2: "low", Pos3: "middle", Pos4: "high", Pos5: "highest", Full: "swing",
    } } },
    features: [
      { kind: "boolean", canonical: "smart_mode", key: "sixthSense" },
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "econo", key: "eco" },
      { kind: "boolean", canonical: "quiet", key: "silent" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "light", key: "light" },
    ],
  },

  sanyo_ac88: {
    power: { kind: "stateful" },
    modes: { constants: SanyoAc88Mode, map: { Auto: "auto", FeelCool: "feel_cool", Cool: "cool", FeelHeat: "feel_heat", Heat: "heat", Fan: "fan" } },
    fan: { constants: SanyoAc88Fan, map: { Auto: "auto", Low: "low", Medium: "medium", High: "high" } },
    temp: { min: 10, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "filter", key: "filter" },
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "range", canonical: "clock", key: "clock", min: 0, max: 1439, step: 1, unit: "minutes" },
    ],
  },

  mitsubishi_heavy152: {
    power: { kind: "stateful" },
    modes: { constants: MitsubishiHeavy152Mode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" } },
    fan: { constants: MitsubishiHeavy152Fan, map: { Auto: "auto", Low: "low", Med: "medium", High: "high", Max: "max", Econo: "econo", Turbo: "turbo" } },
    temp: { min: 17, max: 31, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: MitsubishiHeavy152SwingV, map: {
      Auto: "auto", Highest: "highest", High: "high", Middle: "middle", Low: "low", Lowest: "lowest", Off: "off",
    } } },
    swingH: { key: "swingH", kind: "position", positions: { constants: MitsubishiHeavy152SwingH, map: {
      Auto: "auto", LeftMax: "left_max", Left: "left", Middle: "middle", Right: "right", RightMax: "right_max",
      RightLeft: "right_left", LeftRight: "left_right", Off: "off",
    } } },
    features: [
      { kind: "boolean", canonical: "night", key: "night" },
      { kind: "boolean", canonical: "quiet", key: "silent" },
      { kind: "boolean", canonical: "filter", key: "filter" },
      { kind: "boolean", canonical: "clean", key: "clean" },
      { kind: "boolean", canonical: "3d", key: "threeD" },
    ],
  },

  mitsubishi_heavy88: {
    power: { kind: "stateful" },
    modes: { constants: MitsubishiHeavy88Mode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" } },
    fan: { constants: MitsubishiHeavy88Fan, map: { Auto: "auto", Low: "low", Med: "medium", High: "high", Turbo: "turbo", Econo: "econo" } },
    temp: { min: 17, max: 31, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: MitsubishiHeavy88SwingV, map: {
      Off: "off", Auto: "auto", Highest: "highest", High: "high", Middle: "middle", Low: "low", Lowest: "lowest",
    } } },
    swingH: { key: "swingH", kind: "position", positions: { constants: MitsubishiHeavy88SwingH, map: {
      Off: "off", Auto: "auto", LeftMax: "left_max", Left: "left", Middle: "middle", Right: "right",
      RightMax: "right_max", RightLeft: "right_left", LeftRight: "left_right", ThreeD: "3d",
    } } },
    features: [
      { kind: "boolean", canonical: "clean", key: "clean" },
    ],
  },

  carrier_ac64: {
    power: { kind: "stateful" },
    modes: { constants: CarrierAc64Mode, map: { Heat: "heat", Cool: "cool", Fan: "fan" } },
    fan: { constants: CarrierAc64Fan, map: { Auto: "auto", Low: "low", Medium: "medium", High: "high" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "range", canonical: "timer_on", key: "onTimer", min: 0, max: 540, step: 60, unit: "minutes" },
      { kind: "range", canonical: "timer_off", key: "offTimer", min: 0, max: 540, step: 60, unit: "minutes" },
    ],
  },

  haier_ac: {
    power: { kind: "stateful" },
    modes: { constants: HaierAcMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Heat: "heat", Fan: "fan" } },
    fan: { constants: HaierAcFan, map: { Auto: "auto", Low: "low", Med: "medium", High: "high" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: HaierAcSwingV, map: {
      Off: "off", Up: "up", Down: "down", Chg: "swing",
    } } },
    features: [
      { kind: "boolean", canonical: "health", key: "health" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
    ],
  },

  haier_ac_yrw02: {
    power: { kind: "stateful" },
    modes: { constants: HaierAcYrw02Mode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Heat: "heat", Fan: "fan" } },
    fan: { constants: HaierAcYrw02Fan, map: { High: "high", Med: "medium", Low: "low", Auto: "auto" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: HaierAc176SwingV, map: {
      Off: "off", Top: "highest", Middle: "middle", Bottom: "lowest", Down: "down", Auto: "auto",
    } } },
    swingH: { key: "swingH", kind: "position", positions: { constants: HaierAc176SwingH, map: {
      Middle: "middle", LeftMax: "left_max", Left: "left", Right: "right", RightMax: "right_max", Auto: "auto",
    } } },
    features: [
      { kind: "boolean", canonical: "health", key: "health" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "quiet", key: "quiet" },
    ],
  },

  haier_ac176: {
    power: { kind: "stateful" },
    modes: { constants: HaierAcYrw02Mode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Heat: "heat", Fan: "fan" } },
    fan: { constants: HaierAcYrw02Fan, map: { High: "high", Med: "medium", Low: "low", Auto: "auto" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: HaierAc176SwingV, map: {
      Off: "off", Top: "highest", Middle: "middle", Bottom: "lowest", Down: "down", Auto: "auto",
    } } },
    swingH: { key: "swingH", kind: "position", positions: { constants: HaierAc176SwingH, map: {
      Middle: "middle", LeftMax: "left_max", Left: "left", Right: "right", RightMax: "right_max", Auto: "auto",
    } } },
    features: [
      { kind: "boolean", canonical: "health", key: "health" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "quiet", key: "quiet" },
    ],
  },

  haier_ac160: {
    power: { kind: "stateful" },
    modes: { constants: HaierAcYrw02Mode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Heat: "heat", Fan: "fan" } },
    fan: { constants: HaierAcYrw02Fan, map: { High: "high", Med: "medium", Low: "low", Auto: "auto" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: HaierAc160SwingV, map: {
      Off: "off", Top: "up", Highest: "highest", High: "high", Middle: "middle", Low: "low", Lowest: "lowest", Auto: "auto",
    } } },
    features: [
      { kind: "boolean", canonical: "health", key: "health" },
      { kind: "boolean", canonical: "sleep", key: "sleep" },
      { kind: "boolean", canonical: "turbo", key: "turbo" },
      { kind: "boolean", canonical: "quiet", key: "quiet" },
      { kind: "boolean", canonical: "clean", key: "clean" },
    ],
  },

  samsung_ac: {
    power: { kind: "stateful" },
    modes: { constants: SamsungAcMode, map: { Auto: "auto", Cool: "cool", Dry: "dry", Fan: "fan", Heat: "heat" } },
    fan: { constants: SamsungAcFan, map: { Auto: "auto", Low: "low", Med: "medium", High: "high", Turbo: "max" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "bool" },
    swingH: { key: "swingH", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "quiet", key: "quiet" },
      { kind: "boolean", canonical: "turbo", key: "powerful" },
      { kind: "boolean", canonical: "comfort", key: "breeze" },
      { kind: "boolean", canonical: "econo", key: "econo" },
      { kind: "boolean", canonical: "clean", key: "clean" },
      { kind: "boolean", canonical: "beep", key: "beep" },
      { kind: "boolean", canonical: "light", key: "display" },
      { kind: "boolean", canonical: "purify", key: "ion" },
      { kind: "range", canonical: "timer_on", key: "onTimer", min: 0, max: 1440, step: 10, unit: "minutes" },
      { kind: "range", canonical: "timer_off", key: "offTimer", min: 0, max: 1440, step: 10, unit: "minutes" },
      { kind: "range", canonical: "sleep", key: "sleepTimer", min: 0, max: 1440, step: 10, unit: "minutes" },
    ],
  },

  panasonic_ac32: {
    power: { kind: "toggle", key: "powerToggle" },
    modes: { constants: PanasonicAc32Mode, map: { Fan: "fan", Cool: "cool", Dry: "dry", Heat: "heat", Auto: "auto" } },
    fan: { constants: PanasonicAc32Fan, map: { Min: "min", Low: "low", Med: "medium", High: "high", Max: "max", Auto: "auto" } },
    temp: { min: 16, max: 30, step: 1 },
    swingV: { key: "swingV", kind: "position", positions: { constants: PanasonicAc32SwingV, map: {
      Highest: "highest", High: "high", Middle: "middle", Low: "low", Lowest: "lowest", Auto: "auto",
    } } },
    swingH: { key: "swingH", kind: "bool" },
    features: [],
  },

  hitachi_ac: {
    power: { kind: "stateful" },
    modes: { constants: HitachiAcMode, map: { Auto: "auto", Heat: "heat", Cool: "cool", Dry: "dry", Fan: "fan" } },
    fan: { constants: HitachiAcFan, map: { Auto: "auto", Low: "low", Med: "medium", High: "high" } },
    temp: HITACHI_TEMP,
    swingV: { key: "swingV", kind: "bool" },
    swingH: { key: "swingH", kind: "bool" },
    features: [],
  },

  hitachi_ac1: {
    power: { kind: "stateful" },
    modes: { constants: HitachiAc1Mode, map: { Dry: "dry", Fan: "fan", Cool: "cool", Heat: "heat", Auto: "auto" } },
    fan: { constants: HitachiAc1Fan, map: { Auto: "auto", High: "high", Med: "medium", Low: "low" } },
    temp: { min: 16, max: 32, step: 1, lockedModes: ["auto"] },
    swingV: { key: "swingV", kind: "bool" },
    swingH: { key: "swingH", kind: "bool" },
    features: [
      { kind: "boolean", canonical: "power_toggle", key: "powerToggle" },
      { kind: "boolean", canonical: "swing_toggle", key: "swingToggle" },
      { kind: "range", canonical: "sleep", key: "sleep", min: 0, max: 4, validModes: ["auto", "cool"] },
      { kind: "range", canonical: "timer_on", key: "onTimer", min: 0, max: 1439, unit: "minutes" },
      { kind: "range", canonical: "timer_off", key: "offTimer", min: 0, max: 1439, unit: "minutes" },
      { kind: "enum", canonical: "model", key: "model", constants: HitachiAc1Model, map: { A: "a", B: "b" } },
    ],
  },

  hitachi_ac424: {
    power: { kind: "stateful" },
    modes: HITACHI424_MODE, fan: HITACHI424_FAN, temp: { ...HITACHI_TEMP, lockedModes: ["fan"] },
    swingV: { key: "swingVToggle", kind: "toggle" },
    features: [],
  },

  hitachi_ac264: {
    power: { kind: "stateful" },
    modes: HITACHI424_MODE,
    fan: { constants: HitachiAc264Fan, map: { Min: "min", Medium: "medium", High: "high", Auto: "auto" } },
    temp: { ...HITACHI_TEMP, lockedModes: ["fan"] },
    swingV: { key: "swingVToggle", kind: "toggle" },
    features: [],
  },

  hitachi_ac344: {
    power: { kind: "stateful" },
    modes: HITACHI424_MODE, fan: HITACHI424_FAN, temp: { ...HITACHI_TEMP, lockedModes: ["fan"] },
    swingV: { key: "swingV", kind: "bool" },
    swingH: { key: "swingH", kind: "position", positions: { constants: HitachiAc344SwingH, map: {
      Auto: "auto", RightMax: "right_max", Right: "right", Middle: "middle", Left: "left", LeftMax: "left_max",
    } } },
    features: [],
  },

  hitachi_ac296: {
    power: { kind: "stateful" },
    modes: { constants: HitachiAc296Mode, map: {
      Cool: "cool", DryCool: "dry_cool", Dehumidify: "dehumidify", Heat: "heat", Auto: "auto",
      AutoDehumidifying: "auto_dehumidify", QuickLaundry: "quick_laundry", CondensationControl: "condensation_control",
    } },
    fan: { constants: HitachiAc296Fan, map: { Silent: "quiet", Low: "low", Medium: "medium", High: "high", Auto: "auto" } },
    temp: { min: 16, max: 31, step: 1, lockedModes: ["auto"] },
    features: [],
  },
};

// ===========================================================================
// Helpers
// ===========================================================================

/** The canonical capability spec for a protocol, or undefined (raw/non-AC). */
export function getCanonicalCapabilities(protocol: ProtocolName): CapabilitySpec<ProtocolName> | undefined {
  return CAPABILITIES[protocol] as CapabilitySpec<ProtocolName> | undefined;
}

/** Find the key in a `{ name: value }` constant object whose value matches. */
function nameForValue(constants: Readonly<Record<string, number>>, value: number): string | undefined {
  for (const [name, v] of Object.entries(constants)) if (v === value) return name;
  return undefined;
}

/** Find the constant value whose mapped token equals `token`. */
function valueForToken(
  constants: Readonly<Record<string, number>>,
  map: Readonly<Record<string, string>>,
  token: string,
): number | undefined {
  for (const [name, t] of Object.entries(map)) if (t === token) return constants[name];
  return undefined;
}

function modeToCanonical(spec: ModeSpec, value: number): CanonicalMode | undefined {
  const name = nameForValue(spec.constants, value);
  return name !== undefined ? spec.map[name] : undefined;
}

function fanToCanonical(spec: FanSpec, value: number): CanonicalFanValue {
  if (spec.constants && spec.map) {
    const name = nameForValue(spec.constants, value);
    if (name !== undefined && spec.map[name] !== undefined) return spec.map[name]!;
  }
  return { numeric: value };
}

function fanFromCanonical(spec: FanSpec, fan: CanonicalFanValue): number | undefined {
  if (typeof fan === "object") return fan.numeric;
  if (spec.constants && spec.map) {
    for (const [name, token] of Object.entries(spec.map)) {
      if (token === fan) return spec.constants[name];
    }
  }
  return undefined;
}

/** Key-less view of a swing spec — the helpers below never touch `key`. */
type AnySwingSpec =
  | { kind: "bool" }
  | { kind: "toggle" }
  | { kind: "position"; positions: PositionSpec }
  | { kind: "numeric"; min: number; max: number };

function swingToCanonical(spec: AnySwingSpec, raw: unknown): SwingValue {
  switch (spec.kind) {
    case "bool": return { kind: "bool", on: !!raw };
    case "toggle": return { kind: "toggle", toggle: !!raw };
    case "numeric": return { kind: "numeric", value: Number(raw ?? 0) };
    case "position": {
      const value = Number(raw ?? 0);
      const name = nameForValue(spec.positions.constants, value);
      const token = name !== undefined ? spec.positions.map[name] : undefined;
      return token !== undefined ? { kind: "position", position: token } : { kind: "numeric", value };
    }
  }
}

function swingFromCanonical(spec: AnySwingSpec, sw: SwingValue): number | boolean | undefined {
  switch (spec.kind) {
    case "bool": return sw.kind === "bool" ? sw.on : sw.kind === "toggle" ? sw.toggle : undefined;
    case "toggle": return sw.kind === "toggle" ? sw.toggle : sw.kind === "bool" ? sw.on : undefined;
    case "numeric": return sw.kind === "numeric" ? sw.value : undefined;
    case "position": {
      if (sw.kind === "numeric") return sw.value;
      if (sw.kind !== "position") return undefined;
      for (const [name, token] of Object.entries(spec.positions.map)) {
        if (token === sw.position) return spec.positions.constants[name];
      }
      return undefined;
    }
  }
}

/**
 * Normalize a decoded protocol state into the canonical vocabulary.
 *
 * The inverse of {@link fromCanonical}. Throws for raw/opaque protocols that
 * carry no structured state.
 */
export function toCanonical<P extends ProtocolName>(protocol: P, state: ProtocolStateMap[P]): CanonicalState {
  const spec = CAPABILITIES[protocol] as CapabilitySpec<P> | undefined;
  if (!spec) throw new Error(`irtxrx: no canonical model for protocol "${protocol}"`);
  const s = state as Record<string, unknown>;
  const out: CanonicalState = {};

  // Power
  if (spec.power.kind === "stateful") {
    if (s.power !== undefined) out.power = { kind: "stateful", on: !!s.power };
  } else {
    const v = s[spec.power.key as string];
    if (v !== undefined) out.power = { kind: "toggle", toggle: !!v };
  }

  // Mode
  if (spec.modes && s.mode !== undefined) {
    const m = modeToCanonical(spec.modes, Number(s.mode));
    if (m !== undefined) out.mode = m;
  }

  // Temp
  if (spec.temp && s.temp !== undefined) out.temp = Number(s.temp);

  // Fan
  if (spec.fan && s.fan !== undefined) out.fan = fanToCanonical(spec.fan, Number(s.fan));

  // Swing
  if (spec.swingV && s[spec.swingV.key as string] !== undefined) {
    out.swingV = swingToCanonical(spec.swingV, s[spec.swingV.key as string]);
  }
  if (spec.swingH && s[spec.swingH.key as string] !== undefined) {
    out.swingH = swingToCanonical(spec.swingH, s[spec.swingH.key as string]);
  }

  // Features
  const features: Partial<Record<CanonicalFeature, FeatureValue>> = {};
  for (const f of spec.features) {
    const raw = s[f.key as string];
    if (raw === undefined) continue;
    switch (f.kind) {
      case "boolean":
        features[f.canonical] = !!raw;
        break;
      case "range": {
        if (f.enabledKey && !s[f.enabledKey as string]) continue;
        features[f.canonical] = f.unit === "minutes" ? { minutes: Number(raw) } : { level: Number(raw) };
        break;
      }
      case "enum": {
        const name = nameForValue(f.constants, Number(raw));
        const token = name !== undefined ? f.map[name] : undefined;
        if (token !== undefined) features[f.canonical] = { token };
        break;
      }
    }
  }
  if (Object.keys(features).length > 0) out.features = features;

  return out;
}

/**
 * Build a protocol state from a canonical description, ready for
 * {@link ./codec.js | encode}.
 *
 * The inverse of {@link toCanonical}. Only canonical fields that the protocol
 * supports are applied; anything else is ignored. Throws for raw/opaque
 * protocols. Values are passed through unclamped — the encoder remains the
 * source of truth for range/mode locks.
 */
export function fromCanonical<P extends ProtocolName>(protocol: P, canonical: CanonicalState): ProtocolStateMap[P] {
  const spec = CAPABILITIES[protocol] as CapabilitySpec<P> | undefined;
  if (!spec) throw new Error(`irtxrx: no canonical model for protocol "${protocol}"`);
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown): void => { if (value !== undefined) out[key] = value; };

  // Power
  if (canonical.power) {
    if (spec.power.kind === "stateful") {
      set("power", canonical.power.kind === "stateful" ? canonical.power.on : canonical.power.toggle);
    } else {
      set(spec.power.key as string, canonical.power.kind === "toggle" ? canonical.power.toggle : canonical.power.on);
    }
  }

  // Mode
  if (spec.modes && canonical.mode !== undefined) {
    for (const [name, token] of Object.entries(spec.modes.map)) {
      if (token === canonical.mode) { set("mode", spec.modes.constants[name]); break; }
    }
  }

  // Temp
  if (spec.temp && canonical.temp !== undefined) set("temp", canonical.temp);

  // Fan
  if (spec.fan && canonical.fan !== undefined) set("fan", fanFromCanonical(spec.fan, canonical.fan));

  // Swing
  if (spec.swingV && canonical.swingV) set(spec.swingV.key as string, swingFromCanonical(spec.swingV, canonical.swingV));
  if (spec.swingH && canonical.swingH) set(spec.swingH.key as string, swingFromCanonical(spec.swingH, canonical.swingH));

  // Features
  const features = canonical.features ?? {};
  for (const f of spec.features) {
    const v = features[f.canonical];
    switch (f.kind) {
      case "boolean":
        if (typeof v === "boolean") set(f.key as string, v);
        break;
      case "range": {
        if (v !== undefined && typeof v === "object") {
          const num = "minutes" in v ? v.minutes : "level" in v ? v.level : undefined;
          if (num !== undefined) {
            set(f.key as string, num);
            if (f.enabledKey) set(f.enabledKey as string, true);
          }
        } else if (f.enabledKey) {
          set(f.enabledKey as string, false);
        }
        break;
      }
      case "enum": {
        if (v !== undefined && typeof v === "object" && "token" in v) {
          set(f.key as string, valueForToken(f.constants, f.map, v.token));
        }
        break;
      }
    }
  }

  return out as ProtocolStateMap[P];
}
