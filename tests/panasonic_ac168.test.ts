import { describe, expect, it } from "bun:test";
import {
  buildPanasonicAc168Raw,
  sendPanasonicAc168,
  decodePanasonicAc168,
  encodePanasonicAc168Raw,
  PanasonicAc168Mode,
  PanasonicAc168Fan,
  PANASONIC_AC168_STATE_LENGTH,
} from "../src/protocols/panasonic_ac168";
import type { PanasonicAc168State } from "../src/protocols/panasonic_ac168";
import { decode } from "../src/decode";
import { PANASONIC_AC168_CAPTURES } from "./fixtures/panasonic-ac168-captures";

// A 21-byte two-section Panasonic variant with no IRremoteESP8266 reference
// (identify.cpp reports UNKNOWN). The 42 labelled captures are the ground truth.

const byId = (id: string) => PANASONIC_AC168_CAPTURES.find((c) => c.id === id)!;

describe("PanasonicAc168 decode — real captures", () => {
  it("decodes all 42 captures", () => {
    for (const c of PANASONIC_AC168_CAPTURES) {
      expect(decodePanasonicAc168(c.edges), c.id).not.toBeNull();
    }
  });

  it("rebuilds the exact frame bytes for each capture", () => {
    for (const c of PANASONIC_AC168_CAPTURES) {
      const st = decodePanasonicAc168(c.edges)!;
      expect(Array.from(buildPanasonicAc168Raw(st)), c.id).toEqual(c.bytes);
    }
  });

  it("is recognised by the blind decode() dispatcher", () => {
    const r = decode(byId("power_on").edges);
    expect(r).not.toBeNull();
    expect(r!.protocol).toBe("panasonic_ac168");
    expect(r!.brand).toBe("panasonic");
  });
});

describe("PanasonicAc168 field mapping", () => {
  it("maps power", () => {
    expect(decodePanasonicAc168(byId("power_off").edges)!.power).toBe(false);
    expect(decodePanasonicAc168(byId("power_on").edges)!.power).toBe(true);
  });

  it("maps every temperature in the 16-30 sweep", () => {
    for (const c of PANASONIC_AC168_CAPTURES) {
      const m = /^temp_(\d+)(_r2)?$/.exec(c.id);
      if (!m) continue;
      expect(decodePanasonicAc168(c.edges)!.temp, c.id).toBe(Number(m[1]));
    }
  });

  it("maps modes", () => {
    expect(decodePanasonicAc168(byId("mode_cool").edges)!.mode).toBe(PanasonicAc168Mode.Cool);
    expect(decodePanasonicAc168(byId("mode_dry").edges)!.mode).toBe(PanasonicAc168Mode.Dry);
    expect(decodePanasonicAc168(byId("mode_fan").edges)!.mode).toBe(PanasonicAc168Mode.Fan);
  });

  it("maps fan speeds", () => {
    expect(decodePanasonicAc168(byId("fan_auto").edges)!.fan).toBe(PanasonicAc168Fan.Auto);
    expect(decodePanasonicAc168(byId("fan_low").edges)!.fan).toBe(PanasonicAc168Fan.Low);
    expect(decodePanasonicAc168(byId("fan_medium").edges)!.fan).toBe(PanasonicAc168Fan.Medium);
    expect(decodePanasonicAc168(byId("fan_high").edges)!.fan).toBe(PanasonicAc168Fan.High);
  });

  it("maps swing and powerful", () => {
    expect(decodePanasonicAc168(byId("swing_on").edges)!.swing).toBe(true);
    expect(decodePanasonicAc168(byId("swing_off").edges)!.swing).toBe(false);
    expect(decodePanasonicAc168(byId("extra_powerful").edges)!.powerful).toBe(true);
  });
});

describe("PanasonicAc168 encode / roundtrip", () => {
  it("re-decodes to the identical state for every capture (lossless)", () => {
    for (const c of PANASONIC_AC168_CAPTURES) {
      const st = decodePanasonicAc168(c.edges)!;
      expect(decodePanasonicAc168(sendPanasonicAc168(st)), c.id).toEqual(st);
    }
  });

  it("emits encoded timings that match the source capture within tolerance", () => {
    const c = byId("power_on");
    const enc = sendPanasonicAc168(decodePanasonicAc168(c.edges)!);
    for (let i = 0; i < c.edges.length; i++) {
      const ratio = enc[i]! / c.edges[i]!;
      expect(ratio, `edge ${i}: enc=${enc[i]} cap=${c.edges[i]}`).toBeGreaterThan(0.7);
      expect(ratio).toBeLessThan(1.3);
    }
  });

  it("round-trips a fully-specified state", () => {
    const state: PanasonicAc168State = {
      power: true, mode: PanasonicAc168Mode.Dry, fan: PanasonicAc168Fan.High,
      temp: 28, swing: true, powerful: true,
    };
    expect(decodePanasonicAc168(sendPanasonicAc168(state))).toEqual(state);
  });

  it("clamps temperature to 16-30", () => {
    expect(decodePanasonicAc168(sendPanasonicAc168({ temp: 5 }))!.temp).toBe(16);
    expect(decodePanasonicAc168(sendPanasonicAc168({ temp: 99 }))!.temp).toBe(30);
  });
});

describe("PanasonicAc168 rejection", () => {
  it("rejects a frame with a corrupted checksum", () => {
    const raw = buildPanasonicAc168Raw({ power: true, temp: 24 });
    raw[PANASONIC_AC168_STATE_LENGTH - 1] = (raw[PANASONIC_AC168_STATE_LENGTH - 1]! ^ 0xff) & 0xff;
    expect(decodePanasonicAc168(encodePanasonicAc168Raw(raw))).toBeNull();
  });

  it("rejects a wrong section signature", () => {
    const raw = buildPanasonicAc168Raw({ power: true, temp: 24 });
    raw[0] = 0x99;
    raw[PANASONIC_AC168_STATE_LENGTH - 1] = raw.subarray(8, 20).reduce((a, b) => a + b, 0) & 0xff;
    expect(decodePanasonicAc168(encodePanasonicAc168Raw(raw))).toBeNull();
  });

  it("rejects noise", () => {
    expect(decodePanasonicAc168([])).toBeNull();
    expect(decodePanasonicAc168([100, 200, 300])).toBeNull();
    expect(decodePanasonicAc168(new Array(400).fill(430))).toBeNull();
  });
});
