import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildTecoRaw,
  encodeTecoRaw,
  sendTeco,
  decodeTeco,
  parseTecoState,
  TecoMode,
  TecoFan,
} from "../src/protocols/teco";
import type { TecoState } from "../src/protocols/teco";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function parseCppTimings(s: string): number[] {
  return s.split(",").map(Number);
}
function valueHex(v: bigint): string {
  return v.toString(16).toUpperCase().padStart(9, "0");
}

beforeAll(() => {
  ensureRunner();
});

// Args: power temp mode fan swing sleep light humid save timerMins
interface TC {
  label: string;
  state: TecoState;
  cppArgs: string;
}

const cases: TC[] = [
  {
    label: "cool 24 high, swing",
    state: { power: true, temp: 24, mode: TecoMode.Cool, fan: TecoFan.High, swingV: true },
    cppArgs: "1 24 1 3 1 0 0 0 0 0",
  },
  {
    label: "heat 30 low, sleep+light, timer 90",
    state: { power: true, temp: 30, mode: TecoMode.Heat, fan: TecoFan.Low,
      sleep: true, light: true, timerMinutes: 90 },
    cppArgs: "1 30 4 1 0 1 1 0 0 90",
  },
  {
    label: "off, auto 16, humid+save, timer 720",
    state: { power: false, temp: 16, mode: TecoMode.Auto, fan: TecoFan.Auto,
      humid: true, save: true, timerMinutes: 720 },
    cppArgs: "0 16 0 0 0 0 0 1 1 720",
  },
  {
    label: "dry 25 med, timer 1440 (max)",
    state: { power: true, temp: 25, mode: TecoMode.Dry, fan: TecoFan.Med, timerMinutes: 1440 },
    cppArgs: "1 25 2 2 0 0 0 0 0 1440",
  },
];

describe("teco state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw value for ${tc.label}`, () => {
      expect(valueHex(buildTecoRaw(tc.state))).toBe(cpp(`teco ${tc.cppArgs}`));
    });
  }
});

describe("encodeTecoRaw cross-validation", () => {
  for (const tc of cases) {
    it(`timings match C++ for ${tc.label}`, () => {
      const value = buildTecoRaw(tc.state);
      const cppTimings = parseCppTimings(cpp(`sendTeco ${valueHex(value)} 0`));
      const tsTimings = encodeTecoRaw(value, 0);
      // Compare everything except the final inter-message gap.
      expect(tsTimings.length).toBe(cppTimings.length);
      expect(tsTimings.slice(0, -1)).toEqual(cppTimings.slice(0, -1));
    });
  }
});

describe("decodeTeco roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const value = buildTecoRaw(tc.state);
      const decoded = decodeTeco(encodeTecoRaw(value, 1));
      expect(decoded).not.toBeNull();
      expect(valueHex(buildTecoRaw(decoded!))).toBe(valueHex(value));
    });
  }
});

describe("decodeTeco C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const value = buildTecoRaw(tc.state);
      const cppTimings = parseCppTimings(cpp(`sendTeco ${valueHex(value)} 0`));
      const decoded = decodeTeco(cppTimings);
      expect(decoded).not.toBeNull();
      expect(valueHex(buildTecoRaw(decoded!))).toBe(valueHex(value));
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Teco frame as protocol teco / brand teco", () => {
    const result = decode(sendTeco(cases[0]!.state, 1));
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("teco");
    expect(result!.brand).toBe("teco");
    expect(result!.confidence).toBe("timing_match");
  });
});

describe("teco rejection", () => {
  it("rejects empty / short timings", () => {
    expect(decodeTeco([])).toBeNull();
    expect(decodeTeco([1, 2, 3])).toBeNull();
  });

  it("rejects a value with bad constant bits", () => {
    const value = buildTecoRaw(cases[0]!.state);
    expect(parseTecoState(value ^ (0x50n << 24n))).toBeNull(); // corrupt the 0x50 constant
  });

  it("parseTecoState round-trips fields", () => {
    const decoded = parseTecoState(buildTecoRaw(cases[1]!.state))!;
    expect(decoded.mode).toBe(TecoMode.Heat);
    expect(decoded.temp).toBe(30);
    expect(decoded.fan).toBe(TecoFan.Low);
    expect(decoded.sleep).toBe(true);
    expect(decoded.timerMinutes).toBe(90);
  });
});
