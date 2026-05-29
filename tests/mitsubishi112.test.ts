import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildMitsubishi112Raw,
  encodeMitsubishi112Raw,
  sendMitsubishi112,
  decodeMitsubishi112,
  Mitsubishi112Mode,
  Mitsubishi112Fan,
  Mitsubishi112SwingV,
  Mitsubishi112SwingH,
} from "../src/protocols/mitsubishi112";
import type { Mitsubishi112State } from "../src/protocols/mitsubishi112";
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

// Args: power temp mode fan swingV swingH
interface TC {
  label: string;
  state: Mitsubishi112State;
  cppArgs: string;
}

const cases: TC[] = [
  {
    label: "cool 20 med, swingV high, swingH middle",
    state: { power: true, temp: 20, mode: Mitsubishi112Mode.Cool, fan: Mitsubishi112Fan.Med,
      swingV: Mitsubishi112SwingV.High, swingH: Mitsubishi112SwingH.Middle },
    cppArgs: "1 20 3 5 2 3",
  },
  {
    label: "heat 31 max, swingV auto, swingH auto",
    state: { power: true, temp: 31, mode: Mitsubishi112Mode.Heat, fan: Mitsubishi112Fan.Max,
      swingV: Mitsubishi112SwingV.Auto, swingH: Mitsubishi112SwingH.Auto },
    cppArgs: "1 31 1 0 7 12",
  },
  {
    label: "off, auto 16 min, swingV lowest, swingH leftmax",
    state: { power: false, temp: 16, mode: Mitsubishi112Mode.Auto, fan: Mitsubishi112Fan.Min,
      swingV: Mitsubishi112SwingV.Lowest, swingH: Mitsubishi112SwingH.LeftMax },
    cppArgs: "0 16 7 2 5 1",
  },
  {
    label: "dry 24 low, swingV middle, swingH wide",
    state: { power: true, temp: 24, mode: Mitsubishi112Mode.Dry, fan: Mitsubishi112Fan.Low,
      swingV: Mitsubishi112SwingV.Middle, swingH: Mitsubishi112SwingH.Wide },
    cppArgs: "1 24 2 3 3 8",
  },
];

describe("mitsubishi112 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw bytes for ${tc.label}`, () => {
      expect(bytesToHex(buildMitsubishi112Raw(tc.state))).toBe(cpp(`mitsubishi112 ${tc.cppArgs}`));
    });
  }
});

describe("encodeMitsubishi112Raw cross-validation", () => {
  for (const tc of cases) {
    it(`timings match C++ for ${tc.label}`, () => {
      const raw = buildMitsubishi112Raw(tc.state);
      const cppT = parseCppTimings(cpp(`sendMitsubishi112 ${bytesToHex(raw)} 0`));
      expect(encodeMitsubishi112Raw(raw, 0)).toEqual(cppT);
    });
  }
});

describe("decodeMitsubishi112 roundtrip + C++ cross-validation", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildMitsubishi112Raw(tc.state);
      const decoded = decodeMitsubishi112(sendMitsubishi112(tc.state, 0));
      expect(decoded).not.toBeNull();
      expect(bytesToHex(buildMitsubishi112Raw(decoded!))).toBe(bytesToHex(raw));
    });
    it(`decodes C++ timings for ${tc.label}`, () => {
      const hex = cpp(`mitsubishi112 ${tc.cppArgs}`);
      const cppT = parseCppTimings(cpp(`sendMitsubishi112 ${hex} 0`));
      const decoded = decodeMitsubishi112(cppT);
      expect(decoded).not.toBeNull();
      expect(bytesToHex(buildMitsubishi112Raw(decoded!))).toBe(hex);
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Mitsubishi112 frame (not TCL112)", () => {
    const r = decode(sendMitsubishi112(cases[0]!.state, 0));
    expect(r).not.toBeNull();
    expect(r!.protocol).toBe("mitsubishi112");
    expect(r!.brand).toBe("mitsubishi");
  });
});

describe("mitsubishi112 rejection", () => {
  it("rejects empty timings", () => {
    expect(decodeMitsubishi112([])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildMitsubishi112Raw(cases[0]!.state);
    raw[13] = raw[13]! ^ 0xff;
    expect(decodeMitsubishi112(encodeMitsubishi112Raw(raw, 0))).toBeNull();
  });
});
