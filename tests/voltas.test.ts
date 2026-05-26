import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildVoltasRaw,
  encodeVoltasRaw,
  sendVoltas,
  decodeVoltas,
  parseVoltasState,
  VoltasMode,
  VoltasFan,
  VoltasModel,
} from "../src/protocols/voltas";
import type { VoltasState } from "../src/protocols/voltas";

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
  state: VoltasState;
  /** C++ args order:
   * power temp mode fan swingV swingH turbo econo sleep light wifi onTime offTime model */
  cppArgs: string;
}

const cases: TC[] = [
  {
    label: "default cool 24 auto LZF",
    state: { power: true, temp: 24, mode: VoltasMode.Cool, fan: VoltasFan.Auto, model: VoltasModel.LZF },
    cppArgs: "1 24 8 7 0 0 0 0 0 0 0 0 0 1",
  },
  {
    label: "heat 28 high LZF",
    state: { power: true, temp: 28, mode: VoltasMode.Heat, fan: VoltasFan.High, model: VoltasModel.LZF },
    cppArgs: "1 28 2 1 0 0 0 0 0 0 0 0 0 1",
  },
  {
    label: "dry 24 low LZF",
    state: { power: true, temp: 24, mode: VoltasMode.Dry, fan: VoltasFan.Low, model: VoltasModel.LZF },
    cppArgs: "1 24 4 4 0 0 0 0 0 0 0 0 0 1",
  },
  {
    label: "fan mode high (auto downgraded) LZF",
    state: { power: true, temp: 24, mode: VoltasMode.Fan, fan: VoltasFan.High, model: VoltasModel.LZF },
    cppArgs: "1 24 1 1 0 0 0 0 0 0 0 0 0 1",
  },
  {
    label: "cool 16 with turbo+sleep+econo LZF",
    state: {
      power: true, temp: 16, mode: VoltasMode.Cool, fan: VoltasFan.Med,
      turbo: true, sleep: true, econo: true, model: VoltasModel.LZF,
    },
    cppArgs: "1 16 8 2 0 0 1 1 1 0 0 0 0 1",
  },
  {
    label: "cool 30 with swingV light wifi LZF",
    state: {
      power: true, temp: 30, mode: VoltasMode.Cool, fan: VoltasFan.High,
      swingV: true, light: true, wifi: true, model: VoltasModel.LZF,
    },
    cppArgs: "1 30 8 1 1 0 0 0 0 1 1 0 0 1",
  },
  {
    label: "power off",
    state: { power: false, temp: 24, mode: VoltasMode.Cool, fan: VoltasFan.Auto, model: VoltasModel.LZF },
    cppArgs: "0 24 8 7 0 0 0 0 0 0 0 0 0 1",
  },
  // Full-feature model (Unknown) supports SwingH
  {
    label: "full model with swingH on",
    state: {
      power: true, temp: 22, mode: VoltasMode.Cool, fan: VoltasFan.High,
      swingH: true, model: VoltasModel.Unknown,
    },
    cppArgs: "1 22 8 1 0 1 0 0 0 0 0 0 0 0",
  },
  {
    label: "full model with swingH off",
    state: {
      power: true, temp: 22, mode: VoltasMode.Cool, fan: VoltasFan.High,
      swingH: false, model: VoltasModel.Unknown,
    },
    cppArgs: "1 22 8 1 0 0 0 0 0 0 0 0 0 0",
  },
  // Timers
  {
    label: "with onTime 1 hour LZF",
    state: {
      power: true, temp: 24, mode: VoltasMode.Cool, fan: VoltasFan.Auto,
      onTime: 60, model: VoltasModel.LZF,
    },
    cppArgs: "1 24 8 7 0 0 0 0 0 0 0 60 0 1",
  },
  {
    label: "with offTime 12 hours LZF",
    state: {
      power: true, temp: 24, mode: VoltasMode.Cool, fan: VoltasFan.Auto,
      offTime: 720, model: VoltasModel.LZF,
    },
    cppArgs: "1 24 8 7 0 0 0 0 0 0 0 0 720 1",
  },
  {
    label: "max timer 23h59m LZF",
    state: {
      power: true, temp: 24, mode: VoltasMode.Cool, fan: VoltasFan.Auto,
      onTime: 1439, offTime: 1439, model: VoltasModel.LZF,
    },
    cppArgs: "1 24 8 7 0 0 0 0 0 0 0 1439 1439 1",
  },
];

