import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  sendHitachiAc1,
  encodeHitachiAc1Raw,
  buildHitachiAc1Raw,
  decodeHitachiAc1,
  HitachiAc1Mode,
  HitachiAc1Fan,
  HitachiAc1Model,
} from "../src/protocols/hitachi1";
import type { HitachiAc1State } from "../src/protocols/hitachi1";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) {
    execSync("make", { cwd: `${import.meta.dir}/cpp` });
  }
}

function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}

function parseCppTimings(output: string): number[] {
  return output.split(",").map(Number);
}

function toHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join("");
}

beforeAll(() => {
  ensureRunner();
});

describe("sendHitachiAc1 raw cross-validation", () => {
  it("matches C++ for default state bytes", () => {
    const raw = buildHitachiAc1Raw({});
    const cppTimings = parseCppTimings(cpp(`sendHitachiAc1 ${toHex(raw)}`));
    expect(encodeHitachiAc1Raw(raw, 0)).toEqual(cppTimings);
  });
});

interface TestCase {
  label: string;
  state: HitachiAc1State;
  // C++ args: power temp mode fan swingV swingH swingToggle sleep onTimer
  //           offTimer powerToggle model
  cppArgs: string;
}

const cases: TestCase[] = [
  {
    label: "auto 25°C fan auto (temp locked)",
    state: { power: true, temp: 25, mode: HitachiAc1Mode.Auto, fan: HitachiAc1Fan.Auto, model: HitachiAc1Model.A },
    cppArgs: "1 25 14 1 0 0 0 0 0 0 0 1",
  },
  {
    label: "cool 22°C fan high swingV sleep2",
    state: { power: true, temp: 22, mode: HitachiAc1Mode.Cool, fan: HitachiAc1Fan.High, swingV: true, sleep: 2, model: HitachiAc1Model.A },
    cppArgs: "1 22 6 2 1 0 0 2 0 0 0 1",
  },
  {
    label: "heat 28°C (fan forced low by quirk)",
    state: { power: true, temp: 28, mode: HitachiAc1Mode.Heat, fan: HitachiAc1Fan.High, model: HitachiAc1Model.A },
    cppArgs: "1 28 9 2 0 0 0 0 0 0 0 1",
  },
  {
    label: "dry 20°C (fan locked low)",
    state: { power: true, temp: 20, mode: HitachiAc1Mode.Dry, fan: HitachiAc1Fan.High, model: HitachiAc1Model.A },
    cppArgs: "1 20 2 2 0 0 0 0 0 0 0 1",
  },
  {
    label: "fan mode med",
    state: { power: true, temp: 24, mode: HitachiAc1Mode.Fan, fan: HitachiAc1Fan.Med, model: HitachiAc1Model.A },
    cppArgs: "1 24 4 4 0 0 0 0 0 0 0 1",
  },
  {
    label: "model B, timers, toggles, off",
    state: { power: false, temp: 24, mode: HitachiAc1Mode.Cool, fan: HitachiAc1Fan.Med, swingH: true, swingToggle: true, onTimer: 90, offTimer: 120, powerToggle: true, model: HitachiAc1Model.B },
    cppArgs: "0 24 6 4 0 1 1 0 90 120 1 2",
  },
  {
    label: "cool 30°C med, both swings",
    state: { power: true, temp: 30, mode: HitachiAc1Mode.Cool, fan: HitachiAc1Fan.Med, swingV: true, swingH: true, model: HitachiAc1Model.A },
    cppArgs: "1 30 6 4 1 1 0 0 0 0 0 1",
  },
];

describe("hitachiAc1 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const lines = cpp(`hitachiAc1 ${tc.cppArgs}`).split("\n");
      expect(toHex(buildHitachiAc1Raw(tc.state))).toBe(lines[0]!);
      expect(encodeHitachiAc1Raw(buildHitachiAc1Raw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
});

describe("decodeHitachiAc1 roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const decoded = decodeHitachiAc1(sendHitachiAc1(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAc1Raw(decoded!))).toBe(toHex(buildHitachiAc1Raw(tc.state)));
    });
  }

  it("decodes without a header", () => {
    const state = cases[1]!.state;
    const noHeader = sendHitachiAc1(state).slice(2);
    const decoded = decodeHitachiAc1(noHeader, 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildHitachiAc1Raw(decoded!))).toBe(toHex(buildHitachiAc1Raw(state)));
  });
});

describe("decodeHitachiAc1 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`hitachiAc1 ${tc.cppArgs}`).split("\n")[1]!);
      const decoded = decodeHitachiAc1(cppTimings);
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAc1Raw(decoded!))).toBe(toHex(buildHitachiAc1Raw(tc.state)));
    });
  }
});

describe("decodeHitachiAc1 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeHitachiAc1([])).toBeNull();
    expect(decodeHitachiAc1([1, 2, 3])).toBeNull();
  });

  it("rejects a corrupted checksum", () => {
    const raw = buildHitachiAc1Raw(cases[0]!.state);
    raw[12] = (raw[12]! ^ 0xFF) & 0xFF;
    expect(decodeHitachiAc1(encodeHitachiAc1Raw(raw, 0))).toBeNull();
  });
});
