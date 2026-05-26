import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  sendHitachiAc424,
  encodeHitachiAc424Raw,
  buildHitachiAc424Raw,
  decodeHitachiAc424,
  HitachiAc424Mode,
  HitachiAc424Fan,
} from "../src/protocols/hitachi424";
import type { HitachiAc424State } from "../src/protocols/hitachi424";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}

function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}

function parseCppTimings(output: string): number[] {
  return output.split(",").map(Number);
}

function toHex(arr: Uint8Array): string {
  return Array.from(arr).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}

beforeAll(() => {
  ensureRunner();
});

describe("sendHitachiAc424 raw cross-validation", () => {
  it("matches C++ for a default-state payload (incl. leader)", () => {
    const raw = buildHitachiAc424Raw({});
    const cppTimings = parseCppTimings(cpp(`sendHitachiAc424 ${toHex(raw)}`));
    expect(encodeHitachiAc424Raw(raw, 0)).toEqual(cppTimings);
  });
});

interface TestCase {
  label: string;
  state: HitachiAc424State;
  // C++ args: power temp mode fan swingVToggle
  cppArgs: string;
}

const cases: TestCase[] = [
  { label: "cool 23°C fan auto", state: { power: true, temp: 23, mode: HitachiAc424Mode.Cool, fan: HitachiAc424Fan.Auto }, cppArgs: "1 23 3 5 0" },
  { label: "heat 30°C fan high", state: { power: true, temp: 30, mode: HitachiAc424Mode.Heat, fan: HitachiAc424Fan.High }, cppArgs: "1 30 6 4 0" },
  { label: "fan mode + swingV toggle", state: { power: true, temp: 23, mode: HitachiAc424Mode.Fan, fan: HitachiAc424Fan.Auto, swingVToggle: true }, cppArgs: "1 23 1 5 1" },
  { label: "dry 20°C off", state: { power: false, temp: 20, mode: HitachiAc424Mode.Dry, fan: HitachiAc424Fan.Auto }, cppArgs: "0 20 5 5 0" },
  { label: "cool 16°C fan max", state: { power: true, temp: 16, mode: HitachiAc424Mode.Cool, fan: HitachiAc424Fan.Max }, cppArgs: "1 16 3 6 0" },
  { label: "cool 25°C fan min", state: { power: true, temp: 25, mode: HitachiAc424Mode.Cool, fan: HitachiAc424Fan.Min }, cppArgs: "1 25 3 1 0" },
];

describe("hitachiAc424 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const lines = cpp(`hitachiAc424 ${tc.cppArgs}`).split("\n");
      expect(toHex(buildHitachiAc424Raw(tc.state))).toBe(lines[0]!);
      expect(encodeHitachiAc424Raw(buildHitachiAc424Raw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
});

describe("decodeHitachiAc424 roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const decoded = decodeHitachiAc424(sendHitachiAc424(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAc424Raw(decoded!))).toBe(toHex(buildHitachiAc424Raw(tc.state)));
    });
  }

  it("decodes without the leader", () => {
    const state = cases[0]!.state;
    const noLeader = sendHitachiAc424(state).slice(2); // drop leader mark + space
    const decoded = decodeHitachiAc424(noLeader);
    expect(decoded).not.toBeNull();
    expect(toHex(buildHitachiAc424Raw(decoded!))).toBe(toHex(buildHitachiAc424Raw(state)));
  });

  it("decodes without leader or header", () => {
    const state = cases[1]!.state;
    const stripped = sendHitachiAc424(state).slice(4); // drop leader + header
    const decoded = decodeHitachiAc424(stripped, 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildHitachiAc424Raw(decoded!))).toBe(toHex(buildHitachiAc424Raw(state)));
  });
});

describe("decodeHitachiAc424 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`hitachiAc424 ${tc.cppArgs}`).split("\n")[1]!);
      const decoded = decodeHitachiAc424(cppTimings);
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAc424Raw(decoded!))).toBe(toHex(buildHitachiAc424Raw(tc.state)));
    });
  }
});

describe("decodeHitachiAc424 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeHitachiAc424([])).toBeNull();
    expect(decodeHitachiAc424([1, 2, 3])).toBeNull();
  });

  it("rejects broken byte-pair inversion", () => {
    const raw = buildHitachiAc424Raw(cases[0]!.state);
    raw[12] = (raw[12]! ^ 0xFF) & 0xFF; // break the inverse of byte 11
    expect(decodeHitachiAc424(encodeHitachiAc424Raw(raw, 0))).toBeNull();
  });
});
