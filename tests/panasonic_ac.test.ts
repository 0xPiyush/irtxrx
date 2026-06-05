import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildPanasonicAcRaw,
  encodePanasonicAcRaw,
  sendPanasonicAc,
  decodePanasonicAc,
  PanasonicAcMode,
  PanasonicAcFan,
  PanasonicAcSwingV,
  PanasonicAcSwingH,
  PanasonicAcModel,
} from "../src/protocols/panasonic_ac";
import type { PanasonicAcState } from "../src/protocols/panasonic_ac";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function toHex(a: Uint8Array): string {
  return Array.from(a).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}

beforeAll(() => { ensureRunner(); });

interface TestCase {
  label: string;
  state: PanasonicAcState;
  // model power temp mode fan swingV swingH quiet powerful ion clock onTimer onTimerEn offTimer offTimerEn
  cppArgs: string;
}

const cases: TestCase[] = [
  { label: "DKE cool 24 high", state: { model: PanasonicAcModel.Dke, power: true, temp: 24, mode: PanasonicAcMode.Cool, fan: PanasonicAcFan.High, swingV: PanasonicAcSwingV.Auto, swingH: PanasonicAcSwingH.Middle }, cppArgs: "3 1 24 3 3 15 6 0 0 0 0 0 0 0 0" },
  { label: "DKE heat ion+swingH+powerful", state: { model: PanasonicAcModel.Dke, power: true, temp: 22, mode: PanasonicAcMode.Heat, fan: PanasonicAcFan.Max, swingV: PanasonicAcSwingV.Middle, swingH: PanasonicAcSwingH.Left, powerful: true, ion: true }, cppArgs: "3 1 22 4 4 3 10 0 1 1 0 0 0 0 0" },
  { label: "NKE dry quiet", state: { model: PanasonicAcModel.Nke, power: false, temp: 18, mode: PanasonicAcMode.Dry, fan: PanasonicAcFan.Min, swingV: PanasonicAcSwingV.Lowest, swingH: PanasonicAcSwingH.Middle, quiet: true }, cppArgs: "2 0 18 2 0 5 6 1 0 0 0 0 0 0 0" },
  { label: "LKE fan mode", state: { model: PanasonicAcModel.Lke, power: true, temp: 27, mode: PanasonicAcMode.Fan, fan: PanasonicAcFan.Auto, swingV: PanasonicAcSwingV.Highest, swingH: PanasonicAcSwingH.Middle }, cppArgs: "1 1 27 6 7 1 6 0 0 0 0 0 0 0 0" },
  { label: "JKE auto + clock", state: { model: PanasonicAcModel.Jke, power: true, temp: 25, mode: PanasonicAcMode.Auto, fan: PanasonicAcFan.Med, swingV: PanasonicAcSwingV.High, swingH: PanasonicAcSwingH.Middle, clock: 615 }, cppArgs: "4 1 25 0 2 2 6 0 0 0 615 0 0 0 0" },
  { label: "CKP powerful + timers", state: { model: PanasonicAcModel.Ckp, power: false, temp: 20, mode: PanasonicAcMode.Cool, fan: PanasonicAcFan.Low, swingV: PanasonicAcSwingV.Low, swingH: PanasonicAcSwingH.Middle, powerful: true, onTimer: 420, onTimerEnabled: true, offTimer: 1320, offTimerEnabled: true }, cppArgs: "5 0 20 3 1 4 6 0 1 0 0 420 1 1320 1" },
  { label: "RKR quiet + swingH right", state: { model: PanasonicAcModel.Rkr, power: true, temp: 30, mode: PanasonicAcMode.Heat, fan: PanasonicAcFan.High, swingV: PanasonicAcSwingV.Auto, swingH: PanasonicAcSwingH.Right, quiet: true }, cppArgs: "6 1 30 4 3 15 11 1 0 0 0 0 0 0 0" },
];

describe("buildPanasonicAcRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw for ${tc.label}`, () => {
      expect(toHex(buildPanasonicAcRaw(tc.state))).toBe(cpp(`panasonicAc ${tc.cppArgs}`).split("\n")[0]!);
    });
  }
});

describe("encodePanasonicAcRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ timings for ${tc.label}`, () => {
      const lines = cpp(`panasonicAc ${tc.cppArgs}`).split("\n");
      expect(encodePanasonicAcRaw(buildPanasonicAcRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }

  it("matches C++ timings with repeat", () => {
    const raw = buildPanasonicAcRaw(cases[0]!.state);
    expect(encodePanasonicAcRaw(raw, 1)).toEqual(parseCppTimings(cpp(`sendPanasonicAC ${toHex(raw)} 1`)));
  });
});

describe("decodePanasonicAc roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildPanasonicAcRaw(tc.state);
      const decoded = decodePanasonicAc(sendPanasonicAc(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildPanasonicAcRaw(decoded!))).toBe(toHex(raw));
    });
  }

  it("decodes without a header", () => {
    const state = cases[0]!.state;
    const decoded = decodePanasonicAc(sendPanasonicAc(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildPanasonicAcRaw(decoded!))).toBe(toHex(buildPanasonicAcRaw(state)));
  });

  it("reads the expected fields (DKE ion case)", () => {
    const s = decodePanasonicAc(sendPanasonicAc(cases[1]!.state))!;
    expect(s.model).toBe(PanasonicAcModel.Dke);
    expect(s.power).toBe(true);
    expect(s.temp).toBe(22);
    expect(s.mode).toBe(PanasonicAcMode.Heat);
    expect(s.fan).toBe(PanasonicAcFan.Max);
    expect(s.swingH).toBe(PanasonicAcSwingH.Left);
    expect(s.powerful).toBe(true);
    expect(s.ion).toBe(true);
  });

  it("reads CKP timers", () => {
    const s = decodePanasonicAc(sendPanasonicAc(cases[5]!.state))!;
    expect(s.model).toBe(PanasonicAcModel.Ckp);
    expect(s.powerful).toBe(true);
    expect(s.onTimerEnabled).toBe(true);
    expect(s.onTimer).toBe(420);
    expect(s.offTimerEnabled).toBe(true);
    expect(s.offTimer).toBe(1320);
  });
});

describe("decodePanasonicAc C++ cross-validation", () => {
  for (const tc of cases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildPanasonicAcRaw(tc.state);
      const out = cpp(`decode ${encodePanasonicAcRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("PANASONIC_AC");
      expect(out[1]).toBe(toHex(raw));
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Panasonic AC frame", () => {
    const r = decode(sendPanasonicAc(cases[0]!.state));
    expect(r?.protocol).toBe("panasonic_ac");
    expect(r?.brand).toBe("panasonic");
    expect(r?.confidence).toBe("checksum_valid");
  });
});

describe("decodePanasonicAc rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodePanasonicAc([])).toBeNull();
    expect(decodePanasonicAc([1, 2, 3, 4])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildPanasonicAcRaw(cases[0]!.state);
    raw[26] = (raw[26]! ^ 0xff) & 0xff;
    expect(decodePanasonicAc(encodePanasonicAcRaw(raw, 0))).toBeNull();
  });
  it("rejects a wrong section signature", () => {
    const raw = buildPanasonicAcRaw(cases[0]!.state);
    raw[0] = 0x99;
    raw[26] = (Array.from(raw.subarray(0, 26)).reduce((a, b) => a + b, 0xf4)) & 0xff;
    expect(decodePanasonicAc(encodePanasonicAcRaw(raw, 0))).toBeNull();
  });
});
