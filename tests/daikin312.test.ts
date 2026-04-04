import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { buildDaikin312Raw, encodeDaikin312Raw, sendDaikin312, decodeDaikin312, DaikinMode, DaikinFan } from "../src/protocols/daikin312";
import type { Daikin312State } from "../src/protocols/daikin312";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(args: string): string { return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim(); }
function parseCppTimings(s: string): number[] { return s.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }

beforeAll(ensureRunner);

interface TC { label: string; state: Daikin312State; cppArgs: string; }

// C++ args: power temp mode fan swingV swingH quiet powerful econo
const cases: TC[] = [
  { label: "cool 25°C fan auto", state: { power: true, temp: 25, mode: DaikinMode.Cool, fan: DaikinFan.Auto }, cppArgs: "1 25 3 10 0 0 0 0 0" },
  { label: "heat 28°C fan max", state: { power: true, temp: 28, mode: DaikinMode.Heat, fan: 5 }, cppArgs: "1 28 4 5 0 0 0 0 0" },
  { label: "dry mode", state: { power: false, temp: 22, mode: DaikinMode.Dry, fan: DaikinFan.Auto }, cppArgs: "0 22 2 10 0 0 0 0 0" },
  { label: "fan mode", state: { power: true, temp: 24, mode: DaikinMode.Fan, fan: 3 }, cppArgs: "1 24 6 3 0 0 0 0 0" },
  { label: "auto mode", state: { power: true, temp: 26, mode: DaikinMode.Auto, fan: DaikinFan.Auto }, cppArgs: "1 26 0 10 0 0 0 0 0" },
  { label: "quiet", state: { power: true, temp: 24, mode: DaikinMode.Cool, fan: DaikinFan.Quiet, quiet: true }, cppArgs: "1 24 3 11 0 0 1 0 0" },
  { label: "powerful", state: { power: true, temp: 20, mode: DaikinMode.Cool, fan: DaikinFan.Auto, powerful: true }, cppArgs: "1 20 3 10 0 0 0 1 0" },
  { label: "econo", state: { power: true, temp: 26, mode: DaikinMode.Cool, fan: 2, econo: true }, cppArgs: "1 26 3 2 0 0 0 0 1" },
  { label: "default state", state: {}, cppArgs: "0 22 0 10 0 0 0 0 0" },
  { label: "half degree", state: { power: true, temp: 25.5, mode: DaikinMode.Cool, fan: DaikinFan.Auto }, cppArgs: "1 25.5 3 10 0 0 0 0 0" },
];

describe("daikin312 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const output = cpp(`daikin312 ${tc.cppArgs}`);
      const [cppRawHex, cppTimingsStr] = output.split("\n");
      const cppTimings = parseCppTimings(cppTimingsStr!);
      const tsRaw = buildDaikin312Raw(tc.state);
      expect(toHex(tsRaw)).toBe(cppRawHex!);
      expect(encodeDaikin312Raw(tsRaw, 0)).toEqual(cppTimings);
    });
  }
});

// ---------------------------------------------------------------------------
// Decode roundtrip tests
// ---------------------------------------------------------------------------

interface DecodeTc { label: string; state: Daikin312State; }

const decodeCases: DecodeTc[] = [
  {
    label: "cool 25°C fan auto",
    state: { power: true, temp: 25, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: 7, swingHorizontal: 9, quiet: false, powerful: false, econo: false, light: 1, beep: 2, clean: true, mold: false, freshAir: false, freshAirHigh: true, eye: true, eyeAuto: true, purify: false, currentTime: 600 },
  },
  {
    label: "heat 28°C fan max powerful",
    state: { power: true, temp: 28, mode: DaikinMode.Heat, fan: 5, swingVertical: 0, swingHorizontal: 0, quiet: false, powerful: true, econo: false, light: 0, beep: 0, clean: false, mold: false, freshAir: false, freshAirHigh: false, eye: false, eyeAuto: false, purify: false, currentTime: 0 },
  },
  {
    label: "auto mode quiet econo purify",
    state: { power: true, temp: 26, mode: DaikinMode.Auto, fan: DaikinFan.Quiet, swingVertical: 5, swingHorizontal: 3, quiet: true, powerful: false, econo: true, light: 3, beep: 3, clean: false, mold: true, freshAir: true, freshAirHigh: false, eye: false, eyeAuto: false, purify: true, currentTime: 1439 },
  },
  {
    label: "half degree temp",
    state: { power: true, temp: 25.5, mode: DaikinMode.Cool, fan: DaikinFan.Auto },
  },
  {
    label: "default state",
    state: {},
  },
];

describe("decodeDaikin312 roundtrip", () => {
  for (const tc of decodeCases) {
    it(`roundtrips ${tc.label}`, () => {
      const timings = sendDaikin312(tc.state);
      const decoded = decodeDaikin312(timings);
      expect(decoded).not.toBeNull();

      // Build the raw to know the expected decoded values (after clamping etc.)
      const raw = buildDaikin312Raw(tc.state);
      const expected = decodeDaikin312(encodeDaikin312Raw(raw, 0).slice(12));  // skip 5-bit header
      expect(decoded).toEqual(expected);
    });
  }
});

describe("decodeDaikin312 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`daikin312 ${tc.cppArgs}`).split("\n")[1]!);
      const decoded = decodeDaikin312(cppTimings);
      expect(decoded).not.toBeNull();
      expect(Array.from(buildDaikin312Raw(decoded!))).toEqual(Array.from(buildDaikin312Raw(tc.state)));
    });
  }
});

describe("decodeDaikin312 without leader", () => {
  it("decodes when 5-bit header is missing", () => {
    const state: Daikin312State = { power: true, temp: 24.5, mode: DaikinMode.Cool, fan: 3 };
    const timings = sendDaikin312(state);
    // Strip 5-bit header: 5 zero bits (5 mark+space pairs) + footer mark + gap = 12 entries
    const noLeader = timings.slice(12);
    const decoded = decodeDaikin312(noLeader);
    expect(decoded).not.toBeNull();
    expect(decoded!.power).toBe(true);
    expect(decoded!.temp).toBe(24.5);
    expect(decoded!.mode).toBe(DaikinMode.Cool);
    expect(decoded!.fan).toBe(3);
  });
});

describe("decodeDaikin312 rejection", () => {
  it("rejects empty timings", () => {
    expect(decodeDaikin312([])).toBeNull();
  });

  it("rejects timings that are too short", () => {
    expect(decodeDaikin312([1, 2, 3])).toBeNull();
  });

  it("rejects garbage data", () => {
    const garbage = Array.from({ length: 700 }, () => Math.floor(Math.random() * 100));
    expect(decodeDaikin312(garbage)).toBeNull();
  });

  it("rejects corrupted checksum", () => {
    const timings = sendDaikin312({ power: true, temp: 24 });
    // Corrupt a timing in the middle of section 2 data
    timings[300] = 1;
    expect(decodeDaikin312(timings)).toBeNull();
  });
});