describe("voltas state cross-validation", () => {
  for (const tc of cases) {
    it(`raw bytes match C++ for ${tc.label}`, () => {
      const output = cpp(`voltas ${tc.cppArgs}`);
      const lines = output.split("\n");
      const cppRawHex = lines[0]!;

      const tsRaw = buildVoltasRaw(tc.state);
      let tsRawHex = "";
      for (let i = 0; i < tsRaw.length; i++) {
        tsRawHex += tsRaw[i]!.toString(16).toUpperCase().padStart(2, "0");
      }

      expect(tsRawHex).toBe(cppRawHex);
    });

    it(`timings match C++ for ${tc.label}`, () => {
      const output = cpp(`voltas ${tc.cppArgs}`);
      const lines = output.split("\n");
      const cppTimings = parseCppTimings(lines[1]!);

      const tsTimings = sendVoltas(tc.state);
      // C++ adds final gap; we don't.
      expect(tsTimings.length).toBe(cppTimings.length);
      expect(tsTimings.slice(0, -1)).toEqual(cppTimings.slice(0, -1));
    });
  }
});

// ---------------------------------------------------------------------------
// Raw send cross-validation
// ---------------------------------------------------------------------------

describe("encodeVoltasRaw cross-validation", () => {
  it("timings match C++ for default state", () => {
    const data = new Uint8Array([0x33, 0x28, 0x00, 0x17, 0x3B, 0x3B, 0x3B, 0x11, 0x00, 0xCB]);
    let hex = "";
    for (let i = 0; i < data.length; i++) hex += data[i]!.toString(16).padStart(2, "0");

    const cppTimings = parseCppTimings(cpp(`sendVoltas ${hex} 0`));
    const tsTimings = encodeVoltasRaw(data, 0);

    expect(tsTimings.length).toBe(cppTimings.length);
    expect(tsTimings.slice(0, -1)).toEqual(cppTimings.slice(0, -1));
  });
});

// ---------------------------------------------------------------------------
// Decode roundtrip: sendVoltas → decodeVoltas → buildVoltasRaw
// ---------------------------------------------------------------------------

describe("decodeVoltas roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildVoltasRaw(tc.state);
      const timings = sendVoltas(tc.state);
      const decoded = decodeVoltas(timings);
      expect(decoded).not.toBeNull();
      const decodedRaw = buildVoltasRaw(decoded!);
      expect(Array.from(decodedRaw)).toEqual(Array.from(raw));
    });
  }
});

// ---------------------------------------------------------------------------
// Decode C++ cross-validation: C++ encode → TS decode
// ---------------------------------------------------------------------------

describe("decodeVoltas C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const output = cpp(`voltas ${tc.cppArgs}`);
      const lines = output.split("\n");
      const cppRawHex = lines[0]!;
      const cppTimings = parseCppTimings(lines[1]!);

      const decoded = decodeVoltas(cppTimings);
      expect(decoded).not.toBeNull();

      const decodedRaw = buildVoltasRaw(decoded!);
      let decodedHex = "";
      for (let i = 0; i < decodedRaw.length; i++) {
        decodedHex += decodedRaw[i]!.toString(16).toUpperCase().padStart(2, "0");
      }
      expect(decodedHex).toBe(cppRawHex);
    });
  }
});

// ---------------------------------------------------------------------------
// parseVoltasState
// ---------------------------------------------------------------------------

describe("parseVoltasState", () => {
  it("parses default kReset state", () => {
    const raw = new Uint8Array([0x33, 0x28, 0x00, 0x17, 0x3B, 0x3B, 0x3B, 0x11, 0x00, 0xCB]);
    const state = parseVoltasState(raw);
    expect(state.model).toBe(VoltasModel.LZF);
    expect(state.power).toBe(false);
    expect(state.mode).toBe(VoltasMode.Cool);
    expect(state.temp).toBe(23);
    expect(state.fan).toBe(VoltasFan.High);
    expect(state.swingV).toBe(false);
    expect(state.turbo).toBe(false);
    expect(state.sleep).toBe(false);
    expect(state.econo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

describe("decodeVoltas rejection", () => {
  it("rejects empty timings", () => {
    expect(decodeVoltas([])).toBeNull();
  });

  it("rejects timings that are too short", () => {
    expect(decodeVoltas([1, 2, 3])).toBeNull();
  });

  it("rejects bad checksum", () => {
    const data = new Uint8Array([0x33, 0x28, 0x00, 0x17, 0x3B, 0x3B, 0x3B, 0x11, 0x00, 0x00]);
    const timings = encodeVoltasRaw(data, 0);
    expect(decodeVoltas(timings)).toBeNull();
  });

  it("rejects garbage data", () => {
    const garbage = Array.from({ length: 200 }, () => Math.floor(Math.random() * 100));
    expect(decodeVoltas(garbage)).toBeNull();
  });
});
