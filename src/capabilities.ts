/**
 * Runtime capability registry.
 *
 * A single source of truth describing every protocol the unified {@link decode}
 * dispatcher supports: its brand, type, named operating modes and fan speeds
 * (with the integer values the encoders expect), temperature range, and swing
 * support. Consumers (UIs, gateways) can read this at runtime instead of
 * hard-coding protocol tables.
 *
 * Mode/fan/swing names and values are derived directly from each protocol's own
 * exported constant objects, so they cannot drift from the encoders. The set of
 * protocols here is kept in lock-step with the decode registry by a test
 * (see tests/capabilities.test.ts) that compares against {@link REGISTERED_PROTOCOLS}.
 */

import type { ProtocolName, BrandName, ProtocolType } from "./decode.js";

import { CoolixMode, CoolixFan } from "./protocols/coolix.js";
import { GreeMode, GreeFan, GreeSwingV, GreeSwingH } from "./protocols/gree.js";
import { KelonMode, KelonFan } from "./protocols/kelon.js";
import { Kelon168Mode, Kelon168Fan } from "./protocols/kelon168.js";
import { TecoMode, TecoFan } from "./protocols/teco.js";
import { MitsubishiAcMode, MitsubishiAcFan, MitsubishiAcVane, MitsubishiAcWideVane } from "./protocols/mitsubishi_ac.js";
import { Mitsubishi136Mode, Mitsubishi136Fan, Mitsubishi136SwingV } from "./protocols/mitsubishi136.js";
import { Mitsubishi112Mode, Mitsubishi112Fan, Mitsubishi112SwingV, Mitsubishi112SwingH } from "./protocols/mitsubishi112.js";
import { GodrejMode, GodrejFan } from "./protocols/godrej.js";
import { DaikinMode, DaikinFan } from "./protocols/daikin_common.js";
import { Daikin64Mode, Daikin64Fan } from "./protocols/daikin64.js";
import { Daikin128Mode, Daikin128Fan } from "./protocols/daikin128.js";
import { Daikin160SwingV } from "./protocols/daikin160.js";
import { Daikin176Mode, Daikin176SwingH } from "./protocols/daikin176.js";
import { VoltasMode, VoltasFan } from "./protocols/voltas.js";
import { HitachiAcMode, HitachiAcFan } from "./protocols/hitachi.js";
import { HitachiAc1Mode, HitachiAc1Fan } from "./protocols/hitachi1.js";
import { HitachiAc424Mode, HitachiAc424Fan } from "./protocols/hitachi424.js";
import { HitachiAc264Fan } from "./protocols/hitachi264.js";
import { HitachiAc344SwingH } from "./protocols/hitachi344.js";
import { HitachiAc296Mode, HitachiAc296Fan } from "./protocols/hitachi296.js";
import { Tcl112Mode, Tcl112Fan, Tcl112SwingV } from "./protocols/tcl112.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A human-readable option name paired with the integer value the encoder uses. */
export interface NamedValue {
  name: string;
  value: number;
}

/** Supported temperature range in °C. */
export interface TempRange {
  min: number;
  max: number;
  /** Resolution in °C (1 for whole degrees, 0.5 for half-degree protocols). */
  step: number;
}

