import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  sendHitachiAc,
  encodeHitachiAcRaw,
  buildHitachiAcRaw,
  decodeHitachiAc,
  HitachiAcMode,
  HitachiAcFan,
} from "../src/protocols/hitachi";
import type { HitachiAcState } from "../src/protocols/hitachi";

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

// ---------------------------------------------------------------------------
// Raw send cross-validation
// ---------------------------------------------------------------------------

describe("sendHitachiAc raw cross-validation", () => {
  it("matches C++ for default state bytes", () => {
    const raw = buildHitachiAcRaw({});
    const cppTimings = parseCppTimings(cpp(`sendHitachiAc ${toHex(raw)}`));
    expect(encodeHitachiAcRaw(raw, 0)).toEqual(cppTimings);
  });
});

// ---------------------------------------------------------------------------
// State cross-validation
// ---------------------------------------------------------------------------

interface TestCase {
  label: string;
  state: HitachiAcState;
  // C++ args: power temp mode fan swingV swingH
  cppArgs: string;
}

const cases: TestCase[] = [
  {
    label: "cool 23°C fan auto",
    state: { power: true, temp: 23, mode: HitachiAcMode.Cool, fan: HitachiAcFan.Auto },
    cppArgs: "1 23 4 1 0 0",
  },
  {
    label: "cool 28°C fan high, both swings",
    state: { power: true, temp: 28, mode: HitachiAcMode.Cool, fan: HitachiAcFan.High, swingV: true, swingH: true },
    cppArgs: "1 28 4 5 1 1",
  },
  {
    label: "heat 30°C fan med swingV",
    state: { power: true, temp: 30, mode: HitachiAcMode.Heat, fan: HitachiAcFan.Med, swingV: true },
    cppArgs: "1 30 3 3 1 0",
  },
  {
    label: "auto 25°C fan auto",
    state: { power: true, temp: 25, mode: HitachiAcMode.Auto, fan: HitachiAcFan.Auto },
    cppArgs: "1 25 2 1 0 0",
  },
  {
    label: "dry 20°C fan med (clamped to low range)",
    state: { power: false, temp: 20, mode: HitachiAcMode.Dry, fan: HitachiAcFan.Med },
    cppArgs: "0 20 5 3 0 0",
  },
  {
    label: "fan mode (special temp, low fan)",
    state: { power: true, mode: HitachiAcMode.Fan, fan: HitachiAcFan.Low },
    cppArgs: "1 23 12 2 0 0",
  },
  {
    label: "min temp 16°C (sets raw[9]=0x90)",
    state: { power: true, temp: 16, mode: HitachiAcMode.Cool, fan: HitachiAcFan.Auto },
    cppArgs: "1 16 4 1 0 0",
  },
  {
    label: "power off",
    state: { power: false, temp: 24, mode: HitachiAcMode.Cool, fan: HitachiAcFan.High },
    cppArgs: "0 24 4 5 0 0",
  },
];

describe("hitachiAc state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const output = cpp(`hitachiAc ${tc.cppArgs}`);
      const lines = output.split("\n");
      const cppRawHex = lines[0]!;
      const cppTimings = parseCppTimings(lines[1]!);

      const tsRaw = buildHitachiAcRaw(tc.state);
      expect(toHex(tsRaw)).toBe(cppRawHex);
      expect(encodeHitachiAcRaw(tsRaw, 0)).toEqual(cppTimings);
    });
  }
});

// ---------------------------------------------------------------------------
// Decode roundtrip
// ---------------------------------------------------------------------------

describe("decodeHitachiAc roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const timings = sendHitachiAc(tc.state);
      const decoded = decodeHitachiAc(timings);
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAcRaw(decoded!))).toBe(toHex(buildHitachiAcRaw(tc.state)));
    });
  }

  it("decodes without a header", () => {
    const state = cases[1]!.state;
    const timings = sendHitachiAc(state);
    const noHeader = timings.slice(2); // drop header mark + space
    const decoded = decodeHitachiAc(noHeader, 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildHitachiAcRaw(decoded!))).toBe(toHex(buildHitachiAcRaw(state)));
  });
});

describe("decodeHitachiAc C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`hitachiAc ${tc.cppArgs}`).split("\n")[1]!);
      const decoded = decodeHitachiAc(cppTimings);
      expect(decoded).not.toBeNull();
      expect(toHex(buildHitachiAcRaw(decoded!))).toBe(toHex(buildHitachiAcRaw(tc.state)));
    });
  }
});

describe("decodeHitachiAc rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeHitachiAc([])).toBeNull();
    expect(decodeHitachiAc([1, 2, 3])).toBeNull();
    const garbage = Array.from({ length: 600 }, () => Math.floor(Math.random() * 100));
    expect(decodeHitachiAc(garbage)).toBeNull();
  });

  it("rejects a corrupted checksum", () => {
    const raw = buildHitachiAcRaw(cases[0]!.state);
    raw[27] = (raw[27]! ^ 0xFF) & 0xFF;
    const timings = encodeHitachiAcRaw(raw, 0);
    expect(decodeHitachiAc(timings)).toBeNull();
  });
});
