import { describe, expect, it } from "bun:test";
import {
  PROTOCOLS,
  getProtocolInfo,
  getProtocolsForBrand,
  listBrands,
} from "../src/capabilities";
import { REGISTERED_PROTOCOLS } from "../src/decode";
import { CoolixMode, CoolixFan } from "../src/protocols/coolix";
import { Tcl112Mode } from "../src/protocols/tcl112";

describe("capabilities registry", () => {
  it("covers exactly the auto-detect registry (no drift)", () => {
    const caps = new Set(PROTOCOLS.map((p) => p.protocol));
    const registered = new Set(REGISTERED_PROTOCOLS);
    // Every registered protocol has capability info…
    for (const p of registered) expect(caps.has(p)).toBe(true);
    // …and every capability entry is a registered protocol.
    for (const p of caps) expect(registered.has(p)).toBe(true);
    expect(caps.size).toBe(registered.size);
  });

  it("has unique protocol names", () => {
    expect(new Set(PROTOCOLS.map((p) => p.protocol)).size).toBe(PROTOCOLS.length);
  });

  it("derives mode/fan names+values straight from the protocol constants", () => {
    const coolix = getProtocolInfo("coolix")!;
    expect(coolix.modes).toEqual(
      Object.entries(CoolixMode).map(([name, value]) => ({ name, value })),
    );
    expect(coolix.fans).toEqual(
      Object.entries(CoolixFan).map(([name, value]) => ({ name, value })),
    );
    // Spot-check a known value mapping.
    expect(coolix.modes!.find((m) => m.name === "Cool")!.value).toBe(CoolixMode.Cool);
  });

  it("reports half-degree temperature resolution where applicable", () => {
    expect(getProtocolInfo("tcl112")!.temp).toEqual({ min: 16, max: 31, step: 0.5 });
    expect(getProtocolInfo("daikin")!.temp!.step).toBe(0.5);
    expect(getProtocolInfo("coolix")!.temp!.step).toBe(1);
    // tcl112 exposes its mode set too.
    expect(getProtocolInfo("tcl112")!.modes!.length).toBe(Object.keys(Tcl112Mode).length);
  });

  it("expresses the Daikin raw fan-speed range", () => {
    expect(getProtocolInfo("daikin152")!.fanSpeedRange).toEqual({ min: 1, max: 5 });
    expect(getProtocolInfo("coolix")!.fanSpeedRange).toBeUndefined();
  });

  it("exposes positional swing options where the protocol has them", () => {
    expect(getProtocolInfo("daikin160")!.swingVOptions!.length).toBeGreaterThan(1);
    expect(getProtocolInfo("hitachi_ac344")!.swingHOptions!.length).toBeGreaterThan(1);
    // Boolean-swing protocols don't carry an options list.
    expect(getProtocolInfo("daikin216")!.swingVOptions).toBeUndefined();
  });

  it("omits structured fields for raw / non-AC protocols", () => {
    for (const name of ["hitachi_ac3", "tcl96", "nec"] as const) {
      const p = getProtocolInfo(name)!;
      expect(p.modes).toBeUndefined();
      expect(p.fans).toBeUndefined();
      expect(p.temp).toBeUndefined();
    }
    expect(getProtocolInfo("nec")!.type).toBe("simple");
  });

  it("supports brand grouping", () => {
    const daikin = getProtocolsForBrand("daikin");
    expect(daikin.length).toBe(9);
    expect(daikin.every((p) => p.brand === "daikin")).toBe(true);
    expect(getProtocolsForBrand("hitachi").length).toBe(7); // AC2 is not auto-registered
    expect(getProtocolsForBrand("coolix").map((p) => p.protocol)).toEqual(["coolix", "coolix48"]);
    expect(getProtocolsForBrand("gree").map((p) => p.protocol)).toEqual(["gree"]);
    expect(getProtocolsForBrand("kelon").map((p) => p.protocol)).toEqual(["kelon168", "kelon"]);
    expect(getProtocolsForBrand("teco").map((p) => p.protocol)).toEqual(["teco"]);
    expect(getProtocolsForBrand("mitsubishi").map((p) => p.protocol)).toEqual(
      ["mitsubishi_ac", "mitsubishi136", "mitsubishi112", "mitsubishi", "mitsubishi2"],
    );
    expect(getProtocolsForBrand("godrej").map((p) => p.protocol)).toEqual(["godrej"]);
    expect(getProtocolsForBrand("teknopoint").map((p) => p.protocol)).toEqual(["teknopoint"]);
    expect(getProtocolsForBrand("panasonic").map((p) => p.protocol)).toEqual(["panasonic", "panasonic_ac", "panasonic_ac32"]);
    expect(getProtocolsForBrand("samsung").map((p) => p.protocol)).toEqual(["samsung_ac", "samsung", "samsung36"]);
    expect(getProtocolsForBrand("lg").map((p) => p.protocol)).toEqual(["lg_ac", "lg"]);
    expect(getProtocolsForBrand("carrier").map((p) => p.protocol)).toEqual(["carrier_ac64", "carrier_ac", "carrier_ac40", "carrier_ac84", "carrier_ac128"]);
    expect(getProtocolsForBrand("haier").map((p) => p.protocol)).toEqual(["haier_ac", "haier_ac_yrw02", "haier_ac160", "haier_ac176"]);
    expect(getProtocolsForBrand("toshiba").map((p) => p.protocol)).toEqual(["toshiba_ac"]);
    expect(getProtocolsForBrand("sharp").map((p) => p.protocol)).toEqual(["sharp_ac", "sharp"]);
    expect(getProtocolsForBrand("sanyo").map((p) => p.protocol)).toEqual(["sanyo_ac", "sanyo_ac88", "sanyo_lc7461", "sanyo_ac152"]);
    expect(getProtocolsForBrand("whirlpool").map((p) => p.protocol)).toEqual(["whirlpool_ac"]);
    expect(getProtocolsForBrand("mitsubishi_heavy").map((p) => p.protocol)).toEqual(["mitsubishi_heavy152", "mitsubishi_heavy88"]);
    expect(getProtocolsForBrand("bluestar").map((p) => p.protocol)).toEqual(["bluestar_heavy"]);
    expect(getProtocolsForBrand("sony")).toEqual([]); // unknown brand → empty
    expect(listBrands().sort()).toEqual(["bluestar", "carrier", "coolix", "daikin", "godrej", "gree", "haier", "hitachi", "kelon", "lg", "mitsubishi", "mitsubishi_heavy", "nec", "panasonic", "samsung", "sanyo", "sharp", "tcl", "teco", "teknopoint", "toshiba", "voltas", "whirlpool"]);
  });

  it("getProtocolInfo returns undefined for unknown protocols", () => {
    // @ts-expect-error — exercising the runtime guard with an invalid name.
    expect(getProtocolInfo("not_a_protocol")).toBeUndefined();
  });
});
