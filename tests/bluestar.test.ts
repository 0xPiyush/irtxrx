import { describe, expect, it } from "bun:test";
import {
  buildBluestarRaw,
  sendBluestar,
  decodeBluestar,
  encodeBluestarRaw,
  BluestarMode,
  BluestarFan,
  BLUESTAR_STATE_LENGTH,
} from "../src/protocols/bluestar";
import type { BluestarState } from "../src/protocols/bluestar";
import { decode } from "../src/decode";
import { BLUESTAR_CAPTURES } from "./fixtures/bluestar-captures";

// There is no IRremoteESP8266 reference for this Bluestar variant (identify.cpp
// reports UNKNOWN), so the 47 labelled hardware captures are the ground truth.

const byId = (id: string) => BLUESTAR_CAPTURES.find((c) => c.id === id)!;

function sum(bytes: number[]): number {
  return bytes.reduce((a, b) => a + b, 0) & 0xff;
}

describe("Bluestar decode — real captures", () => {
  it("decodes all 47 captures with a valid checksum", () => {
    for (const c of BLUESTAR_CAPTURES) {
      const st = decodeBluestar(c.edges);
      expect(st, `${c.id} should decode`).not.toBeNull();
      // The whole-frame one's-complement checksum must hold.
      expect(sum(c.bytes), `${c.id} checksum`).toBe(0xff);
    }
  });

  it("extracts the expected frame bytes for each capture", () => {
    for (const c of BLUESTAR_CAPTURES) {
      const st = decodeBluestar(c.edges)!;
      const raw = Array.from(buildBluestarRaw(st));
      // buildBluestarRaw reconstructs bytes 0-8; byte 9 is the checksum.
      expect(raw, `${c.id} rebuilt frame`).toEqual(c.bytes);
    }
  });

  it("is recognised by the blind decode() dispatcher", () => {
    const r = decode(byId("power_on").edges);
    expect(r).not.toBeNull();
    expect(r!.protocol).toBe("bluestar");
  });
});

describe("Bluestar field mapping", () => {
  it("maps power", () => {
    expect(decodeBluestar(byId("power_off").edges)!.power).toBe(false);
    expect(decodeBluestar(byId("power_on").edges)!.power).toBe(true);
  });

  it("maps every temperature in the 16-30 sweep", () => {
    for (const c of BLUESTAR_CAPTURES) {
      const m = /^temp_(\d+)(_r2)?$/.exec(c.id);
      if (!m) continue;
      expect(decodeBluestar(c.edges)!.temp, c.id).toBe(Number(m[1]));
    }
  });

  it("maps modes", () => {
    expect(decodeBluestar(byId("mode_cool").edges)!.mode).toBe(BluestarMode.Cool);
    expect(decodeBluestar(byId("mode_dry").edges)!.mode).toBe(BluestarMode.Dry);
    expect(decodeBluestar(byId("mode_fan").edges)!.mode).toBe(BluestarMode.Fan);
    expect(decodeBluestar(byId("mode_auto").edges)!.mode).toBe(BluestarMode.Auto);
  });

  it("maps fan speeds", () => {
    expect(decodeBluestar(byId("fan_auto").edges)!.fan).toBe(BluestarFan.Auto);
    expect(decodeBluestar(byId("fan_low").edges)!.fan).toBe(BluestarFan.Low);
    expect(decodeBluestar(byId("fan_medium").edges)!.fan).toBe(BluestarFan.Medium);
    expect(decodeBluestar(byId("fan_high").edges)!.fan).toBe(BluestarFan.High);
  });

  it("maps swing and feature toggles", () => {
    expect(decodeBluestar(byId("swing_on").edges)!.swing).toBe(true);
    expect(decodeBluestar(byId("swing_off").edges)!.swing).toBe(false);
    expect(decodeBluestar(byId("extra_turbo").edges)!.turbo).toBe(true);
    expect(decodeBluestar(byId("extra_sleep").edges)!.sleep).toBe(true);
    expect(decodeBluestar(byId("extra_light").edges)!.light).toBe(true);
    expect(decodeBluestar(byId("extra_timer").edges)!.timer).toBe(true);
  });

  it("preserves the 11-bit trailer command code", () => {
    // The trailer round-trips even though it does not map 1:1 to a button.
    for (const c of BLUESTAR_CAPTURES.slice(0, 10)) {
      const st = decodeBluestar(c.edges)!;
      const reDecoded = decodeBluestar(sendBluestar(st))!;
      expect(reDecoded.commandCode, c.id).toBe(st.commandCode);
    }
  });
});

describe("Bluestar encode / roundtrip", () => {
  it("re-decodes to the identical state for every capture (lossless)", () => {
    for (const c of BLUESTAR_CAPTURES) {
      const st = decodeBluestar(c.edges)!;
      const reDecoded = decodeBluestar(sendBluestar(st))!;
      expect(reDecoded, c.id).toEqual(st);
    }
  });

  it("produces a headerless 186-edge frame (main + trailer + gap)", () => {
    const timings = sendBluestar({ power: true, mode: BluestarMode.Cool, temp: 24 });
    // 160 data + footer mark + section gap (162) then 22 trailer + mark + gap (24).
    expect(timings.length).toBe(186);
  });

  it("emits encoded timings that match the source capture within tolerance", () => {
    const c = byId("power_on");
    const st = decodeBluestar(c.edges)!;
    const enc = sendBluestar(st);
    // Compare edge-for-edge against the capture (which has no trailing gap).
    for (let i = 0; i < c.edges.length; i++) {
      const ratio = enc[i]! / c.edges[i]!;
      expect(ratio, `edge ${i}: enc=${enc[i]} cap=${c.edges[i]}`).toBeGreaterThan(0.75);
      expect(ratio).toBeLessThan(1.25);
    }
  });

  it("round-trips a fully-specified state through build/send/decode", () => {
    const state: BluestarState = {
      power: true, mode: BluestarMode.Dry, fan: BluestarFan.High, temp: 28,
      swing: true, turbo: true, sleep: false, light: true, timer: true,
      vaneActive: true, roomTemp: 0x1d, commandCode: 0b11111010000,
    };
    expect(decodeBluestar(sendBluestar(state))).toEqual({
      power: true, mode: BluestarMode.Dry, fan: BluestarFan.High, temp: 28,
      swing: true, turbo: true, sleep: false, light: true, timer: true,
      vaneActive: true, roomTemp: 0x1d, commandCode: 0b11111010000,
    });
  });
});

describe("Bluestar rejection", () => {
  it("rejects a frame with a corrupted checksum", () => {
    const c = byId("power_on");
    const st = decodeBluestar(c.edges)!;
    const raw = buildBluestarRaw(st);
    raw[BLUESTAR_STATE_LENGTH - 1] = (raw[BLUESTAR_STATE_LENGTH - 1]! ^ 0xff) & 0xff;
    // Encode the corrupted raw (bypassing the checksum recompute) and decode.
    const timings = encodeBluestarRaw(raw, st.commandCode);
    expect(decodeBluestar(timings)).toBeNull();
  });

  it("rejects noise and truncated captures", () => {
    expect(decodeBluestar([])).toBeNull();
    expect(decodeBluestar([100, 200, 300])).toBeNull();
    expect(decodeBluestar(new Array(200).fill(400))).toBeNull();
  });

  it("does not false-positive on foreign timings", () => {
    // A Daikin-ish short-mark frame must not decode as Bluestar.
    const daikinLike = new Array(80).fill(0).flatMap(() => [420, 450]);
    expect(decodeBluestar(daikinLike)).toBeNull();
  });
});
