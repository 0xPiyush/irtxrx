import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  sendDaikin64,
  encodeDaikin64Raw,
  buildDaikin64Raw,
  Daikin64Mode,
  Daikin64Fan,
} from "../src/protocols/daikin64";
import type { Daikin64State } from "../src/protocols/daikin64";

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

beforeAll(() => {
  ensureRunner();
});

// ---------------------------------------------------------------------------
// Raw sendDaikin64 cross-validation
// ---------------------------------------------------------------------------

describe("sendDaikin64 raw cross-validation", () => {
  const rawCases: { label: string; dataHex: string; data: bigint }[] = [
    {
      label: "known good state",
      dataHex: "7C16161607204216",
      data: 0x7c16161607204216n,
    },
    { label: "all zeros", dataHex: "0", data: 0n },
    { label: "all ones", dataHex: "FFFFFFFFFFFFFFFF", data: 0xffffffffffffffffn },
    {
      label: "alternating",
      dataHex: "AA55AA55AA55AA55",
      data: 0xaa55aa55aa55aa55n,
    },
  ];

  for (const tc of rawCases) {
    it(`matches C++ for raw ${tc.label}`, () => {
      const cppOutput = parseCppTimings(cpp(`sendDaikin64 ${tc.dataHex} 0`));
      const tsOutput = encodeDaikin64Raw(tc.data, 0);
      expect(tsOutput).toEqual(cppOutput);
    });
  }

  it("matches C++ with repeat=1", () => {
    const dataHex = "7C16161607204216";
    const cppOutput = parseCppTimings(cpp(`sendDaikin64 ${dataHex} 1`));
    const tsOutput = encodeDaikin64Raw(0x7c16161607204216n, 1);
    expect(tsOutput).toEqual(cppOutput);
  });
});

// ---------------------------------------------------------------------------
// Daikin64 state → timings cross-validation
// ---------------------------------------------------------------------------

interface Daikin64TestCase {
  label: string;
  state: Daikin64State;
  // C++ runner args: power temp mode fan swingV sleep clock
  cppArgs: string;
}

const stateCases: Daikin64TestCase[] = [
  {
    label: "cool 22°C fan auto",
    state: {
      power: false,
      temp: 22,
      mode: Daikin64Mode.Cool,
      fan: Daikin64Fan.Auto,
      swingVertical: false,
      sleep: false,
      clock: 720,
    },
    cppArgs: "0 22 2 1 0 0 720",
  },
  {
    label: "heat 28°C fan high, power on",
    state: {
      power: true,
      temp: 28,
      mode: Daikin64Mode.Heat,
      fan: Daikin64Fan.High,
      swingVertical: true,
      sleep: false,
      clock: 0,
    },
    cppArgs: "1 28 8 2 1 0 0",
  },
  {
    label: "dry 24°C fan low, sleep on",
    state: {
      power: false,
      temp: 24,
      mode: Daikin64Mode.Dry,
      fan: Daikin64Fan.Low,
      swingVertical: false,
      sleep: true,
      clock: 1380,
    },
    cppArgs: "0 24 1 8 0 1 1380",
  },
  {
    label: "fan mode 20°C fan med",
    state: {
      power: true,
      temp: 20,
      mode: Daikin64Mode.Fan,
      fan: Daikin64Fan.Med,
      swingVertical: true,
      sleep: true,
      clock: 60,
    },
    cppArgs: "1 20 4 4 1 1 60",
  },
  {
    label: "cool 16°C (min) turbo",
    state: {
      power: true,
      temp: 16,
      mode: Daikin64Mode.Cool,
      fan: Daikin64Fan.Turbo,
      swingVertical: false,
      sleep: false,
      clock: 450,
    },
    cppArgs: "1 16 2 3 0 0 450",
  },
  {
    label: "heat 30°C (max) quiet",
    state: {
      power: false,
      temp: 30,
      mode: Daikin64Mode.Heat,
      fan: Daikin64Fan.Quiet,
      swingVertical: true,
      sleep: false,
      clock: 1200,
    },
    cppArgs: "0 30 8 9 1 0 1200",
  },
  {
    label: "temp below min (clamped to 16)",
    state: {
      power: false,
      temp: 10,
      mode: Daikin64Mode.Cool,
      fan: Daikin64Fan.Auto,
      swingVertical: false,
      sleep: false,
      clock: 0,
    },
    cppArgs: "0 10 2 1 0 0 0",
  },
  {
    label: "temp above max (clamped to 30)",
    state: {
      power: false,
      temp: 40,
      mode: Daikin64Mode.Cool,
      fan: Daikin64Fan.Auto,
      swingVertical: false,
      sleep: false,
      clock: 0,
    },
    cppArgs: "0 40 2 1 0 0 0",
  },
];

describe("daikin64 state cross-validation", () => {
  for (const tc of stateCases) {
    it(`matches C++ for ${tc.label}`, () => {
      // Get C++ output: first line is raw hex, second is timings
      const output = cpp(`daikin64 ${tc.cppArgs}`);
      const lines = output.split("\n");
      const cppRawHex = lines[0]!;
      const cppTimings = parseCppTimings(lines[1]!);

      // Build raw state from TS
      const tsRaw = buildDaikin64Raw(tc.state);
      const tsRawHex = tsRaw.toString(16).toUpperCase().padStart(16, "0");

      // Compare raw state bytes
      expect(tsRawHex).toBe(cppRawHex);

      // Compare timings
      const tsTimings = encodeDaikin64Raw(tsRaw, 0);
      expect(tsTimings).toEqual(cppTimings);
    });
  }
});
