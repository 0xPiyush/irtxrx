import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildPanasonicAc32Raw,
  encodePanasonicAc32Raw,
  sendPanasonicAc32,
  decodePanasonicAc32,
  PanasonicAc32Mode,
  PanasonicAc32Fan,
  PanasonicAc32SwingV,
} from "../src/protocols/panasonic_ac32";
import type { PanasonicAc32State } from "../src/protocols/panasonic_ac32";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function toHex(v: bigint): string { return v.toString(16).toUpperCase().padStart(8, "0"); }

beforeAll(() => { ensureRunner(); });

interface TestCase {
  label: string;
  state: PanasonicAc32State;
  // powerToggle temp mode fan swingV swingH
  cppArgs: string;
}

const cases: TestCase[] = [
  { label: "cool 16°C auto fan swingV auto swingH (known-good)", state: { powerToggle: false, temp: 16, mode: PanasonicAc32Mode.Cool, fan: PanasonicAc32Fan.Auto, swingV: PanasonicAc32SwingV.Auto, swingH: true }, cppArgs: "0 16 2 15 7 1" },
  { label: "heat 24°C high middle, toggle", state: { powerToggle: true, temp: 24, mode: PanasonicAc32Mode.Heat, fan: PanasonicAc32Fan.High, swingV: PanasonicAc32SwingV.Middle, swingH: false }, cppArgs: "1 24 4 5 3 0" },
  { label: "dry 30°C min highest", state: { powerToggle: false, temp: 30, mode: PanasonicAc32Mode.Dry, fan: PanasonicAc32Fan.Min, swingV: PanasonicAc32SwingV.Highest, swingH: true }, cppArgs: "0 30 3 2 1 1" },
  { label: "fan 20°C med lowest toggle", state: { powerToggle: true, temp: 20, mode: PanasonicAc32Mode.Fan, fan: PanasonicAc32Fan.Med, swingV: PanasonicAc32SwingV.Lowest, swingH: false }, cppArgs: "1 20 1 4 5 0" },
  { label: "auto 22°C max low", state: { powerToggle: false, temp: 22, mode: PanasonicAc32Mode.Auto, fan: PanasonicAc32Fan.Max, swingV: PanasonicAc32SwingV.Low, swingH: true }, cppArgs: "0 22 6 6 4 1" },
];

describe("buildPanasonicAc32Raw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw for ${tc.label}`, () => {
      expect(toHex(buildPanasonicAc32Raw(tc.state))).toBe(cpp(`panasonicAc32 ${tc.cppArgs}`));
    });
  }
});

describe("encodePanasonicAc32Raw cross-validation", () => {
  for (const tc of cases) {
    const raw = buildPanasonicAc32Raw(tc.state);
    it(`matches C++ timings for ${tc.label}`, () => {
      expect(encodePanasonicAc32Raw(raw, 32, 0)).toEqual(parseCppTimings(cpp(`sendPanasonicAC32 ${toHex(raw)} 32`)));
    });
    it(`matches C++ timings (repeat) for ${tc.label}`, () => {
      expect(encodePanasonicAc32Raw(raw, 32, 1)).toEqual(parseCppTimings(cpp(`sendPanasonicAC32 ${toHex(raw)} 32 1`)));
    });
  }
});

describe("decodePanasonicAc32 roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildPanasonicAc32Raw(tc.state);
      const decoded = decodePanasonicAc32(sendPanasonicAc32(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildPanasonicAc32Raw(decoded!))).toBe(toHex(raw));
    });
  }

  it("reads the expected fields", () => {
    const s = decodePanasonicAc32(sendPanasonicAc32(cases[1]!.state))!;
    expect(s.powerToggle).toBe(true);
    expect(s.temp).toBe(24);
    expect(s.mode).toBe(PanasonicAc32Mode.Heat);
    expect(s.fan).toBe(PanasonicAc32Fan.High);
    expect(s.swingV).toBe(PanasonicAc32SwingV.Middle);
    expect(s.swingH).toBe(false);
  });
});

describe("decodePanasonicAc32 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildPanasonicAc32Raw(tc.state);
      const timings = encodePanasonicAc32Raw(raw);
      const out = cpp(`decodeValue ${timings.join(",")}`).split("\n");
      expect(out[0]).toBe("PANASONIC_AC32");
      expect(BigInt("0x" + out[1]!)).toBe(raw);
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Panasonic AC32 frame", () => {
    const r = decode(sendPanasonicAc32(cases[0]!.state));
    expect(r?.protocol).toBe("panasonic_ac32");
    expect(r?.brand).toBe("panasonic");
    expect(r?.confidence).toBe("timing_match");
  });
});

describe("decodePanasonicAc32 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodePanasonicAc32([])).toBeNull();
    expect(decodePanasonicAc32([1, 2, 3, 4, 5, 6])).toBeNull();
  });
  it("rejects a frame with a broken byte-duplication", () => {
    const timings = sendPanasonicAc32(cases[0]!.state);
    // Corrupt the first data bit's space so byte0 != its duplicate.
    timings[3] = timings[3] === 2575 ? 828 : 2575;
    expect(decodePanasonicAc32(timings)).toBeNull();
  });
});
