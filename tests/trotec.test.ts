import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildTrotecRaw, encodeTrotecRaw, sendTrotec, decodeTrotec, trotecValidChecksum,
  buildTrotec3550Raw, encodeTrotec3550Raw, sendTrotec3550, decodeTrotec3550, trotec3550ValidChecksum,
  TrotecMode, TrotecFan,
} from "../src/protocols/trotec";
import type { TrotecState, Trotec3550State } from "../src/protocols/trotec";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(args: string): string { return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim(); }
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function toHex(a: Uint8Array): string {
  return Array.from(a).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}
beforeAll(() => { ensureRunner(); });

// ===== Trotec (PAC 3200) =====

interface TCase { label: string; state: TrotecState; cppArgs: string; } // power temp mode fan sleep timer
const tCases: TCase[] = [
  { label: "cool 24 med", state: { power: true, temp: 24, mode: TrotecMode.Cool, fan: TrotecFan.Med }, cppArgs: "1 24 1 2 0 0" },
  { label: "auto 25", state: { power: true, temp: 25, mode: TrotecMode.Auto, fan: TrotecFan.Med }, cppArgs: "1 25 0 2 0 0" },
  { label: "dry 18 low", state: { power: true, temp: 18, mode: TrotecMode.Dry, fan: TrotecFan.Low }, cppArgs: "1 18 2 1 0 0" },
  { label: "fan 32 high", state: { power: true, temp: 32, mode: TrotecMode.Fan, fan: TrotecFan.High }, cppArgs: "1 32 3 3 0 0" },
  { label: "cool sleep", state: { power: true, temp: 22, mode: TrotecMode.Cool, fan: TrotecFan.Low, sleep: true }, cppArgs: "1 22 1 1 1 0" },
  { label: "cool timer 6h", state: { power: true, temp: 23, mode: TrotecMode.Cool, fan: TrotecFan.Med, timer: 6 }, cppArgs: "1 23 1 2 0 6" },
  { label: "off", state: { power: false, temp: 26, mode: TrotecMode.Cool, fan: TrotecFan.Med }, cppArgs: "0 26 1 2 0 0" },
];