/** Capability description for a single protocol. */
export interface ProtocolInfo {
  protocol: ProtocolName;
  brand: BrandName;
  type: ProtocolType;
  /** Named operating modes (omitted for raw/non-AC protocols). */
  modes?: NamedValue[];
  /** Named fan speeds (omitted where the protocol has no fan field). */
  fans?: NamedValue[];
  /** Some protocols also accept raw numeric fan speeds in this inclusive range. */
  fanSpeedRange?: { min: number; max: number };
  /** Supported temperature range, if the protocol carries a temperature. */
  temp?: TempRange;
  /** Whether the protocol's state can express vertical swing. */
  swingV?: boolean;
  /** Whether the protocol's state can express horizontal swing. */
  swingH?: boolean;
  /** Named vertical-swing positions, for protocols with positional swing. */
  swingVOptions?: NamedValue[];
  /** Named horizontal-swing positions, for protocols with positional swing. */
  swingHOptions?: NamedValue[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a `{ Name: value }` constant object into `{ name, value }[]`. */
function named(obj: Record<string, number>): NamedValue[] {
  return Object.entries(obj).map(([name, value]) => ({ name, value }));
}

type Caps = Omit<ProtocolInfo, "protocol" | "brand" | "type">;

function info(protocol: ProtocolName, brand: BrandName, type: ProtocolType, caps: Caps = {}): ProtocolInfo {
  return { protocol, brand, type, ...caps };
}

/** Daikin-family protocols also accept raw fan speeds 1–5 alongside Auto/Quiet. */
const DAIKIN_FAN_RANGE = { min: 1, max: 5 } as const;
const DAIKIN_TEMP = { min: 10, max: 32, step: 1 } as const;
const HITACHI_TEMP = { min: 16, max: 32, step: 1 } as const;

// ---------------------------------------------------------------------------
// Registry — order matches the decode dispatcher's priority order
// ---------------------------------------------------------------------------

export const PROTOCOLS: readonly ProtocolInfo[] = [
  info("coolix", "coolix", "ac", {
    modes: named(CoolixMode), fans: named(CoolixFan),
    temp: { min: 17, max: 30, step: 1 }, swingV: false, swingH: false,
  }),
  // Raw 48-bit code carrier — no structured appliance fields.
  info("coolix48", "coolix", "ac"),
  info("gree", "gree", "ac", {
    modes: named(GreeMode), fans: named(GreeFan),
    temp: { min: 16, max: 30, step: 1 },
    swingV: true, swingH: true,
    swingVOptions: named(GreeSwingV), swingHOptions: named(GreeSwingH),
  }),
  info("kelon168", "kelon", "ac", {
    modes: named(Kelon168Mode), fans: named(Kelon168Fan),
    temp: { min: 16, max: 31, step: 1 }, swingV: true, swingH: false,
  }),
  info("kelon", "kelon", "ac", {
    modes: named(KelonMode), fans: named(KelonFan),
    temp: { min: 18, max: 32, step: 1 }, swingV: false, swingH: false,
  }),
  info("teco", "teco", "ac", {
    modes: named(TecoMode), fans: named(TecoFan),
    temp: { min: 16, max: 30, step: 1 }, swingV: true, swingH: false,
  }),
  info("mitsubishi_ac", "mitsubishi", "ac", {
    modes: named(MitsubishiAcMode), fans: named(MitsubishiAcFan),
    temp: { min: 16, max: 31, step: 0.5 }, swingV: true, swingH: true,
    swingVOptions: named(MitsubishiAcVane), swingHOptions: named(MitsubishiAcWideVane),
  }),
  info("mitsubishi136", "mitsubishi", "ac", {
    modes: named(Mitsubishi136Mode), fans: named(Mitsubishi136Fan),
    temp: { min: 17, max: 30, step: 1 }, swingV: true, swingH: false,
    swingVOptions: named(Mitsubishi136SwingV),
  }),
  info("mitsubishi112", "mitsubishi", "ac", {
    modes: named(Mitsubishi112Mode), fans: named(Mitsubishi112Fan),
    temp: { min: 16, max: 31, step: 1 }, swingV: true, swingH: true,
    swingVOptions: named(Mitsubishi112SwingV), swingHOptions: named(Mitsubishi112SwingH),
  }),
  info("godrej", "godrej", "ac", {
    modes: named(GodrejMode), fans: named(GodrejFan),
    temp: { min: 16, max: 31, step: 1 }, swingV: true, swingH: false,
  }),
  info("daikin152", "daikin", "ac", {
    modes: named(DaikinMode), fans: named(DaikinFan), fanSpeedRange: DAIKIN_FAN_RANGE,
    temp: DAIKIN_TEMP, swingV: true, swingH: false,
  }),
  info("daikin216", "daikin", "ac", {
    modes: named(DaikinMode), fans: named(DaikinFan), fanSpeedRange: DAIKIN_FAN_RANGE,
    temp: DAIKIN_TEMP, swingV: true, swingH: true,
  }),
  info("daikin160", "daikin", "ac", {
    modes: named(DaikinMode), fans: named(DaikinFan), fanSpeedRange: DAIKIN_FAN_RANGE,
    temp: DAIKIN_TEMP, swingV: true, swingH: false, swingVOptions: named(Daikin160SwingV),
  }),
  info("daikin176", "daikin", "ac", {
    modes: named(Daikin176Mode), fans: named(DaikinFan), fanSpeedRange: DAIKIN_FAN_RANGE,
    temp: DAIKIN_TEMP, swingV: false, swingH: true, swingHOptions: named(Daikin176SwingH),
  }),
  info("daikin64", "daikin", "ac", {
    modes: named(Daikin64Mode), fans: named(Daikin64Fan),
    temp: { min: 16, max: 30, step: 1 }, swingV: true, swingH: false,
  }),
  info("daikin128", "daikin", "ac", {
    modes: named(Daikin128Mode), fans: named(Daikin128Fan),
    temp: { min: 16, max: 30, step: 1 }, swingV: true, swingH: false,
  }),
  info("daikin", "daikin", "ac", {
    modes: named(DaikinMode), fans: named(DaikinFan), fanSpeedRange: DAIKIN_FAN_RANGE,
    temp: { min: 10, max: 32, step: 0.5 }, swingV: true, swingH: true,
  }),
  info("daikin2", "daikin", "ac", {
    modes: named(DaikinMode), fans: named(DaikinFan), fanSpeedRange: DAIKIN_FAN_RANGE,
    temp: DAIKIN_TEMP, swingV: true, swingH: true,
  }),
  info("daikin312", "daikin", "ac", {
    modes: named(DaikinMode), fans: named(DaikinFan), fanSpeedRange: DAIKIN_FAN_RANGE,
    temp: { min: 10, max: 32, step: 0.5 }, swingV: true, swingH: true,
  }),
  info("voltas", "voltas", "ac", {
    modes: named(VoltasMode), fans: named(VoltasFan),
    temp: { min: 16, max: 30, step: 1 }, swingV: true, swingH: true,
  }),
  info("hitachi_ac", "hitachi", "ac", {
    modes: named(HitachiAcMode), fans: named(HitachiAcFan),
    temp: HITACHI_TEMP, swingV: true, swingH: true,
  }),
  info("hitachi_ac1", "hitachi", "ac", {
    modes: named(HitachiAc1Mode), fans: named(HitachiAc1Fan),
    temp: HITACHI_TEMP, swingV: true, swingH: true,
  }),
  info("hitachi_ac424", "hitachi", "ac", {
    modes: named(HitachiAc424Mode), fans: named(HitachiAc424Fan),
    temp: HITACHI_TEMP, swingV: true, swingH: false,
  }),
  info("hitachi_ac264", "hitachi", "ac", {
    modes: named(HitachiAc424Mode), fans: named(HitachiAc264Fan),
    temp: HITACHI_TEMP, swingV: true, swingH: false,
  }),
  info("hitachi_ac344", "hitachi", "ac", {
    modes: named(HitachiAc424Mode), fans: named(HitachiAc424Fan),
    temp: HITACHI_TEMP, swingV: true, swingH: true, swingHOptions: named(HitachiAc344SwingH),
  }),
  info("hitachi_ac296", "hitachi", "ac", {
    modes: named(HitachiAc296Mode), fans: named(HitachiAc296Fan),
    temp: { min: 16, max: 31, step: 1 }, swingV: false, swingH: false,
  }),
  // Raw byte-array protocol — no structured fields.
  info("hitachi_ac3", "hitachi", "ac"),
  info("tcl112", "tcl", "ac", {
    modes: named(Tcl112Mode), fans: named(Tcl112Fan),
    temp: { min: 16, max: 31, step: 0.5 },
    swingV: true, swingH: true, swingVOptions: named(Tcl112SwingV),
  }),
  // Raw byte-array protocol — no structured fields.
  info("tcl96", "tcl", "ac"),
  // Simple (non-AC) protocols.
  info("nec", "nec", "simple"),
  info("mitsubishi", "mitsubishi", "simple"),
  info("mitsubishi2", "mitsubishi", "simple"),
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const BY_PROTOCOL = new Map<ProtocolName, ProtocolInfo>(PROTOCOLS.map((p) => [p.protocol, p]));

/** Look up the capability info for a protocol, or undefined if unknown. */
export function getProtocolInfo(protocol: ProtocolName): ProtocolInfo | undefined {
  return BY_PROTOCOL.get(protocol);
}

/**
 * All protocols for a given brand (e.g. every Coolix, Daikin, or Hitachi
 * variant). Returns an empty array for an unknown brand.
 */
export function getProtocolsForBrand(brand: string): ProtocolInfo[] {
  return PROTOCOLS.filter((p) => p.brand === brand);
}

/** Distinct brands present in the registry. */
export function listBrands(): BrandName[] {
  return [...new Set(PROTOCOLS.map((p) => p.brand))];
}
