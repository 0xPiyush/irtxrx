import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildCoolixRaw,
  encodeCoolixRaw,
  sendCoolix,
  decodeCoolixRaw,
  decodeCoolix,
  parseCoolixState,
  CoolixMode,
  CoolixFan,
  CoolixCommand,
} from "../src/protocols/coolix";
import type { CoolixState } from "../src/protocols/coolix";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) {
    execSync("make", { cwd: `${import.meta.dir}/cpp` });
  }
}

function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}

function parseCppTimings(s: string): number[] {
  return s.split(",").map(Number);
}

beforeAll(() => {
  ensureRunner();
});

// ---------------------------------------------------------------------------
// State encode cross-validation against C++
// ---------------------------------------------------------------------------

interface TC {
  label: string;
  state: CoolixState;
  /** C++ runner args: temp mode fan [sensorTemp] */
  cppArgs: string;
}

const cases: TC[] = [
  { label: "cool 24°C auto", state: { temp: 24, mode: CoolixMode.Cool, fan: CoolixFan.Auto }, cppArgs: "24 0 5" },
  { label: "heat 28°C max", state: { temp: 28, mode: CoolixMode.Heat, fan: CoolixFan.Max }, cppArgs: "28 3 1" },
  { label: "auto 25°C auto", state: { temp: 25, mode: CoolixMode.Auto, fan: CoolixFan.Auto }, cppArgs: "25 2 5" },
  { label: "dry 22°C med", state: { temp: 22, mode: CoolixMode.Dry, fan: CoolixFan.Med }, cppArgs: "22 1 2" },
  { label: "fan mode", state: { mode: CoolixMode.Fan, fan: CoolixFan.Auto }, cppArgs: "25 4 5" },
  { label: "cool 17°C min", state: { temp: 17, mode: CoolixMode.Cool, fan: CoolixFan.Min }, cppArgs: "17 0 4" },
  { label: "cool 30°C max", state: { temp: 30, mode: CoolixMode.Cool, fan: CoolixFan.Max }, cppArgs: "30 0 1" },
  { label: "heat 20°C auto", state: { temp: 20, mode: CoolixMode.Heat, fan: CoolixFan.Auto }, cppArgs: "20 3 5" },
];

describe("coolix state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const output = cpp(`coolix ${tc.cppArgs}`);
      const lines = output.split("\n");
      const cppRawHex = lines[0]!;

      const tsRaw = buildCoolixRaw(tc.state);
      const tsRawHex = tsRaw.toString(16).toUpperCase().padStart(6, "0");

      expect(tsRawHex).toBe(cppRawHex);
    });
  }
});

// ---------------------------------------------------------------------------
// Raw send cross-validation (timings match C++)
// ---------------------------------------------------------------------------

describe("encodeCoolixRaw cross-validation", () => {
  const rawCases = [
    { label: "default state", data: 0xB21FC8 },
    { label: "cool 24", data: 0xB2BF40 },
    { label: "off command", data: 0xB27BE0 },
  ];

  for (const tc of rawCases) {
    it(`timings match C++ for ${tc.label}`, () => {
      const cppTimings = parseCppTimings(cpp(`sendCoolix ${tc.data.toString(16).toUpperCase()} 0`));
      const tsTimings = encodeCoolixRaw(tc.data, 0);

      // All entries match except the last gap (C++ adds kDefaultMessageGap).
      expect(tsTimings.length).toBe(cppTimings.length);
      expect(tsTimings.slice(0, -1)).toEqual(cppTimings.slice(0, -1));
    });
  }
});

// ---------------------------------------------------------------------------
// Decode roundtrip: sendCoolix → decodeCoolix → buildCoolixRaw
// ---------------------------------------------------------------------------

describe("decodeCoolix roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildCoolixRaw(tc.state);
      const timings = encodeCoolixRaw(raw, 1);
      const decoded = decodeCoolix(timings);
      expect(decoded).not.toBeNull();
      expect(buildCoolixRaw(decoded!)).toBe(raw);
    });
  }
});

// ---------------------------------------------------------------------------
// Decode C++ cross-validation: C++ encode → TS decode
// ---------------------------------------------------------------------------

