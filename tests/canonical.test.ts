import { describe, expect, it } from "bun:test";
import {
  CAPABILITIES,
  toCanonical,
  fromCanonical,
  getCanonicalCapabilities,
  labelFor,
  LABELS,
} from "../src/canonical";
import type { CanonicalState, CanonicalFanValue, SwingValue, FeatureValue } from "../src/canonical";
import { encode } from "../src/codec";
import { decode, REGISTERED_PROTOCOLS } from "../src/decode";
import type { ProtocolName } from "../src/decode";

// Protocols with no structured state — deliberately absent from CAPABILITIES.
const RAW_PROTOCOLS: ProtocolName[] = ["coolix48", "hitachi_ac3", "tcl96", "nec", "mitsubishi", "mitsubishi2", "panasonic", "samsung", "samsung36", "lg", "carrier_ac", "carrier_ac40", "carrier_ac84", "carrier_ac128", "sharp", "sanyo_lc7461", "sanyo_ac152", "bluestar_heavy", "goodweather", "transcold"];

const MAPPED = Object.keys(CAPABILITIES) as ProtocolName[];

// ---------------------------------------------------------------------------
// Synthesis: build a rich canonical state that touches every spec field, so a
// round-trip exercises the whole mapping.
// ---------------------------------------------------------------------------

function stepFloor(value: number, step: number, min: number): number {
  return min + Math.floor((value - min) / step) * step;
}

function repRange(f: { min: number; max: number; step?: number }): number {
  const step = f.step ?? 1;
  return stepFloor((f.min + f.max) / 2, step, f.min);
}

function firstTokenValue(map: Record<string, string>): string {
  return Object.values(map)[0]!;
}

function synthCanonical(spec: any): CanonicalState {
  const c: CanonicalState = {};
  c.power = spec.power.kind === "stateful" ? { kind: "stateful", on: true } : { kind: "toggle", toggle: true };

  if (spec.modes) {
    const tokens = Object.values(spec.modes.map) as string[];
    c.mode = (tokens.includes("cool") ? "cool" : tokens[0]) as CanonicalState["mode"];
  }
  if (spec.temp) c.temp = spec.temp.min;
  if (spec.fan) {
    if (spec.fan.map) c.fan = firstTokenValue(spec.fan.map) as CanonicalFanValue;
    else if (spec.fan.numericRange) c.fan = { numeric: spec.fan.numericRange.min };
  }
  const pickSwing = (s: any): SwingValue => {
    switch (s.kind) {
      case "bool": return { kind: "bool", on: true };
      case "toggle": return { kind: "toggle", toggle: true };
      case "numeric": return { kind: "numeric", value: s.min };
      case "position": return { kind: "position", position: firstTokenValue(s.positions.map) as any };
    }
    return { kind: "bool", on: true };
  };
  if (spec.swingV) c.swingV = pickSwing(spec.swingV);
  if (spec.swingH) c.swingH = pickSwing(spec.swingH);

  const features: Record<string, FeatureValue> = {};
  for (const f of spec.features) {
    if (f.kind === "boolean") features[f.canonical] = true;
    else if (f.kind === "range") features[f.canonical] = f.unit === "minutes" ? { minutes: repRange(f) } : { level: repRange(f) };
    else if (f.kind === "enum") features[f.canonical] = { token: firstTokenValue(f.map) };
  }
  c.features = features as CanonicalState["features"];
  return c;
}

// ---------------------------------------------------------------------------

