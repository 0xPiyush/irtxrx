import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { buildDaikin160Raw, encodeDaikin160Raw, sendDaikin160, decodeDaikin160, DaikinMode, DaikinFan, Daikin160SwingV } from "../src/protocols/daikin160";
import type { Daikin160State } from "../src/protocols/daikin160";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(args: string): string { return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim(); }
function parseCppTimings(s: string): number[] { return s.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }

beforeAll(ensureRunner);

interface TC { label: string; state: Daikin160State; cppArgs: string; }

// C++ args: power temp mode fan swingV
const cases: TC[] = [
  { label: "cool 25°C fan auto swing auto", state: { power: true, temp: 25, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: Daikin160SwingV.Auto }, cppArgs: "1 25 3 10 15" },
  { label: "heat 30°C fan max swing lowest", state: { power: true, temp: 30, mode: DaikinMode.Heat, fan: 5, swingVertical: Daikin160SwingV.Lowest }, cppArgs: "1 30 4 5 1" },
  { label: "dry mode", state: { power: false, temp: 22, mode: DaikinMode.Dry, fan: DaikinFan.Auto }, cppArgs: "0 22 2 10 15" },
  { label: "fan mode", state: { power: true, temp: 24, mode: DaikinMode.Fan, fan: 3 }, cppArgs: "1 24 6 3 15" },
  { label: "auto mode quiet fan", state: { power: true, temp: 26, mode: DaikinMode.Auto, fan: DaikinFan.Quiet }, cppArgs: "1 26 0 11 15" },
  { label: "min temp", state: { power: false, temp: 5, mode: DaikinMode.Cool }, cppArgs: "0 5 3 10 15" },
  { label: "swing middle", state: { power: true, temp: 22, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: Daikin160SwingV.Middle }, cppArgs: "1 22 3 10 3" },
];

describe("daikin160 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const output = cpp(`daikin160 ${tc.cppArgs}`);
      const [cppRawHex, cppTimingsStr] = output.split("\n");
      const cppTimings = parseCppTimings(cppTimingsStr!);
      const tsRaw = buildDaikin160Raw(tc.state);
      expect(toHex(tsRaw)).toBe(cppRawHex!);
      expect(encodeDaikin160Raw(tsRaw, 0)).toEqual(cppTimings);
    });
  }
});

// ---------------------------------------------------------------------------
// Decode roundtrip
// ---------------------------------------------------------------------------

describe("decodeDaikin160 roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const timings = sendDaikin160(tc.state);
      const decoded = decodeDaikin160(timings);
      expect(decoded).not.toBeNull();
      expect(Array.from(buildDaikin160Raw(decoded!))).toEqual(Array.from(buildDaikin160Raw(tc.state)));
    });
  }
});

describe("decodeDaikin160 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`daikin160 ${tc.cppArgs}`).split("\n")[1]!);
      const decoded = decodeDaikin160(cppTimings);
      expect(decoded).not.toBeNull();
      expect(Array.from(buildDaikin160Raw(decoded!))).toEqual(Array.from(buildDaikin160Raw(tc.state)));
    });
  }
});

describe("decodeDaikin160 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeDaikin160([])).toBeNull();
    expect(decodeDaikin160([1, 2, 3])).toBeNull();
    const garbage = Array.from({ length: 500 }, () => Math.floor(Math.random() * 100));
    expect(decodeDaikin160(garbage)).toBeNull();
  });
});
