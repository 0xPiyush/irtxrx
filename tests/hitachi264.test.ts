import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  sendHitachiAc264,
  encodeHitachiAc264Raw,
  buildHitachiAc264Raw,
  decodeHitachiAc264,
  HitachiAc264Mode,
  HitachiAc264Fan,
} from "../src/protocols/hitachi264";
import type { HitachiAc264State } from "../src/protocols/hitachi264";

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

interface TestCase { label: string; state: HitachiAc264State; cppArgs: string; }

const cases: TestCase[] = [
  { label: "cool 23°C fan auto", state: { power: true, temp: 23, mode: HitachiAc264Mode.Cool, fan: HitachiAc264Fan.Auto }, cppArgs: "1 23 3 5 0" },
  { label: "heat 30°C fan high", state: { power: true, temp: 30, mode: HitachiAc264Mode.Heat, fan: HitachiAc264Fan.High }, cppArgs: "1 30 6 4 0" },
  { label: "fan mode + swingV toggle", state: { power: true, temp: 23, mode: HitachiAc264Mode.Fan, fan: HitachiAc264Fan.Auto, swingVToggle: true }, cppArgs: "1 23 1 5 1" },
  { label: "dry 20°C off", state: { power: false, temp: 20, mode: HitachiAc264Mode.Dry, fan: HitachiAc264Fan.Auto }, cppArgs: "0 20 5 5 0" },
  { label: "cool 25°C fan min", state: { power: true, temp: 25, mode: HitachiAc264Mode.Cool, fan: HitachiAc264Fan.Min }, cppArgs: "1 25 3 1 0" },
];

describe("hitachiAc264 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const lines = cpp(`hitachiAc264 ${tc.cppArgs}`).split("\n");
      expect(toHex(buildHitachiAc264Raw(tc.state))).toBe(lines[0]!);
      expect(encodeHitachiAc264Raw(buildHitachiAc264Raw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
});

describe("decodeHitachiAc264 roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const decoded = decodeHitachiAc264(sendHitachiAc264(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAc264Raw(decoded!))).toBe(toHex(buildHitachiAc264Raw(tc.state)));
    });
  }
  it("decodes without a header", () => {
    const state = cases[1]!.state;
    const decoded = decodeHitachiAc264(sendHitachiAc264(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildHitachiAc264Raw(decoded!))).toBe(toHex(buildHitachiAc264Raw(state)));
  });
});

describe("decodeHitachiAc264 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`hitachiAc264 ${tc.cppArgs}`).split("\n")[1]!);
      const decoded = decodeHitachiAc264(cppTimings);
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAc264Raw(decoded!))).toBe(toHex(buildHitachiAc264Raw(tc.state)));
    });
  }
});

describe("decodeHitachiAc264 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeHitachiAc264([])).toBeNull();
    expect(decodeHitachiAc264([1, 2, 3])).toBeNull();
  });
  it("rejects broken byte-pair inversion", () => {
    const raw = buildHitachiAc264Raw(cases[0]!.state);
    raw[12] = (raw[12]! ^ 0xFF) & 0xFF;
    expect(decodeHitachiAc264(encodeHitachiAc264Raw(raw, 0))).toBeNull();
  });
});