describe("Trotec build + encode cross-validation", () => {
  for (const tc of tCases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`trotec ${tc.cppArgs}`).split("\n");
      expect(toHex(buildTrotecRaw(tc.state))).toBe(lines[0]!);
      expect(encodeTrotecRaw(buildTrotecRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
  it("matches C++ timings with repeat", () => {
    const raw = buildTrotecRaw(tCases[0]!.state);
    expect(encodeTrotecRaw(raw, 1)).toEqual(parseCppTimings(cpp(`sendTrotec ${toHex(raw)} 1`)));
  });
});

describe("Trotec decode", () => {
  for (const tc of tCases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildTrotecRaw(tc.state);
      const d = decodeTrotec(sendTrotec(tc.state));
      expect(d).not.toBeNull();
      expect(toHex(buildTrotecRaw(d!))).toBe(toHex(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const out = cpp(`decode ${encodeTrotecRaw(buildTrotecRaw(tc.state)).join(",")}`).split("\n");
      expect(out[0]).toBe("TROTEC");
      expect(out[1]).toBe(toHex(buildTrotecRaw(tc.state)));
    });
  }
  it("decodes without a header", () => {
    const d = decodeTrotec(sendTrotec(tCases[0]!.state).slice(2), 0, true);
    expect(toHex(buildTrotecRaw(d!))).toBe(toHex(buildTrotecRaw(tCases[0]!.state)));
  });
  it("dispatch + rejection", () => {
    expect(decode(sendTrotec(tCases[0]!.state))?.protocol).toBe("trotec");
    expect(decodeTrotec([])).toBeNull();
    const bad = buildTrotecRaw(tCases[0]!.state); bad[3] ^= 0x0f;
    expect(decodeTrotec(encodeTrotecRaw(bad))).toBeNull();
    expect(trotecValidChecksum(buildTrotecRaw(tCases[3]!.state))).toBe(true);
  });
  it("timer round-trips losslessly (Timer bit derives from Hours)", () => {
    for (const timer of [0, 1, 5, 23, 24]) {
      const built = buildTrotecRaw({ timer });
      const decoded = decodeTrotec(encodeTrotecRaw(built));
      expect(toHex(buildTrotecRaw(decoded!))).toBe(toHex(built));
    }
  });
});

// ===== Trotec3550 (PAC 3550 Pro) =====

interface T35 { label: string; state: Trotec3550State; cppArgs: string; } // power temp celsius mode fan swingV timer
const t35Cases: T35[] = [
  { label: "cool 24C med", state: { power: true, temp: 24, celsius: true, mode: TrotecMode.Cool, fan: TrotecFan.Med }, cppArgs: "1 24 1 1 2 0 0" },
  { label: "auto 16C low", state: { power: true, temp: 16, celsius: true, mode: TrotecMode.Auto, fan: TrotecFan.Low }, cppArgs: "1 16 1 0 1 0 0" },
  { label: "dry 30C high", state: { power: true, temp: 30, celsius: true, mode: TrotecMode.Dry, fan: TrotecFan.High }, cppArgs: "1 30 1 2 3 0 0" },
  { label: "cool 75F", state: { power: true, temp: 75, celsius: false, mode: TrotecMode.Cool, fan: TrotecFan.Med }, cppArgs: "1 75 0 1 2 0 0" },
  { label: "cool 59F low", state: { power: true, temp: 59, celsius: false, mode: TrotecMode.Cool, fan: TrotecFan.Low }, cppArgs: "1 59 0 1 1 0 0" },
  { label: "cool swingV", state: { power: true, temp: 22, celsius: true, mode: TrotecMode.Cool, fan: TrotecFan.Med, swingV: true }, cppArgs: "1 22 1 1 2 1 0" },
  { label: "cool timer 120m", state: { power: true, temp: 22, celsius: true, mode: TrotecMode.Cool, fan: TrotecFan.Med, timer: 120 }, cppArgs: "1 22 1 1 2 0 120" },
  { label: "off", state: { power: false, temp: 25, celsius: true, mode: TrotecMode.Cool, fan: TrotecFan.Med }, cppArgs: "0 25 1 1 2 0 0" },
];

describe("Trotec3550 build + encode cross-validation", () => {
  for (const tc of t35Cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`trotec3550 ${tc.cppArgs}`).split("\n");
      expect(toHex(buildTrotec3550Raw(tc.state))).toBe(lines[0]!);
      expect(encodeTrotec3550Raw(buildTrotec3550Raw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
  it("matches C++ timings with repeat", () => {
    const raw = buildTrotec3550Raw(t35Cases[0]!.state);
    expect(encodeTrotec3550Raw(raw, 1)).toEqual(parseCppTimings(cpp(`sendTrotec3550 ${toHex(raw)} 1`)));
  });
});

describe("Trotec3550 decode", () => {
  for (const tc of t35Cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildTrotec3550Raw(tc.state);
      const d = decodeTrotec3550(sendTrotec3550(tc.state));
      expect(d).not.toBeNull();
      expect(toHex(buildTrotec3550Raw(d!))).toBe(toHex(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const out = cpp(`decode ${encodeTrotec3550Raw(buildTrotec3550Raw(tc.state)).join(",")}`).split("\n");
      expect(out[0]).toBe("TROTEC_3550");
      expect(out[1]).toBe(toHex(buildTrotec3550Raw(tc.state)));
    });
  }
  it("reads °F + swing fields", () => {
    const s = decodeTrotec3550(sendTrotec3550(t35Cases[3]!.state))!;
    expect(s).toMatchObject({ power: true, celsius: false, temp: 75, mode: TrotecMode.Cool });
  });
  it("dispatch + rejection", () => {
    expect(decode(sendTrotec3550(t35Cases[0]!.state))?.protocol).toBe("trotec_3550");
    expect(decodeTrotec3550([])).toBeNull();
    const bad = buildTrotec3550Raw(t35Cases[0]!.state); bad[1] ^= 0x0f;
    expect(decodeTrotec3550(encodeTrotec3550Raw(bad))).toBeNull();
    expect(trotec3550ValidChecksum(buildTrotec3550Raw(t35Cases[2]!.state))).toBe(true);
  });
});
