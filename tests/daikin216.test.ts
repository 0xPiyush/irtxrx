import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { buildDaikin216Raw, encodeDaikin216Raw, sendDaikin216, decodeDaikin216, DaikinMode, DaikinFan } from "../src/protocols/daikin216";
import type { Daikin216State } from "../src/protocols/daikin216";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(args: string): string { return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim(); }
function parseCppTimings(s: string): number[] { return s.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }

beforeAll(ensureRunner);

interface TC { label: string; state: Daikin216State; cppArgs: string; }

// C++ args: power temp mode fan swingV swingH powerful
const cases: TC[] = [
  { label: "cool 25°C fan auto", state: { power: true, temp: 25, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: true }, cppArgs: "1 25 3 10 1 0 0" },
  { label: "heat 28°C fan max", state: { power: true, temp: 28, mode: DaikinMode.Heat, fan: 5 }, cppArgs: "1 28 4 5 0 0 0" },
  { label: "dry mode", state: { power: false, temp: 22, mode: DaikinMode.Dry, fan: DaikinFan.Auto }, cppArgs: "0 22 2 10 0 0 0" },
  { label: "fan mode", state: { power: true, temp: 24, mode: DaikinMode.Fan, fan: 3 }, cppArgs: "1 24 6 3 0 0 0" },
  { label: "powerful + swingH", state: { power: true, temp: 20, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingHorizontal: true, powerful: true }, cppArgs: "1 20 3 10 0 1 1" },
  { label: "min temp", state: { power: false, temp: 5, mode: DaikinMode.Cool }, cppArgs: "0 5 3 10 0 0 0" },
  { label: "max temp", state: { power: false, temp: 40, mode: DaikinMode.Heat }, cppArgs: "0 40 4 10 0 0 0" },
  { label: "quiet fan", state: { power: true, temp: 24, mode: DaikinMode.Cool, fan: DaikinFan.Quiet }, cppArgs: "1 24 3 11 0 0 0" },
];

describe("daikin216 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const output = cpp(`daikin216 ${tc.cppArgs}`);
      const [cppRawHex, cppTimingsStr] = output.split("\n");
      const cppTimings = parseCppTimings(cppTimingsStr!);
      const tsRaw = buildDaikin216Raw(tc.state);
      expect(toHex(tsRaw)).toBe(cppRawHex!);
      expect(encodeDaikin216Raw(tsRaw, 0)).toEqual(cppTimings);
    });
  }
});

// ---------------------------------------------------------------------------
// Decode roundtrip
// ---------------------------------------------------------------------------

describe("decodeDaikin216 roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const timings = sendDaikin216(tc.state);
      const decoded = decodeDaikin216(timings);
      expect(decoded).not.toBeNull();
      expect(Array.from(buildDaikin216Raw(decoded!))).toEqual(Array.from(buildDaikin216Raw(tc.state)));
    });
  }
});

describe("decodeDaikin216 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`daikin216 ${tc.cppArgs}`).split("\n")[1]!);
      const decoded = decodeDaikin216(cppTimings);
      expect(decoded).not.toBeNull();
      expect(Array.from(buildDaikin216Raw(decoded!))).toEqual(Array.from(buildDaikin216Raw(tc.state)));
    });
  }
});

describe("decodeDaikin216 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeDaikin216([])).toBeNull();
    expect(decodeDaikin216([1, 2, 3])).toBeNull();
    const garbage = Array.from({ length: 500 }, () => Math.floor(Math.random() * 100));
    expect(decodeDaikin216(garbage)).toBeNull();
  });
});
