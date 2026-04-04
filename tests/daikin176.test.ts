import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { buildDaikin176Raw, encodeDaikin176Raw, Daikin176Mode, Daikin176SwingH } from "../src/protocols/daikin176";
import type { Daikin176State } from "../src/protocols/daikin176";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(args: string): string { return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim(); }
function parseCppTimings(s: string): number[] { return s.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }

beforeAll(ensureRunner);

interface TC { label: string; state: Daikin176State; cppArgs: string; }

// C++ args: power temp mode fan swingH id
const cases: TC[] = [
  { label: "cool 25°C fan max swing auto", state: { power: true, temp: 25, mode: Daikin176Mode.Cool, fan: 3, swingHorizontal: Daikin176SwingH.Auto }, cppArgs: "1 25 2 3 5 0" },
  { label: "heat 28°C fan min", state: { power: true, temp: 28, mode: Daikin176Mode.Heat, fan: 1 }, cppArgs: "1 28 1 1 5 0" },
  { label: "dry mode (temp forced to 17)", state: { power: false, temp: 25, mode: Daikin176Mode.Dry, fan: 3 }, cppArgs: "0 25 7 3 5 0" },
  { label: "fan mode (temp forced to 17)", state: { power: true, temp: 22, mode: Daikin176Mode.Fan, fan: 3 }, cppArgs: "1 22 0 3 5 0" },
  { label: "auto mode", state: { power: true, temp: 24, mode: Daikin176Mode.Auto, fan: 3 }, cppArgs: "1 24 3 3 5 0" },
  { label: "swing off", state: { power: true, temp: 22, mode: Daikin176Mode.Cool, fan: 3, swingHorizontal: Daikin176SwingH.Off }, cppArgs: "1 22 2 3 6 0" },
  { label: "id=1", state: { power: false, temp: 24, mode: Daikin176Mode.Cool, fan: 3, id: 1 }, cppArgs: "0 24 2 3 5 1" },
];

describe("daikin176 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const output = cpp(`daikin176 ${tc.cppArgs}`);
      const [cppRawHex, cppTimingsStr] = output.split("\n");
      const cppTimings = parseCppTimings(cppTimingsStr!);
      const tsRaw = buildDaikin176Raw(tc.state);
      expect(toHex(tsRaw)).toBe(cppRawHex!);
      expect(encodeDaikin176Raw(tsRaw, 0)).toEqual(cppTimings);
    });
  }
});
