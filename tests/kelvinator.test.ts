import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildKelvinatorRaw,
  encodeKelvinatorRaw,
  sendKelvinator,
  decodeKelvinator,
  kelvinatorValidChecksum,
  KelvinatorMode,
  KelvinatorFan,
  KelvinatorSwingV,
} from "../src/protocols/kelvinator";
import type { KelvinatorState } from "../src/protocols/kelvinator";
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
  state: KelvinatorState;
  // power temp mode fan swingV swingH quiet ionFilter light xfan turbo
  cppArgs: string;
}

const cases: TestCase[] = [
  { label: "cool 24 high", state: { power: true, temp: 24, mode: KelvinatorMode.Cool, fan: KelvinatorFan.High }, cppArgs: "1 24 1 4 0 0 0 0 0 0 0" },
  { label: "auto 25 (forced temp)", state: { power: true, temp: 25, mode: KelvinatorMode.Auto, fan: KelvinatorFan.Auto }, cppArgs: "1 25 0 0 0 0 0 0 0 0 0" },
  { label: "heat 30 min fan", state: { power: true, temp: 30, mode: KelvinatorMode.Heat, fan: KelvinatorFan.Min }, cppArgs: "1 30 4 1 0 0 0 0 0 0 0" },
  { label: "dry (forced 25)", state: { power: true, temp: 22, mode: KelvinatorMode.Dry, fan: KelvinatorFan.Auto }, cppArgs: "1 22 2 0 0 0 0 0 0 0 0" },
  { label: "fan mode max", state: { power: true, temp: 18, mode: KelvinatorMode.Fan, fan: KelvinatorFan.Max }, cppArgs: "1 18 3 5 0 0 0 0 0 0 0" },
  { label: "cool swingV auto", state: { power: true, temp: 23, mode: KelvinatorMode.Cool, fan: KelvinatorFan.Medium, swingV: KelvinatorSwingV.Auto }, cppArgs: "1 23 1 3 1 0 0 0 0 0 0" },
  { label: "cool swingV middle (fixed)", state: { power: true, temp: 23, mode: KelvinatorMode.Cool, fan: KelvinatorFan.Low, swingV: KelvinatorSwingV.Middle }, cppArgs: "1 23 1 2 4 0 0 0 0 0 0" },
  { label: "cool swingH", state: { power: true, temp: 21, mode: KelvinatorMode.Cool, fan: KelvinatorFan.High, swingH: true }, cppArgs: "1 21 1 4 0 1 0 0 0 0 0" },
  { label: "cool swingV highAuto + swingH", state: { power: true, temp: 20, mode: KelvinatorMode.Cool, fan: KelvinatorFan.Max, swingV: KelvinatorSwingV.HighAuto, swingH: true }, cppArgs: "1 20 1 5 11 1 0 0 0 0 0" },
  { label: "cool turbo+light+ion+xfan", state: { power: true, temp: 19, mode: KelvinatorMode.Cool, fan: KelvinatorFan.Auto, turbo: true, light: true, ionFilter: true, xfan: true }, cppArgs: "1 19 1 0 0 0 0 1 1 1 1" },
  { label: "off quiet", state: { power: false, temp: 26, mode: KelvinatorMode.Cool, fan: KelvinatorFan.Low, quiet: true }, cppArgs: "0 26 1 2 0 0 1 0 0 0 0" },
  { label: "xfan ignored in heat", state: { power: true, temp: 27, mode: KelvinatorMode.Heat, fan: KelvinatorFan.Medium, xfan: true }, cppArgs: "1 27 4 3 0 0 0 0 0 1 0" },
];

describe("buildKelvinatorRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw for ${tc.label}`, () => {
      expect(toHex(buildKelvinatorRaw(tc.state))).toBe(cpp(`kelvinator ${tc.cppArgs}`).split("\n")[0]!);
    });
  }
});

describe("encodeKelvinatorRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ timings for ${tc.label}`, () => {
      const lines = cpp(`kelvinator ${tc.cppArgs}`).split("\n");
      expect(encodeKelvinatorRaw(buildKelvinatorRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }

  it("matches C++ timings with repeat", () => {
    const raw = buildKelvinatorRaw(cases[0]!.state);
    expect(encodeKelvinatorRaw(raw, 1)).toEqual(parseCppTimings(cpp(`sendKelvinator ${toHex(raw)} 1`)));
  });
});

describe("decodeKelvinator roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildKelvinatorRaw(tc.state);
      const decoded = decodeKelvinator(sendKelvinator(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildKelvinatorRaw(decoded!))).toBe(toHex(raw));
    });
  }

  it("decodes without a header", () => {
    const state = cases[0]!.state;
    const decoded = decodeKelvinator(sendKelvinator(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildKelvinatorRaw(decoded!))).toBe(toHex(buildKelvinatorRaw(state)));
  });

  it("reads the expected fields", () => {
    const s = decodeKelvinator(sendKelvinator(cases[0]!.state))!;
    expect(s.power).toBe(true);
    expect(s.mode).toBe(KelvinatorMode.Cool);
    expect(s.temp).toBe(24);
    expect(s.fan).toBe(KelvinatorFan.High);
  });
});

describe("decodeKelvinator C++ cross-validation", () => {
  for (const tc of cases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildKelvinatorRaw(tc.state);
      const out = cpp(`decode ${encodeKelvinatorRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("KELVINATOR");
      expect(out[1]).toBe(toHex(raw));
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Kelvinator frame", () => {
    const r = decode(sendKelvinator(cases[0]!.state));
    expect(r?.protocol).toBe("kelvinator");
    expect(r?.brand).toBe("kelvinator");
    expect(r?.confidence).toBe("checksum_valid");
  });
});

describe("decodeKelvinator rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeKelvinator([])).toBeNull();
    expect(decodeKelvinator([1, 2, 3, 4])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildKelvinatorRaw(cases[0]!.state);
    raw[1] = (raw[1]! ^ 0x0f) & 0xff; // corrupt temp nibble in block 1
    expect(decodeKelvinator(encodeKelvinatorRaw(raw, 0))).toBeNull();
  });
  it("validChecksum agrees with a freshly built state", () => {
    expect(kelvinatorValidChecksum(buildKelvinatorRaw(cases[2]!.state))).toBe(true);
  });
});
