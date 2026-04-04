import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { buildDaikin2Raw, encodeDaikin2Raw, sendDaikin2, decodeDaikin2, DaikinMode, DaikinFan } from "../src/protocols/daikin2";
import type { Daikin2State } from "../src/protocols/daikin2";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(args: string): string { return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim(); }
function parseCppTimings(s: string): number[] { return s.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }

beforeAll(ensureRunner);

interface TC { label: string; state: Daikin2State; cppArgs: string; }

// C++ args: power temp mode fan swingV swingH quiet powerful econo
const cases: TC[] = [
  { label: "cool 25°C fan auto swingV auto", state: { power: true, temp: 25, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: 0xf, swingHorizontal: 0xbe }, cppArgs: "1 25 3 10 15 190 0 0 0" },
  { label: "heat 28°C fan max", state: { power: true, temp: 28, mode: DaikinMode.Heat, fan: 5 }, cppArgs: "1 28 4 5 0 0 0 0 0" },
  { label: "dry mode", state: { power: false, temp: 22, mode: DaikinMode.Dry, fan: DaikinFan.Auto }, cppArgs: "0 22 2 10 0 0 0 0 0" },
  { label: "fan mode", state: { power: true, temp: 24, mode: DaikinMode.Fan, fan: 3 }, cppArgs: "1 24 6 3 0 0 0 0 0" },
  { label: "auto mode", state: { power: true, temp: 26, mode: DaikinMode.Auto, fan: DaikinFan.Auto }, cppArgs: "1 26 0 10 0 0 0 0 0" },
  { label: "quiet", state: { power: true, temp: 24, mode: DaikinMode.Cool, fan: DaikinFan.Quiet, quiet: true }, cppArgs: "1 24 3 11 0 0 1 0 0" },
  { label: "powerful", state: { power: true, temp: 20, mode: DaikinMode.Cool, fan: DaikinFan.Auto, powerful: true }, cppArgs: "1 20 3 10 0 0 0 1 0" },
  { label: "econo", state: { power: true, temp: 26, mode: DaikinMode.Cool, fan: 2, econo: true }, cppArgs: "1 26 3 2 0 0 0 0 1" },
  { label: "min temp cool (18)", state: { power: false, temp: 10, mode: DaikinMode.Cool }, cppArgs: "0 10 3 10 0 0 0 0 0" },
  { label: "min temp heat (10)", state: { power: false, temp: 5, mode: DaikinMode.Heat }, cppArgs: "0 5 4 10 0 0 0 0 0" },
  { label: "default state", state: {}, cppArgs: "0 25 0 10 0 0 0 0 0" },
];

describe("daikin2 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const output = cpp(`daikin2 ${tc.cppArgs}`);
      const [cppRawHex, cppTimingsStr] = output.split("\n");
      const cppTimings = parseCppTimings(cppTimingsStr!);
      const tsRaw = buildDaikin2Raw(tc.state);
      expect(toHex(tsRaw)).toBe(cppRawHex!);
      expect(encodeDaikin2Raw(tsRaw, 0)).toEqual(cppTimings);
    });
  }
});

// ---------------------------------------------------------------------------
// Decode roundtrip tests
// ---------------------------------------------------------------------------

interface DecodeTc { label: string; state: Daikin2State; }

const decodeCases: DecodeTc[] = [
  {
    label: "cool 25°C fan auto with swings",
    state: { power: true, temp: 25, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: 0xf, swingHorizontal: 0xbe, quiet: false, powerful: false, econo: false, light: 2, beep: 1, clean: true, mold: false, freshAir: true, freshAirHigh: false, eye: true, eyeAuto: true, purify: false, currentTime: 720 },
  },
  {
    label: "heat 28°C fan max powerful",
    state: { power: true, temp: 28, mode: DaikinMode.Heat, fan: 5, swingVertical: 0, swingHorizontal: 0, quiet: false, powerful: true, econo: false, light: 0, beep: 0, clean: false, mold: false, freshAir: false, freshAirHigh: false, eye: false, eyeAuto: false, purify: false, currentTime: 0 },
  },
  {
    label: "auto mode quiet econo purify",
    state: { power: true, temp: 26, mode: DaikinMode.Auto, fan: DaikinFan.Quiet, swingVertical: 5, swingHorizontal: 0x50, quiet: true, powerful: false, econo: true, light: 3, beep: 3, clean: false, mold: true, freshAir: false, freshAirHigh: true, eye: false, eyeAuto: false, purify: true, currentTime: 1439 },
  },
  {
    label: "default state (all defaults)",
    state: {},
  },
];

describe("decodeDaikin2 roundtrip", () => {
  for (const tc of decodeCases) {
    it(`roundtrips ${tc.label}`, () => {
      const timings = sendDaikin2(tc.state);
      const decoded = decodeDaikin2(timings);
      expect(decoded).not.toBeNull();

      // Build the raw to know the expected decoded values (after clamping etc.)
      const raw = buildDaikin2Raw(tc.state);
      const expected = decodeDaikin2(encodeDaikin2Raw(raw, 0).slice(2));  // skip leader
      expect(decoded).toEqual(expected);
    });
  }
});

describe("decodeDaikin2 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`daikin2 ${tc.cppArgs}`).split("\n")[1]!);
      const decoded = decodeDaikin2(cppTimings);
      expect(decoded).not.toBeNull();
      expect(Array.from(buildDaikin2Raw(decoded!))).toEqual(Array.from(buildDaikin2Raw(tc.state)));
    });
  }
});

describe("decodeDaikin2 without leader", () => {
  it("decodes when leader mark/space is missing", () => {
    const state: Daikin2State = { power: true, temp: 22, mode: DaikinMode.Cool, fan: 2 };
    const timings = sendDaikin2(state);
    // Strip leader (first 2 entries: LDR_MARK, LDR_SPACE)
    const noLeader = timings.slice(2);
    const decoded = decodeDaikin2(noLeader);
    expect(decoded).not.toBeNull();
    expect(decoded!.power).toBe(true);
    expect(decoded!.temp).toBe(22);
    expect(decoded!.mode).toBe(DaikinMode.Cool);
    expect(decoded!.fan).toBe(2);
  });
});

describe("decodeDaikin2 rejection", () => {
  it("rejects empty timings", () => {
    expect(decodeDaikin2([])).toBeNull();
  });

  it("rejects timings that are too short", () => {
    expect(decodeDaikin2([1, 2, 3])).toBeNull();
  });

  it("rejects garbage data", () => {
    const garbage = Array.from({ length: 700 }, () => Math.floor(Math.random() * 100));
    expect(decodeDaikin2(garbage)).toBeNull();
  });

  it("rejects corrupted checksum", () => {
    const timings = sendDaikin2({ power: true, temp: 24 });
    // Corrupt a timing in the middle of section 2 data
    timings[300] = 1;
    expect(decodeDaikin2(timings)).toBeNull();
  });
});
