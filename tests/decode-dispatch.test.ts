/**
 * Tests for the unified decode() dispatcher and its 3-tier strategy.
 */
import { describe, expect, it } from "bun:test";
import { decode } from "../src/decode";
import { sendDaikin152, buildDaikin152Raw, DaikinMode, DaikinFan } from "../src/protocols/daikin152";
import { sendDaikin216, buildDaikin216Raw } from "../src/protocols/daikin216";
import { sendDaikinESP, buildDaikinESPRaw } from "../src/protocols/daikin";
import { sendCoolix, encodeCoolixRaw, buildCoolixRaw, CoolixMode, CoolixFan, CoolixCommand } from "../src/protocols/coolix";
import { sendNEC, encodeNEC } from "../src/protocols/nec";

// ---------------------------------------------------------------------------
// Tier 1: header present at offset 0
// ---------------------------------------------------------------------------

describe("decode tier 1 — header at offset 0", () => {
  it("identifies Coolix from ideal timings", () => {
    const timings = sendCoolix({ temp: 24, mode: CoolixMode.Cool, fan: CoolixFan.Auto });
    const result = decode(timings);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("coolix");
    expect(result!.state).not.toBeNull();
    expect(result!.state!.temp).toBe(24);
  });

  it("identifies Daikin152 from ideal timings", () => {
    const state = { power: true, temp: 26, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: true, quiet: false, powerful: false, econo: false, sensor: false, comfort: false };
    const timings = sendDaikin152(state);
    const result = decode(timings);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("daikin152");
  });

  it("identifies Daikin216", () => {
    const timings = sendDaikin216({ power: true, temp: 25, mode: DaikinMode.Cool, fan: DaikinFan.Auto });
    const result = decode(timings);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("daikin216");
  });

  it("identifies DaikinESP", () => {
    const timings = sendDaikinESP({ power: true, temp: 24, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: false, swingHorizontal: false, quiet: false, powerful: false, econo: false, mold: false, comfort: false, sensor: false });
    const result = decode(timings);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("daikin");
  });

  it("identifies NEC", () => {
    const timings = sendNEC(encodeNEC(1, 2));
    const result = decode(timings);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("nec");
    expect(result!.state.address).toBe(1);
    expect(result!.state.command).toBe(2);
  });

  it("identifies Coolix command codes", () => {
    const timings = encodeCoolixRaw(CoolixCommand.Off, 0);
    const result = decode(timings);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("coolix");
    expect(result!.state).toBeNull();
    expect((result as any).raw).toBe(CoolixCommand.Off);
  });
});

// ---------------------------------------------------------------------------
// Tier 2: find repeat frame after gap
// ---------------------------------------------------------------------------

describe("decode tier 2 — repeat frame after gap", () => {
  it("finds Coolix in real-world capture with missing first header", () => {
    // Real capture: 197 entries, first header missing, repeat header at offset 98
    const capture = [549, 1617, 549, 549, 549, 1647, 518, 1647, 518, 579, 518, 549, 549, 1647, 518, 579, 518, 549, 549, 1647, 518, 579, 518, 549, 549, 1647, 518, 1647, 518, 579, 518, 1647, 549, 1647, 518, 549, 549, 1647, 518, 1647, 549, 1617, 549, 1647, 518, 1647, 518, 1647, 549, 549, 549, 1617, 549, 549, 549, 549, 518, 579, 518, 701, 457, 488, 549, 549, 518, 579, 518, 1647, 549, 549, 518, 579, 518, 549, 549, 549, 549, 549, 518, 579, 518, 1647, 549, 549, 518, 1647, 549, 1647, 518, 1647, 518, 1647, 549, 1647, 518, 1647, 518, 5249, 4394, 4364, 549, 1647, 518, 549, 549, 1647, 518, 1647, 518, 579, 518, 579, 518, 1647, 518, 579, 518, 579, 518, 1647, 518, 579, 518, 549, 549, 1647, 518, 1647, 518, 579, 518, 1647, 549, 1647, 518, 549, 549, 1647, 518, 1647, 549, 1617, 549, 1647, 518, 1647, 518, 1647, 549, 549, 549, 1647, 518, 549, 549, 549, 518, 579, 518, 579, 488, 579, 518, 579, 518, 579, 488, 1708, 488, 610, 488, 701, 488, 488, 488, 610, 488, 610, 488, 610, 457, 1708, 488, 610, 488, 1678, 488, 1708, 457, 1708, 488, 1678, 488, 1678, 488, 1708, 488];

    const result = decode(capture);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("coolix");
    expect(result!.state).not.toBeNull();
    expect(result!.state!.temp).toBe(24);
    expect(result!.state!.mode).toBe(CoolixMode.Cool);
  });

  it("finds Daikin152 in simulated capture with missing first header", () => {
    const state = { power: true, temp: 22, mode: DaikinMode.Heat, fan: 3 as const, swingVertical: false, quiet: false, powerful: false, econo: false, sensor: false, comfort: false };
    const timings = sendDaikin152(state);
    // Simulate missing first header by stripping the leader + first section header
    // Leader = 12 entries, section header = 2 entries → strip first 14
    const noHeader = timings.slice(14);
    const result = decode(noHeader);
    // Should find the repeat frame (if present) or fall through to tier 3
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("daikin152");
  });
});

