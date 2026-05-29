import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildKelonRaw,
  encodeKelonRaw,
  sendKelon,
  decodeKelon,
  parseKelonState,
  buildKelonBytes,
  KelonMode,
  KelonFan,
} from "../src/protocols/kelon";
import type { KelonState } from "../src/protocols/kelon";
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
  return v.toString(16).toUpperCase().padStart(12, "0");
}

beforeAll(() => {
  ensureRunner();
});

// Args: powerToggle temp mode fan sleep swingVToggle dryGrade timerMins
// (modes restricted to Heat/Cool — Smart/Dry/Fan have temp side-effects)
interface TC {
  label: string;
  state: KelonState;
  cppArgs: string;
}

const cases: TC[] = [
  {
    label: "cool 24 max",
    state: { powerToggle: true, temp: 24, mode: KelonMode.Cool, fan: KelonFan.Max },
    cppArgs: "1 24 2 3 0 0 0 0",
  },
  {
    label: "heat 18 min, sleep, swing, dry grade -2, timer 90",
    state: { powerToggle: false, temp: 18, mode: KelonMode.Heat, fan: KelonFan.Min,
      sleep: true, swingVToggle: true, dryGrade: -2, timerEnabled: true, timerMinutes: 90 },
    cppArgs: "0 18 0 1 1 1 -2 90",
  },
  {
    label: "cool 32 med, timer 720 (>=10h encoding)",
    state: { powerToggle: true, temp: 32, mode: KelonMode.Cool, fan: KelonFan.Med,
      dryGrade: 2, timerEnabled: true, timerMinutes: 720 },
    cppArgs: "1 32 2 2 0 0 2 720",
  },
  {
    label: "heat 25 auto fan",
    state: { powerToggle: true, temp: 25, mode: KelonMode.Heat, fan: KelonFan.Auto },
    cppArgs: "1 25 0 0 0 0 0 0",
  },
];

describe("kelon state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw value for ${tc.label}`, () => {
      expect(valueHex(buildKelonRaw(tc.state))).toBe(cpp(`kelon ${tc.cppArgs}`));
    });
  }
});

describe("encodeKelonRaw cross-validation", () => {
  for (const tc of cases) {
    it(`timings match C++ for ${tc.label}`, () => {
      const value = buildKelonRaw(tc.state);
      const cppTimings = parseCppTimings(cpp(`sendKelon ${valueHex(value)} 0`));
      const tsTimings = encodeKelonRaw(value, 0);
      // Compare everything except the final inter-message gap.
      expect(tsTimings.length).toBe(cppTimings.length);
      expect(tsTimings.slice(0, -1)).toEqual(cppTimings.slice(0, -1));
    });
  }
});

describe("decodeKelon roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const value = buildKelonRaw(tc.state);
      const decoded = decodeKelon(encodeKelonRaw(value, 1));
      expect(decoded).not.toBeNull();
      expect(valueHex(buildKelonRaw(decoded!))).toBe(valueHex(value));
    });
  }
});

describe("decodeKelon C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const value = buildKelonRaw(tc.state);
      const cppTimings = parseCppTimings(cpp(`sendKelon ${valueHex(value)} 0`));
      const decoded = decodeKelon(cppTimings);
      expect(decoded).not.toBeNull();
      expect(valueHex(buildKelonRaw(decoded!))).toBe(valueHex(value));
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Kelon frame as protocol kelon / brand kelon", () => {
    const result = decode(sendKelon(cases[0]!.state, 1));
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("kelon");
    expect(result!.brand).toBe("kelon");
    expect(result!.confidence).toBe("timing_match");
  });
});

describe("kelon rejection", () => {
  it("rejects empty / short timings", () => {
    expect(decodeKelon([])).toBeNull();
    expect(decodeKelon([1, 2, 3])).toBeNull();
  });

  it("rejects a bad preamble", () => {
    const bytes = buildKelonBytes(cases[0]!.state);
    bytes[0] = 0x00; // wrong preamble
    expect(parseKelonState(bytes)).toBeNull();
  });

  it("fan ordering is inverted vs the wire and round-trips", () => {
    for (const fan of [KelonFan.Auto, KelonFan.Min, KelonFan.Med, KelonFan.Max]) {
      const decoded = parseKelonState(buildKelonBytes({ fan }));
      expect(decoded!.fan).toBe(fan);
    }
  });
});