describe("canonical capability model", () => {
  it("covers exactly the structured protocols (no drift vs decode registry)", () => {
    const registered = new Set(REGISTERED_PROTOCOLS);
    // Every mapped protocol is a registered protocol.
    for (const p of MAPPED) expect(registered.has(p)).toBe(true);
    // Every registered protocol is either mapped or a known raw protocol.
    for (const p of registered) {
      const isRaw = RAW_PROTOCOLS.includes(p);
      expect(CAPABILITIES[p] !== undefined || isRaw).toBe(true);
    }
    // Raw protocols are deliberately absent.
    for (const p of RAW_PROTOCOLS) expect(CAPABILITIES[p]).toBeUndefined();
    // Together they account for everything.
    expect(MAPPED.length + RAW_PROTOCOLS.length).toBe(registered.size);
  });

  it("round-trips every mode value bijectively", () => {
    for (const p of MAPPED) {
      const spec = CAPABILITIES[p] as any;
      if (!spec.modes) continue;
      for (const [, value] of Object.entries(spec.modes.constants) as [string, number][]) {
        const canon = toCanonical(p, { mode: value } as any);
        expect(canon.mode, `${p} mode ${value} should map to a canonical token`).toBeDefined();
        const back = fromCanonical(p, canon) as any;
        expect(back.mode, `${p} mode ${value} should round-trip`).toBe(value);
      }
    }
  });

  it("round-trips every fan value (named token or numeric fallback)", () => {
    for (const p of MAPPED) {
      const spec = CAPABILITIES[p] as any;
      if (!spec.fan) continue;
      const values = spec.fan.constants
        ? (Object.values(spec.fan.constants) as number[])
        : spec.fan.numericRange
          ? [spec.fan.numericRange.min, spec.fan.numericRange.max]
          : [];
      for (const value of values) {
        const canon = toCanonical(p, { fan: value } as any);
        expect(canon.fan, `${p} fan ${value} should map`).toBeDefined();
        const back = fromCanonical(p, canon) as any;
        expect(back.fan, `${p} fan ${value} should round-trip`).toBe(value);
      }
    }
  });

  it("losslessly round-trips a decoded state through the canonical layer", () => {
    for (const p of MAPPED) {
      const spec = CAPABILITIES[p] as any;
      const seed = fromCanonical(p, synthCanonical(spec));
      const timings = encode(p as any, seed as any);
      const decoded = decode(timings, { protocol: p });
      expect(decoded, `${p}: synthesized frame should decode`).not.toBeNull();
      expect(decoded!.protocol).toBe(p);

      const decodedState = (decoded as any).state;
      expect(decodedState, `${p}: decoded state should be structured`).not.toBeNull();

      // Baseline: re-encode the decoded state directly.
      const baseline = encode(p as any, decodedState);
      // Through the canonical layer: decode → canonical → protocol state → encode.
      const viaCanonical = fromCanonical(p, toCanonical(p, decodedState));
      const roundTripped = encode(p as any, viaCanonical);

      expect(roundTripped, `${p}: canonical round-trip must reproduce the wire`).toEqual(baseline);
    }
  });

  it("models power semantics (stateful vs toggle)", () => {
    // Stateful protocol carries absolute power.
    const gree = toCanonical("gree", { power: true } as any);
    expect(gree.power).toEqual({ kind: "stateful", on: true });
    // Kelon has no absolute power — only a toggle.
    const kelon = toCanonical("kelon", { powerToggle: true } as any);
    expect(kelon.power).toEqual({ kind: "toggle", toggle: true });
    expect((fromCanonical("kelon", kelon) as any).powerToggle).toBe(true);
  });

  it("exposes extra features that the legacy registry omitted", () => {
    const gree = toCanonical("gree", { turbo: true, sleep: true, light: false } as any);
    expect(gree.features?.turbo).toBe(true);
    expect(gree.features?.sleep).toBe(true);
    expect(gree.features?.light).toBe(false);
    // Synonym consolidation: Daikin `powerful` → canonical `turbo`, `mold` → `xfan`.
    const daikin = toCanonical("daikin", { powerful: true, mold: true } as any);
    expect(daikin.features?.turbo).toBe(true);
    expect(daikin.features?.xfan).toBe(true);
  });

  it("normalizes timers to minutes and gates them on the enabled flag", () => {
    const on = toCanonical("daikin64", { onTimerEnabled: true, onTime: 600 } as any);
    expect(on.features?.timer_on).toEqual({ minutes: 600 });
    const off = toCanonical("daikin64", { onTimerEnabled: false, onTime: 600 } as any);
    expect(off.features?.timer_on).toBeUndefined();
  });

  it("provides human-readable labels with a sensible fallback", () => {
    expect(labelFor("cool")).toBe("Cool");
    expect(labelFor("econo")).toBe("Economy");
    expect(LABELS["turbo"]).toBe("Turbo");
    expect(labelFor("not_a_real_token")).toBe("not_a_real_token");
  });

  it("getCanonicalCapabilities returns undefined for raw/unknown protocols", () => {
    expect(getCanonicalCapabilities("gree")).toBeDefined();
    expect(getCanonicalCapabilities("nec")).toBeUndefined();
    expect(getCanonicalCapabilities("coolix48")).toBeUndefined();
  });

  it("throws when translating a protocol with no canonical model", () => {
    expect(() => toCanonical("nec" as any, {} as any)).toThrow(/no canonical model/);
    expect(() => fromCanonical("tcl96" as any, {})).toThrow(/no canonical model/);
  });
});
