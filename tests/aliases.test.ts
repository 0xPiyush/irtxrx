import { describe, expect, it } from "bun:test";
import { decode, BRAND_ALIASES, resolveBrand } from "../src/decode";
import { getProtocolsForBrand } from "../src/capabilities";
import { sendCoolix, CoolixMode } from "../src/protocols/coolix";
import { sendTcl112, Tcl112Mode } from "../src/protocols/tcl112";

describe("brand aliases", () => {
  it("resolveBrand maps aliases and is identity otherwise", () => {
    expect(resolveBrand("croma")).toBe("coolix");
    expect(resolveBrand("godrej")).toBe("tcl");
    expect(resolveBrand("coolix")).toBe("coolix"); // canonical → unchanged
    expect(resolveBrand("samsung")).toBe("samsung"); // unknown → unchanged
  });

  it("exposes the alias table", () => {
    expect(BRAND_ALIASES).toEqual({ croma: "coolix", godrej: "tcl" });
  });

  it("decode honours an alias brand hint", () => {
    const timings = sendCoolix({ temp: 22, mode: CoolixMode.Cool });
    const viaAlias = decode(timings, { brand: "croma" });
    const viaCanonical = decode(timings, { brand: "coolix" });
    expect(viaAlias).not.toBeNull();
    expect(viaAlias).toEqual(viaCanonical);
    // The result still reports the canonical brand, never the alias.
    expect(viaAlias!.brand).toBe("coolix");
  });

  it("godrej hint routes to the TCL decoder", () => {
    const timings = sendTcl112({ temp: 24, mode: Tcl112Mode.Cool });
    const decoded = decode(timings, { brand: "godrej" });
    expect(decoded).not.toBeNull();
    expect(decoded!.protocol).toBe("tcl112");
    expect(decoded!.brand).toBe("tcl");
  });

  it("an alias pointing elsewhere yields no match (graceful, not bad data)", () => {
    const coolixTimings = sendCoolix({ temp: 22, mode: CoolixMode.Cool });
    // "godrej" → tcl, which won't match a Coolix frame.
    expect(decode(coolixTimings, { brand: "godrej" })).toBeNull();
  });

  it("an unknown brand matches nothing", () => {
    const timings = sendCoolix({ temp: 22, mode: CoolixMode.Cool });
    expect(decode(timings, { brand: "samsung" })).toBeNull();
  });

  it("getProtocolsForBrand resolves aliases", () => {
    expect(getProtocolsForBrand("croma").map((p) => p.protocol)).toEqual(["coolix"]);
    expect(getProtocolsForBrand("godrej").map((p) => p.protocol)).toEqual(["tcl112", "tcl96"]);
    expect(getProtocolsForBrand("samsung")).toEqual([]); // unknown → empty
  });
});