describe("decodeCoolix C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const output = cpp(`coolix ${tc.cppArgs}`);
      const lines = output.split("\n");
      const cppTimings = parseCppTimings(lines[1]!);

      const decoded = decodeCoolix(cppTimings);
      expect(decoded).not.toBeNull();
      expect(buildCoolixRaw(decoded!).toString(16).toUpperCase().padStart(6, "0")).toBe(lines[0]!);
    });
  }
});

// ---------------------------------------------------------------------------
// decodeCoolixRaw
// ---------------------------------------------------------------------------

describe("decodeCoolixRaw", () => {
  it("decodes the raw 24-bit code", () => {
    const timings = encodeCoolixRaw(0xB21FC8, 0);
    const result = decodeCoolixRaw(timings);
    expect(result).not.toBeNull();
    expect(result!.data).toBe(0xB21FC8);
  });

  it("decodes with repeat=1 (two frames)", () => {
    const timings = encodeCoolixRaw(0xB21FC8, 1);
    // Decode first frame
    const first = decodeCoolixRaw(timings, 0);
    expect(first).not.toBeNull();
    expect(first!.data).toBe(0xB21FC8);

    // Decode second frame
    const second = decodeCoolixRaw(timings, first!.used);
    expect(second).not.toBeNull();
    expect(second!.data).toBe(0xB21FC8);
  });

  it("rejects corrupted inversion", () => {
    const timings = encodeCoolixRaw(0xB21FC8, 0);
    // Corrupt a timing in the inverted byte region
    timings[20] = 1;
    expect(decodeCoolixRaw(timings)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Command codes
// ---------------------------------------------------------------------------

describe("command codes", () => {
  it("decodeCoolixRaw returns command codes", () => {
    for (const [name, code] of Object.entries(CoolixCommand)) {
      const timings = encodeCoolixRaw(code, 0);
      const result = decodeCoolixRaw(timings);
      expect(result).not.toBeNull();
      expect(result!.data).toBe(code);
    }
  });

  it("decodeCoolix returns null for command codes", () => {
    const timings = encodeCoolixRaw(CoolixCommand.Off, 0);
    expect(decodeCoolix(timings)).toBeNull();
  });

  it("parseCoolixState returns null for command codes", () => {
    expect(parseCoolixState(CoolixCommand.Off)).toBeNull();
    expect(parseCoolixState(CoolixCommand.Swing)).toBeNull();
    expect(parseCoolixState(CoolixCommand.Sleep)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// power: false → Off command
// ---------------------------------------------------------------------------

describe("power off", () => {
  it("buildCoolixRaw returns Off command when power is false", () => {
    expect(buildCoolixRaw({ power: false })).toBe(CoolixCommand.Off);
    expect(buildCoolixRaw({ power: false, temp: 25, mode: CoolixMode.Cool, fan: CoolixFan.Auto })).toBe(CoolixCommand.Off);
  });

  it("sendCoolix with power: false produces decodable Off command", () => {
    const timings = sendCoolix({ power: false, temp: 25, mode: CoolixMode.Cool });
    const raw = decodeCoolixRaw(timings);
    expect(raw).not.toBeNull();
    expect(raw!.data).toBe(CoolixCommand.Off);
  });

  it("power: true encodes normal state (power field ignored)", () => {
    const withPower = buildCoolixRaw({ power: true, temp: 24, mode: CoolixMode.Cool, fan: CoolixFan.Auto });
    const without = buildCoolixRaw({ temp: 24, mode: CoolixMode.Cool, fan: CoolixFan.Auto });
    expect(withPower).toBe(without);
  });
});

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

describe("decodeCoolix rejection", () => {
  it("rejects empty timings", () => {
    expect(decodeCoolixRaw([])).toBeNull();
    expect(decodeCoolix([])).toBeNull();
  });

  it("rejects timings that are too short", () => {
    expect(decodeCoolixRaw([1, 2, 3])).toBeNull();
  });

  it("rejects garbage data", () => {
    const garbage = Array.from({ length: 100 }, () => Math.floor(Math.random() * 100));
    expect(decodeCoolixRaw(garbage)).toBeNull();
  });
});
