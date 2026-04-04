import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { buildDaikin128Raw, encodeDaikin128Raw, sendDaikin128, decodeDaikin128, Daikin128Mode, Daikin128Fan } from "../src/protocols/daikin128";
import type { Daikin128State } from "../src/protocols/daikin128";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(args: string): string { return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim(); }
function parseCppTimings(s: string): number[] { return s.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }

beforeAll(ensureRunner);

interface TC { label: string; state: Daikin128State; cppArgs: string; }

// C++ args: power temp mode fan swingV sleep econo clock
const cases: TC[] = [
  { label: "cool 24°C fan auto", state: { power: true, temp: 24, mode: Daikin128Mode.Cool, fan: Daikin128Fan.Auto, clock: 720 }, cppArgs: "1 24 2 1 0 0 0 720" },
  { label: "heat 28°C fan high", state: { power: true, temp: 28, mode: Daikin128Mode.Heat, fan: Daikin128Fan.High, clock: 0 }, cppArgs: "1 28 8 2 0 0 0 0" },
  { label: "dry mode", state: { power: false, temp: 22, mode: Daikin128Mode.Dry, fan: Daikin128Fan.Med, clock: 0 }, cppArgs: "0 22 1 4 0 0 0 0" },
  { label: "fan mode", state: { power: true, temp: 20, mode: Daikin128Mode.Fan, fan: Daikin128Fan.Low, clock: 600 }, cppArgs: "1 20 4 8 0 0 0 600" },
  { label: "auto mode", state: { power: true, temp: 24, mode: Daikin128Mode.Auto, fan: Daikin128Fan.Auto, clock: 0 }, cppArgs: "1 24 10 1 0 0 0 0" },
  { label: "swing + sleep", state: { power: true, temp: 22, mode: Daikin128Mode.Cool, fan: Daikin128Fan.Auto, swingVertical: true, sleep: true, clock: 0 }, cppArgs: "1 22 2 1 1 1 0 0" },
  { label: "econo in cool mode", state: { power: true, temp: 26, mode: Daikin128Mode.Cool, fan: Daikin128Fan.Auto, econo: true, clock: 0 }, cppArgs: "1 26 2 1 0 0 1 0" },
  { label: "econo in fan mode (ignored)", state: { power: true, temp: 24, mode: Daikin128Mode.Fan, fan: Daikin128Fan.Auto, econo: true, clock: 0 }, cppArgs: "1 24 4 1 0 0 1 0" },
  { label: "quiet fan in auto mode (forced to auto)", state: { power: true, temp: 24, mode: Daikin128Mode.Auto, fan: Daikin128Fan.Quiet, clock: 0 }, cppArgs: "1 24 10 9 0 0 0 0" },
  { label: "powerful fan in cool mode", state: { power: true, temp: 20, mode: Daikin128Mode.Cool, fan: Daikin128Fan.Powerful, clock: 0 }, cppArgs: "1 20 2 3 0 0 0 0" },
  { label: "min temp", state: { power: false, temp: 10, mode: Daikin128Mode.Cool, clock: 0 }, cppArgs: "0 10 2 1 0 0 0 0" },
  { label: "max temp", state: { power: false, temp: 40, mode: Daikin128Mode.Heat, clock: 0 }, cppArgs: "0 40 8 1 0 0 0 0" },
];

describe("daikin128 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const output = cpp(`daikin128 ${tc.cppArgs}`);
      const [cppRawHex, cppTimingsStr] = output.split("\n");
      const cppTimings = parseCppTimings(cppTimingsStr!);
      const tsRaw = buildDaikin128Raw(tc.state);
      expect(toHex(tsRaw)).toBe(cppRawHex!);
      expect(encodeDaikin128Raw(tsRaw, 0)).toEqual(cppTimings);
    });
  }
});

// ---------------------------------------------------------------------------
// Decode roundtrip
// ---------------------------------------------------------------------------

describe("decodeDaikin128 roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const timings = sendDaikin128(tc.state);
      const decoded = decodeDaikin128(timings);
      expect(decoded).not.toBeNull();
      expect(Array.from(buildDaikin128Raw(decoded!))).toEqual(Array.from(buildDaikin128Raw(tc.state)));
    });
  }
});

describe("decodeDaikin128 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`daikin128 ${tc.cppArgs}`).split("\n")[1]!);
      const decoded = decodeDaikin128(cppTimings);
      expect(decoded).not.toBeNull();
      expect(Array.from(buildDaikin128Raw(decoded!))).toEqual(Array.from(buildDaikin128Raw(tc.state)));
    });
  }
});

describe("decodeDaikin128 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeDaikin128([])).toBeNull();
    expect(decodeDaikin128([1, 2, 3])).toBeNull();
    const garbage = Array.from({ length: 500 }, () => Math.floor(Math.random() * 100));
    expect(decodeDaikin128(garbage)).toBeNull();
  });
});
