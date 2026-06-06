import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildLgAcRaw,
  sendLgAc,
  decodeLgAc,
  lgAcModelIsLg2,
  LgAcMode,
  LgAcFan,
  LgAcModel,
} from "../src/protocols/lg_ac";
import { encodeLgRaw } from "../src/protocols/lg";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function hex(n: number): string { return n.toString(16).toUpperCase().padStart(7, "0"); }

beforeAll(() => { ensureRunner(); });

interface TestCase {
  label: string;
  state: import("../src/protocols/lg_ac").LgAcState;
  // model power mode temp fan
  cppArgs: string;
}

const cases: TestCase[] = [
  { label: "GE cool 24 auto", state: { model: LgAcModel.GE6711AR2853M, power: true, mode: LgAcMode.Cool, temp: 24, fan: LgAcFan.Auto }, cppArgs: "1 1 0 24 5" },
  { label: "GE heat 30 max", state: { model: LgAcModel.GE6711AR2853M, power: true, mode: LgAcMode.Heat, temp: 30, fan: LgAcFan.Max }, cppArgs: "1 1 4 30 4" },
  { label: "GE high→max 22", state: { model: LgAcModel.GE6711AR2853M, power: true, mode: LgAcMode.Cool, temp: 22, fan: LgAcFan.High }, cppArgs: "1 1 0 22 10" },
  { label: "GE off", state: { model: LgAcModel.GE6711AR2853M, power: false, mode: LgAcMode.Cool, temp: 24, fan: LgAcFan.Auto }, cppArgs: "1 0 0 24 5" },
  { label: "GE auto-mode medium 25", state: { model: LgAcModel.GE6711AR2853M, power: true, mode: LgAcMode.Auto, temp: 25, fan: LgAcFan.Medium }, cppArgs: "1 1 3 25 2" },
  { label: "AKB75215403 dry 18 low", state: { model: LgAcModel.AKB75215403, power: true, mode: LgAcMode.Dry, temp: 18, fan: LgAcFan.Low }, cppArgs: "2 1 1 18 1" },
  { label: "AKB74955603 low→9", state: { model: LgAcModel.AKB74955603, power: true, mode: LgAcMode.Cool, temp: 24, fan: LgAcFan.Low }, cppArgs: "3 1 0 24 1" },
  { label: "AKB74955603 high→10", state: { model: LgAcModel.AKB74955603, power: true, mode: LgAcMode.Cool, temp: 24, fan: LgAcFan.High }, cppArgs: "3 1 0 24 10" },
  { label: "AKB74955603 lowest 16", state: { model: LgAcModel.AKB74955603, power: true, mode: LgAcMode.Fan, temp: 16, fan: LgAcFan.Lowest }, cppArgs: "3 1 2 16 0" },
];

describe("buildLgAcRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw for ${tc.label}`, () => {
      expect(hex(buildLgAcRaw(tc.state))).toBe(cpp(`lgAc ${tc.cppArgs}`));
    });
  }
});

describe("sendLgAc cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ wire timings for ${tc.label}`, () => {
      const raw = buildLgAcRaw(tc.state);
      const lg2 = lgAcModelIsLg2(tc.state.model!);
      expect(sendLgAc(tc.state)).toEqual(parseCppTimings(cpp(`${lg2 ? "sendLG2" : "sendLG"} ${hex(raw)} 28`)));
    });
  }

  it("re-encodes via the shared lg wire", () => {
    const raw = buildLgAcRaw(cases[0]!.state);
    expect(sendLgAc(cases[0]!.state)).toEqual(encodeLgRaw(BigInt(raw), 28, false));
  });
});

describe("decodeLgAc roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildLgAcRaw(tc.state);
      const decoded = decodeLgAc(sendLgAc(tc.state));
      expect(decoded).not.toBeNull();
      expect(hex(buildLgAcRaw(decoded!))).toBe(hex(raw));
    });
  }

  it("reads the expected fields", () => {
    const s = decodeLgAc(sendLgAc(cases[1]!.state))!;
    expect(s.power).toBe(true);
    expect(s.mode).toBe(LgAcMode.Heat);
    expect(s.temp).toBe(30);
    expect(s.fan).toBe(LgAcFan.Max);
    expect(s.model).toBe(LgAcModel.GE6711AR2853M);
  });

  it("detects the AKB74955603 model from alt fan codes", () => {
    const s = decodeLgAc(sendLgAc(cases[6]!.state))!;
    expect(s.model).toBe(LgAcModel.AKB74955603);
    expect(s.fan).toBe(LgAcFan.Low);
  });
});

describe("decodeLgAc C++ cross-validation", () => {
  for (const tc of cases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildLgAcRaw(tc.state);
      const lg2 = lgAcModelIsLg2(tc.state.model!);
      const out = cpp(`decodeValue ${sendLgAc(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe(lg2 ? "LG2" : "LG");
      expect(BigInt("0x" + out[1]!)).toBe(BigInt(raw));
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies an LG A/C frame as lg_ac (not the generic lg)", () => {
    const r = decode(sendLgAc(cases[0]!.state));
    expect(r?.protocol).toBe("lg_ac");
    expect(r?.brand).toBe("lg");
    expect(r?.confidence).toBe("checksum_valid");
  });
});

describe("decodeLgAc rejection", () => {
  it("rejects a non-A/C LG frame (wrong signature)", () => {
    // A valid LG frame whose top byte isn't 0x88.
    const raw = buildLgAcRaw(cases[0]!.state) & 0x00fffff; // clear signature
    // recompute checksum-free: just confirm decodeLgAc rejects a non-0x88 frame
    expect(decodeLgAc(encodeLgRaw(BigInt(raw >>> 0), 28, false))).toBeNull();
  });
  it("rejects empty/garbage", () => {
    expect(decodeLgAc([])).toBeNull();
  });
});
