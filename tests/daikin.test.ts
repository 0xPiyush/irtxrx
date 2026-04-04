import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { buildDaikinESPRaw, encodeDaikinESPRaw, DaikinMode, DaikinFan } from "../src/protocols/daikin";
import type { DaikinESPState } from "../src/protocols/daikin";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(args: string): string { return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim(); }
function parseCppTimings(s: string): number[] { return s.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }

beforeAll(ensureRunner);

interface TC { label: string; state: DaikinESPState; cppArgs: string; }

// C++ args: power temp mode fan swingV swingH quiet powerful econo mold comfort sensor
const cases: TC[] = [
  { label: "cool 25°C fan auto swingV", state: { power: true, temp: 25, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: true }, cppArgs: "1 25 3 10 1 0 0 0 0 0 0 0" },
  { label: "heat 28°C fan max", state: { power: true, temp: 28, mode: DaikinMode.Heat, fan: 5 }, cppArgs: "1 28 4 5 0 0 0 0 0 0 0 0" },
  { label: "dry mode", state: { power: false, temp: 22, mode: DaikinMode.Dry, fan: DaikinFan.Auto }, cppArgs: "0 22 2 10 0 0 0 0 0 0 0 0" },
  { label: "fan mode", state: { power: true, temp: 24, mode: DaikinMode.Fan, fan: 3 }, cppArgs: "1 24 6 3 0 0 0 0 0 0 0 0" },
  { label: "auto mode", state: { power: true, temp: 26, mode: DaikinMode.Auto, fan: DaikinFan.Auto }, cppArgs: "1 26 0 10 0 0 0 0 0 0 0 0" },
  { label: "quiet mode", state: { power: true, temp: 24, mode: DaikinMode.Cool, fan: DaikinFan.Quiet, quiet: true }, cppArgs: "1 24 3 11 0 0 1 0 0 0 0 0" },
  { label: "powerful mode", state: { power: true, temp: 20, mode: DaikinMode.Cool, fan: DaikinFan.Auto, powerful: true }, cppArgs: "1 20 3 10 0 0 0 1 0 0 0 0" },
  { label: "econo + sensor", state: { power: true, temp: 26, mode: DaikinMode.Cool, fan: 2, econo: true, sensor: true }, cppArgs: "1 26 3 2 0 0 0 0 1 0 0 1" },
  { label: "mold + comfort", state: { power: true, temp: 24, mode: DaikinMode.Cool, fan: DaikinFan.Auto, mold: true, comfort: true }, cppArgs: "1 24 3 10 0 0 0 0 0 1 1 0" },
  { label: "both swing", state: { power: true, temp: 22, mode: DaikinMode.Cool, fan: DaikinFan.Auto, swingVertical: true, swingHorizontal: true }, cppArgs: "1 22 3 10 1 1 0 0 0 0 0 0" },
  { label: "min temp 10°C", state: { power: false, temp: 5, mode: DaikinMode.Cool }, cppArgs: "0 5 3 10 0 0 0 0 0 0 0 0" },
  { label: "max temp 32°C", state: { power: false, temp: 40, mode: DaikinMode.Heat }, cppArgs: "0 40 4 10 0 0 0 0 0 0 0 0" },
  { label: "half degree 25.5°C", state: { power: true, temp: 25.5, mode: DaikinMode.Cool, fan: DaikinFan.Auto }, cppArgs: "1 25.5 3 10 0 0 0 0 0 0 0 0" },
];

describe("daikinESP state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const output = cpp(`daikin ${tc.cppArgs}`);
      const [cppRawHex, cppTimingsStr] = output.split("\n");
      const cppTimings = parseCppTimings(cppTimingsStr!);
      const tsRaw = buildDaikinESPRaw(tc.state);
      expect(toHex(tsRaw)).toBe(cppRawHex!);
      expect(encodeDaikinESPRaw(tsRaw, 0)).toEqual(cppTimings);
    });
  }
});