// ---------------------------------------------------------------------------
// Tier 3: brute force, header optional
// ---------------------------------------------------------------------------

describe("decode tier 3 — header optional brute force", () => {
  it("decodes Coolix without header and without repeat", () => {
    // Single frame, header stripped
    const timings = encodeCoolixRaw(buildCoolixRaw({ temp: 28, mode: CoolixMode.Heat, fan: CoolixFan.Max }), 0);
    const noHeader = timings.slice(2); // Strip header mark + space
    const result = decode(noHeader);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("coolix");
    expect(result!.state!.temp).toBe(28);
  });
});

// ---------------------------------------------------------------------------
// Hint filtering
// ---------------------------------------------------------------------------

describe("decode with hints", () => {
  it("protocol hint narrows to specific protocol", () => {
    const timings = sendCoolix({ temp: 24, mode: CoolixMode.Cool, fan: CoolixFan.Auto });
    const result = decode(timings, { protocol: "coolix" });
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("coolix");
  });

  it("wrong protocol hint returns null", () => {
    const timings = sendCoolix({ temp: 24, mode: CoolixMode.Cool, fan: CoolixFan.Auto });
    expect(decode(timings, { protocol: "nec" })).toBeNull();
  });

  it("brand hint filters correctly", () => {
    const timings = sendDaikin152({ power: true, temp: 24, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: false, quiet: false, powerful: false, econo: false, sensor: false, comfort: false });
    const result = decode(timings, { brand: "daikin" });
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("daikin");
  });

  it("wrong brand hint returns null", () => {
    const timings = sendCoolix({ temp: 24, mode: CoolixMode.Cool, fan: CoolixFan.Auto });
    expect(decode(timings, { brand: "daikin" })).toBeNull();
  });

  it("type hint filters correctly", () => {
    const timings = sendNEC(encodeNEC(1, 2));
    const result = decode(timings, { type: "simple" });
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("nec");
  });

  it("type=ac excludes NEC", () => {
    const timings = sendNEC(encodeNEC(1, 2));
    expect(decode(timings, { type: "ac" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

describe("decode rejection", () => {
  it("returns null for empty timings", () => {
    expect(decode([])).toBeNull();
  });

  it("returns null for garbage", () => {
    const garbage = Array.from({ length: 200 }, () => Math.floor(Math.random() * 100));
    expect(decode(garbage)).toBeNull();
  });

  it("returns null for too-short timings", () => {
    expect(decode([1, 2, 3])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Roundtrip through dispatcher
// ---------------------------------------------------------------------------

describe("decode roundtrip through dispatcher", () => {
  it("Coolix roundtrips", () => {
    const state = { temp: 22, mode: CoolixMode.Dry, fan: CoolixFan.Med };
    const timings = sendCoolix(state);
    const result = decode(timings);
    expect(result).not.toBeNull();
    expect(buildCoolixRaw(result!.state!)).toBe(buildCoolixRaw(state));
  });

  it("Daikin152 roundtrips", () => {
    const state = { power: true, temp: 24, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: true, quiet: false, powerful: false, econo: false, sensor: false, comfort: false };
    const timings = sendDaikin152(state);
    const result = decode(timings);
    expect(result).not.toBeNull();
    expect(Array.from(buildDaikin152Raw(result!.state))).toEqual(Array.from(buildDaikin152Raw(state)));
  });
});
