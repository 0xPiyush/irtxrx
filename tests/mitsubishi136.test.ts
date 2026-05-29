import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildMitsubishi136Raw,
  encodeMitsubishi136Raw,
  sendMitsubishi136,
  decodeMitsubishi136,
  validMitsubishi136Checksum,
  Mitsubishi136Mode,
  Mitsubishi136Fan,
  Mitsubishi136SwingV,
} from "../src/protocols/mitsubishi136";
import type { Mitsubishi136State } from "../src/protocols/mitsubishi136";
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
function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, "0")).join("");
}

beforeAll(() => {
  ensureRunner();
});

// Args: power temp mode fan swingV
interface TC {
  label: string;
  state: Mitsubishi136State;
  cppArgs: string;
}

const cases: TC[] = [
  {
    label: "cool 24 med, swing high",
    state: { power: true, temp: 24, mode: Mitsubishi136Mode.Cool, fan: Mitsubishi136Fan.Med, swingV: Mitsubishi136SwingV.High },
    cppArgs: "1 24 1 2 2",
  },
  {
    label: "heat 30 max, swing auto",
    state: { power: true, temp: 30, mode: Mitsubishi136Mode.Heat, fan: Mitsubishi136Fan.Max, swingV: Mitsubishi136SwingV.Auto },
    cppArgs: "1 30 2 3 12",
  },
  {
    label: "off, auto 17 quiet(min), swing lowest",
    state: { power: false, temp: 17, mode: Mitsubishi136Mode.Auto, fan: Mitsubishi136Fan.Min, swingV: Mitsubishi136SwingV.Lowest },
    cppArgs: "0 17 3 0 0",
  },
  {
    label: "dry 25 low, swing highest",
    state: { power: true, temp: 25, mode: Mitsubishi136Mode.Dry, fan: Mitsubishi136Fan.Low, swingV: Mitsubishi136SwingV.Highest },
    cppArgs: "1 25 5 1 3",
  },
  {
    label: "fan-mode 22 max, swing low",
    state: { power: true, temp: 22, mode: Mitsubishi136Mode.Fan, fan: Mitsubishi136Fan.Max, swingV: Mitsubishi136SwingV.Low },
    cppArgs: "1 22 0 3 1",
  },
];

describe("mitsubishi136 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw bytes for ${tc.label}`, () => {
      expect(bytesToHex(buildMitsubishi136Raw(tc.state))).toBe(cpp(`mitsubishi136 ${tc.cppArgs}`));
    });
  }
});

describe("encodeMitsubishi136Raw cross-validation", () => {
  for (const tc of cases) {
    it(`timings match C++ for ${tc.label}`, () => {
      const raw = buildMitsubishi136Raw(tc.state);
      const cppT = parseCppTimings(cpp(`sendMitsubishi136 ${bytesToHex(raw)} 0`));
      expect(encodeMitsubishi136Raw(raw, 0)).toEqual(cppT);
    });
  }
});

describe("decodeMitsubishi136 roundtrip + C++ cross-validation", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildMitsubishi136Raw(tc.state);
      const decoded = decodeMitsubishi136(sendMitsubishi136(tc.state, 0));
      expect(decoded).not.toBeNull();
      expect(bytesToHex(buildMitsubishi136Raw(decoded!))).toBe(bytesToHex(raw));
    });
    it(`decodes C++ timings for ${tc.label}`, () => {
      const hex = cpp(`mitsubishi136 ${tc.cppArgs}`);
      const cppT = parseCppTimings(cpp(`sendMitsubishi136 ${hex} 0`));
      const decoded = decodeMitsubishi136(cppT);
      expect(decoded).not.toBeNull();
      expect(bytesToHex(buildMitsubishi136Raw(decoded!))).toBe(hex);
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Mitsubishi136 frame", () => {
    const r = decode(sendMitsubishi136(cases[0]!.state, 0));
    expect(r).not.toBeNull();
    expect(r!.protocol).toBe("mitsubishi136");
    expect(r!.brand).toBe("mitsubishi");
  });
});

describe("mitsubishi136 rejection", () => {
  it("produces a valid checksum", () => {
    expect(validMitsubishi136Checksum(buildMitsubishi136Raw(cases[0]!.state))).toBe(true);
  });
  it("rejects empty timings", () => {
    expect(decodeMitsubishi136([])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildMitsubishi136Raw(cases[0]!.state);
    raw[11] = raw[11]! ^ 0xff;
    expect(decodeMitsubishi136(encodeMitsubishi136Raw(raw, 0))).toBeNull();
  });
});
