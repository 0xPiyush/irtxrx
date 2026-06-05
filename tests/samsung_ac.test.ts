import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildSamsungAcRaw,
  encodeSamsungAcRaw,
  sendSamsungAc,
  decodeSamsungAc,
  SamsungAcMode,
  SamsungAcFan,
} from "../src/protocols/samsung_ac";
import type { SamsungAcState } from "../src/protocols/samsung_ac";
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
  state: SamsungAcState;
  // power temp mode fan swingV swingH quiet powerful breeze econo clean beep display ion
  cppArgs: string;
}

const cases: TestCase[] = [
  { label: "cool 24 high", state: { power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.High }, cppArgs: "1 24 1 5 0 0 0 0 0 0 0 0 0 0" },
  { label: "auto 25", state: { power: true, temp: 25, mode: SamsungAcMode.Auto, fan: SamsungAcFan.Auto }, cppArgs: "1 25 0 0 0 0 0 0 0 0 0 0 0 0" },
  { label: "heat 30 low swingV", state: { power: true, temp: 30, mode: SamsungAcMode.Heat, fan: SamsungAcFan.Low, swingV: true }, cppArgs: "1 30 4 2 1 0 0 0 0 0 0 0 0 0" },
  { label: "dry 18 swing both", state: { power: true, temp: 18, mode: SamsungAcMode.Dry, fan: SamsungAcFan.Med, swingV: true, swingH: true }, cppArgs: "1 18 2 4 1 1 0 0 0 0 0 0 0 0" },
  { label: "fan mode quiet", state: { power: true, temp: 22, mode: SamsungAcMode.Fan, fan: SamsungAcFan.Auto, quiet: true }, cppArgs: "1 22 3 0 0 0 1 0 0 0 0 0 0 0" },
  { label: "powerful", state: { power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.High, powerful: true }, cppArgs: "1 24 1 5 0 0 0 1 0 0 0 0 0 0" },
  { label: "breeze (windfree)", state: { power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Auto, breeze: true }, cppArgs: "1 24 1 0 0 0 0 0 1 0 0 0 0 0" },
  { label: "econo", state: { power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Auto, econo: true }, cppArgs: "1 24 1 0 0 0 0 0 0 1 0 0 0 0" },
  { label: "off + clean+beep+display+ion", state: { power: false, temp: 26, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Med, clean: true, beep: true, display: true, ion: true }, cppArgs: "0 26 1 4 0 0 0 0 0 0 1 1 1 1" },
  { label: "swingH only", state: { power: true, temp: 20, mode: SamsungAcMode.Cool, fan: SamsungAcFan.High, swingH: true }, cppArgs: "1 20 1 5 0 1 0 0 0 0 0 0 0 0" },
];

describe("buildSamsungAcRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw for ${tc.label}`, () => {
      expect(toHex(buildSamsungAcRaw(tc.state))).toBe(cpp(`samsungAc ${tc.cppArgs}`).split("\n")[0]!);
    });
  }
});

describe("encodeSamsungAcRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ timings for ${tc.label}`, () => {
      const lines = cpp(`samsungAc ${tc.cppArgs}`).split("\n");
      expect(encodeSamsungAcRaw(buildSamsungAcRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }

  it("matches C++ timings with repeat", () => {
    const raw = buildSamsungAcRaw(cases[0]!.state);
    expect(encodeSamsungAcRaw(raw, 1)).toEqual(parseCppTimings(cpp(`sendSamsungAC ${toHex(raw)} 1`)));
  });
});

describe("decodeSamsungAc roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildSamsungAcRaw(tc.state);
      const decoded = decodeSamsungAc(sendSamsungAc(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildSamsungAcRaw(decoded!))).toBe(toHex(raw));
    });
  }

  it("decodes without a header", () => {
    const state = cases[0]!.state;
    const decoded = decodeSamsungAc(sendSamsungAc(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildSamsungAcRaw(decoded!))).toBe(toHex(buildSamsungAcRaw(state)));
  });

  it("reads the expected fields (powerful)", () => {
    const s = decodeSamsungAc(sendSamsungAc(cases[5]!.state))!;
    expect(s.power).toBe(true);
    expect(s.mode).toBe(SamsungAcMode.Cool);
    expect(s.temp).toBe(24);
    expect(s.powerful).toBe(true);
    expect(s.fan).toBe(SamsungAcFan.Turbo);
  });
});

describe("decodeSamsungAc C++ cross-validation", () => {
  for (const tc of cases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildSamsungAcRaw(tc.state);
      const out = cpp(`decode ${encodeSamsungAcRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("SAMSUNG_AC");
      expect(out[1]).toBe(toHex(raw));
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Samsung AC frame", () => {
    const r = decode(sendSamsungAc(cases[0]!.state));
    expect(r?.protocol).toBe("samsung_ac");
    expect(r?.brand).toBe("samsung");
    expect(r?.confidence).toBe("checksum_valid");
  });
});

describe("decodeSamsungAc rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeSamsungAc([])).toBeNull();
    expect(decodeSamsungAc([1, 2, 3, 4])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildSamsungAcRaw(cases[0]!.state);
    raw[3] = (raw[3]! ^ 0xff) & 0xff; // a data byte in section 1 → checksum mismatch
    expect(decodeSamsungAc(encodeSamsungAcRaw(raw, 0))).toBeNull();
  });
});
