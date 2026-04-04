import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  sendDaikin152,
  encodeDaikin152Raw,
  buildDaikin152Raw,
  DaikinMode,
  DaikinFan,
} from "../src/protocols/daikin152";
import type { Daikin152State } from "../src/protocols/daikin152";

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

describe("sendDaikin152 raw cross-validation", () => {
  it("matches C++ for default state bytes", () => {
    const raw = buildDaikin152Raw({});
    const hexStr = toHex(raw);

    const cppTimings = parseCppTimings(cpp(`sendDaikin152 ${hexStr}`));
    const tsTimings = encodeDaikin152Raw(raw, 0);
    expect(tsTimings).toEqual(cppTimings);
  });
});

// ---------------------------------------------------------------------------
// State cross-validation
// ---------------------------------------------------------------------------

interface TestCase {
  label: string;
  state: Daikin152State;
  // C++ args: power temp mode fan swingV quiet powerful econo sensor comfort
  cppArgs: string;
}

const cases: TestCase[] = [
  {
    label: "cool 22°C fan auto swing on",
    state: {
      power: true,
      temp: 22,
      mode: DaikinMode.Cool,
      fan: DaikinFan.Auto,
      swingVertical: true,
    },
    cppArgs: "1 22 3 10 1 0 0 0 0 0",
  },
  {
    label: "heat 28°C fan max",
    state: {
      power: true,
      temp: 28,
      mode: DaikinMode.Heat,
      fan: 5,
      swingVertical: false,
    },
    cppArgs: "1 28 4 5 0 0 0 0 0 0",
  },
  {
    label: "dry mode (temp forced to 18)",
    state: {
      power: false,
      temp: 25,
      mode: DaikinMode.Dry,
      fan: DaikinFan.Auto,
    },
    cppArgs: "0 25 2 10 0 0 0 0 0 0",
  },
  {
    label: "fan mode (temp forced to 0x60)",
    state: {
      power: true,
      temp: 22,
      mode: DaikinMode.Fan,
      fan: 3,
    },
    cppArgs: "1 22 6 3 0 0 0 0 0 0",
  },
  {
    label: "auto mode 25°C",
    state: {
      power: true,
      temp: 25,
      mode: DaikinMode.Auto,
      fan: DaikinFan.Auto,
    },
    cppArgs: "1 25 0 10 0 0 0 0 0 0",
  },
  {
    label: "quiet mode",
    state: {
      power: true,
      temp: 24,
      mode: DaikinMode.Cool,
      fan: DaikinFan.Quiet,
      quiet: true,
    },
    cppArgs: "1 24 3 11 0 1 0 0 0 0",
  },
  {
    label: "powerful mode",
    state: {
      power: true,
      temp: 20,
      mode: DaikinMode.Cool,
      fan: DaikinFan.Auto,
      powerful: true,
    },
    cppArgs: "1 20 3 10 0 0 1 0 0 0",
  },
  {
    label: "econo + sensor",
    state: {
      power: true,
      temp: 26,
      mode: DaikinMode.Cool,
      fan: 2,
      econo: true,
      sensor: true,
    },
    cppArgs: "1 26 3 2 0 0 0 1 1 0",
  },
  {
    label: "comfort mode (forces fan auto, swing off)",
    state: {
      power: true,
      temp: 24,
      mode: DaikinMode.Cool,
      fan: 5,
      swingVertical: true,
      comfort: true,
    },
    cppArgs: "1 24 3 5 1 0 0 0 0 1",
  },
  {
    label: "min temp in cool mode (clamped to 18)",
    state: {
      power: false,
      temp: 10,
      mode: DaikinMode.Cool,
      fan: DaikinFan.Auto,
    },
    cppArgs: "0 10 3 10 0 0 0 0 0 0",
  },
  {
    label: "min temp in heat mode (clamped to 10)",
    state: {
      power: false,
      temp: 5,
      mode: DaikinMode.Heat,
      fan: DaikinFan.Auto,
    },
    cppArgs: "0 5 4 10 0 0 0 0 0 0",
  },
  {
    label: "max temp (clamped to 32)",
    state: {
      power: false,
      temp: 40,
      mode: DaikinMode.Cool,
      fan: DaikinFan.Auto,
    },
    cppArgs: "0 40 3 10 0 0 0 0 0 0",
  },
  {
    label: "fan speeds 1-5",
    state: {
      power: true,
      temp: 24,
      mode: DaikinMode.Cool,
      fan: 1,
    },
    cppArgs: "1 24 3 1 0 0 0 0 0 0",
  },
];

describe("daikin152 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const output = cpp(`daikin152 ${tc.cppArgs}`);
      const lines = output.split("\n");
      const cppRawHex = lines[0]!;
      const cppTimings = parseCppTimings(lines[1]!);

      const tsRaw = buildDaikin152Raw(tc.state);
      const tsRawHex = toHex(tsRaw);

      // Compare raw state bytes
      expect(tsRawHex).toBe(cppRawHex);

      // Compare timings
      const tsTimings = encodeDaikin152Raw(tsRaw, 0);
      expect(tsTimings).toEqual(cppTimings);
    });
  }
});
