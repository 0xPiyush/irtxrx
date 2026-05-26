import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  sendHitachiAc296,
  encodeHitachiAc296Raw,
  buildHitachiAc296Raw,
  decodeHitachiAc296,
  HitachiAc296Mode,
  HitachiAc296Fan,
} from "../src/protocols/hitachi296";
import type { HitachiAc296State } from "../src/protocols/hitachi296";

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

interface TestCase { label: string; state: HitachiAc296State; cppArgs: string; }

const cases: TestCase[] = [
  { label: "heat 24°C fan auto", state: { power: true, temp: 24, mode: HitachiAc296Mode.Heat, fan: HitachiAc296Fan.Auto }, cppArgs: "1 24 6 5" },
  { label: "cool 28°C fan high", state: { power: true, temp: 28, mode: HitachiAc296Mode.Cool, fan: HitachiAc296Fan.High }, cppArgs: "1 28 3 4" },
  { label: "dehumidify 20°C fan silent", state: { power: true, temp: 20, mode: HitachiAc296Mode.Dehumidify, fan: HitachiAc296Fan.Silent }, cppArgs: "1 20 5 1" },
  { label: "auto mode (special temp)", state: { power: true, temp: 25, mode: HitachiAc296Mode.Auto, fan: HitachiAc296Fan.Auto }, cppArgs: "1 25 7 5" },
  { label: "cool 16°C fan low off", state: { power: false, temp: 16, mode: HitachiAc296Mode.Cool, fan: HitachiAc296Fan.Low }, cppArgs: "0 16 3 2" },
];

describe("hitachiAc296 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const lines = cpp(`hitachiAc296 ${tc.cppArgs}`).split("\n");
      expect(toHex(buildHitachiAc296Raw(tc.state))).toBe(lines[0]!);
      expect(encodeHitachiAc296Raw(buildHitachiAc296Raw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
});

describe("decodeHitachiAc296 roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const decoded = decodeHitachiAc296(sendHitachiAc296(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAc296Raw(decoded!))).toBe(toHex(buildHitachiAc296Raw(tc.state)));
    });
  }
  it("decodes without a header", () => {
    const state = cases[1]!.state;
    const decoded = decodeHitachiAc296(sendHitachiAc296(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildHitachiAc296Raw(decoded!))).toBe(toHex(buildHitachiAc296Raw(state)));
  });
});

describe("decodeHitachiAc296 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`hitachiAc296 ${tc.cppArgs}`).split("\n")[1]!);
      const decoded = decodeHitachiAc296(cppTimings);
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAc296Raw(decoded!))).toBe(toHex(buildHitachiAc296Raw(tc.state)));
    });
  }
});

describe("decodeHitachiAc296 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeHitachiAc296([])).toBeNull();
    expect(decodeHitachiAc296([1, 2, 3])).toBeNull();
  });
  it("rejects broken byte-pair inversion", () => {
    const raw = buildHitachiAc296Raw(cases[0]!.state);
    raw[12] = (raw[12]! ^ 0xFF) & 0xFF;
    expect(decodeHitachiAc296(encodeHitachiAc296Raw(raw, 0))).toBeNull();
  });
});
