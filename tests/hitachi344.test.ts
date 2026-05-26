import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  sendHitachiAc344,
  encodeHitachiAc344Raw,
  buildHitachiAc344Raw,
  decodeHitachiAc344,
  HitachiAc344Mode,
  HitachiAc344Fan,
  HitachiAc344SwingH,
} from "../src/protocols/hitachi344";
import type { HitachiAc344State } from "../src/protocols/hitachi344";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function toHex(a: Uint8Array): string {
  return Array.from(a).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}

beforeAll(() => { ensureRunner(); });

interface TestCase { label: string; state: HitachiAc344State; cppArgs: string; }

const cases: TestCase[] = [
  { label: "cool 23°C fan auto", state: { power: true, temp: 23, mode: HitachiAc344Mode.Cool, fan: HitachiAc344Fan.Auto, swingV: false, swingH: HitachiAc344SwingH.Auto }, cppArgs: "1 23 3 5 0 0" },
  { label: "heat 30°C high swingV left", state: { power: true, temp: 30, mode: HitachiAc344Mode.Heat, fan: HitachiAc344Fan.High, swingV: true, swingH: HitachiAc344SwingH.Left }, cppArgs: "1 30 6 4 1 4" },
  { label: "fan mode max, swingH right", state: { power: true, temp: 23, mode: HitachiAc344Mode.Fan, fan: HitachiAc344Fan.Max, swingV: false, swingH: HitachiAc344SwingH.Right }, cppArgs: "1 23 1 6 0 2" },
  { label: "dry 20°C off, swingH leftMax", state: { power: false, temp: 20, mode: HitachiAc344Mode.Dry, fan: HitachiAc344Fan.Auto, swingV: false, swingH: HitachiAc344SwingH.LeftMax }, cppArgs: "0 20 5 5 0 5" },
  { label: "cool 16°C fan min swingV", state: { power: true, temp: 16, mode: HitachiAc344Mode.Cool, fan: HitachiAc344Fan.Min, swingV: true, swingH: HitachiAc344SwingH.Auto }, cppArgs: "1 16 3 1 1 0" },
];

describe("hitachiAc344 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const lines = cpp(`hitachiAc344 ${tc.cppArgs}`).split("\n");
      expect(toHex(buildHitachiAc344Raw(tc.state))).toBe(lines[0]!);
      expect(encodeHitachiAc344Raw(buildHitachiAc344Raw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
});

describe("decodeHitachiAc344 roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const decoded = decodeHitachiAc344(sendHitachiAc344(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAc344Raw(decoded!))).toBe(toHex(buildHitachiAc344Raw(tc.state)));
    });
  }
  it("decodes without a header", () => {
    const state = cases[1]!.state;
    const decoded = decodeHitachiAc344(sendHitachiAc344(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildHitachiAc344Raw(decoded!))).toBe(toHex(buildHitachiAc344Raw(state)));
  });
});

describe("decodeHitachiAc344 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`hitachiAc344 ${tc.cppArgs}`).split("\n")[1]!);
      const decoded = decodeHitachiAc344(cppTimings);
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAc344Raw(decoded!))).toBe(toHex(buildHitachiAc344Raw(tc.state)));
    });
  }
});

describe("decodeHitachiAc344 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeHitachiAc344([])).toBeNull();
    expect(decodeHitachiAc344([1, 2, 3])).toBeNull();
  });
  it("rejects broken byte-pair inversion", () => {
    const raw = buildHitachiAc344Raw(cases[0]!.state);
    raw[12] = (raw[12]! ^ 0xFF) & 0xFF;
    expect(decodeHitachiAc344(encodeHitachiAc344Raw(raw, 0))).toBeNull();
  });
});
