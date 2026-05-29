import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildMitsubishiAcRaw,
  encodeMitsubishiAcRaw,
  sendMitsubishiAc,
  decodeMitsubishiAc,
  validMitsubishiAcChecksum,
  MitsubishiAcMode,
  MitsubishiAcFan,
  MitsubishiAcVane,
  MitsubishiAcWideVane,
} from "../src/protocols/mitsubishi_ac";
import type { MitsubishiAcState } from "../src/protocols/mitsubishi_ac";
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

// Args: power tempHalfDeg mode fan vane wideVane isee
interface TC {
  label: string;
  state: MitsubishiAcState;
  cppArgs: string;
}

const cases: TC[] = [
  {
    label: "cool 22.5 fan2, vane mid, wide right, isee",
    state: { power: true, temp: 22.5, mode: MitsubishiAcMode.Cool, fan: 2,
      swingV: MitsubishiAcVane.Middle, swingH: MitsubishiAcWideVane.Right, iSee: true },
    cppArgs: "1 45 3 2 3 4 1",
  },
  {
    label: "heat 20 auto fan, vane auto, wide auto",
    state: { power: true, temp: 20, mode: MitsubishiAcMode.Heat, fan: MitsubishiAcFan.Auto,
      swingV: MitsubishiAcVane.Auto, swingH: MitsubishiAcWideVane.Auto },
    cppArgs: "1 40 1 0 0 8 0",
  },
  {
    label: "auto 25 max, vane swing, wide left",
    state: { power: true, temp: 25, mode: MitsubishiAcMode.Auto, fan: MitsubishiAcFan.Max,
      swingV: MitsubishiAcVane.Swing, swingH: MitsubishiAcWideVane.Left },
    cppArgs: "1 50 4 5 7 2 0",
  },
  {
    label: "off, dry 16 silent, vane highest, wide middle",
    state: { power: false, temp: 16, mode: MitsubishiAcMode.Dry, fan: MitsubishiAcFan.Silent,
      swingV: MitsubishiAcVane.Highest, swingH: MitsubishiAcWideVane.Middle },
    cppArgs: "0 32 2 6 1 3 0",
  },
  {
    label: "fan-mode 31 speed4, vane low, wide rightmax",
    state: { power: true, temp: 31, mode: MitsubishiAcMode.Fan, fan: 4,
      swingV: MitsubishiAcVane.Low, swingH: MitsubishiAcWideVane.RightMax },
    cppArgs: "1 62 7 4 4 5 0",
  },
];

describe("mitsubishi_ac state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw bytes for ${tc.label}`, () => {
      expect(bytesToHex(buildMitsubishiAcRaw(tc.state))).toBe(cpp(`mitsubishiAc ${tc.cppArgs}`));
    });
  }
});

describe("encodeMitsubishiAcRaw cross-validation", () => {
  for (const tc of cases) {
    it(`timings match C++ for ${tc.label}`, () => {
      const raw = buildMitsubishiAcRaw(tc.state);
      const cppT = parseCppTimings(cpp(`sendMitsubishiAc ${bytesToHex(raw)} 0`));
      expect(encodeMitsubishiAcRaw(raw, 0)).toEqual(cppT);
    });
  }
});

describe("decodeMitsubishiAc roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildMitsubishiAcRaw(tc.state);
      const decoded = decodeMitsubishiAc(sendMitsubishiAc(tc.state, 1));
      expect(decoded).not.toBeNull();
      expect(bytesToHex(buildMitsubishiAcRaw(decoded!))).toBe(bytesToHex(raw));
    });
  }
});

describe("decodeMitsubishiAc C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const hex = cpp(`mitsubishiAc ${tc.cppArgs}`);
      const cppT = parseCppTimings(cpp(`sendMitsubishiAc ${hex} 0`));
      const decoded = decodeMitsubishiAc(cppT);
      expect(decoded).not.toBeNull();
      expect(bytesToHex(buildMitsubishiAcRaw(decoded!))).toBe(hex);
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Mitsubishi AC frame", () => {
    const r = decode(sendMitsubishiAc(cases[0]!.state, 1));
    expect(r).not.toBeNull();
    expect(r!.protocol).toBe("mitsubishi_ac");
    expect(r!.brand).toBe("mitsubishi");
    expect(r!.confidence).toBe("checksum_valid");
  });
});

describe("mitsubishi_ac rejection", () => {
  it("produces a valid checksum", () => {
    expect(validMitsubishiAcChecksum(buildMitsubishiAcRaw(cases[0]!.state))).toBe(true);
  });
  it("rejects empty / short timings", () => {
    expect(decodeMitsubishiAc([])).toBeNull();
    expect(decodeMitsubishiAc([1, 2, 3])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildMitsubishiAcRaw(cases[0]!.state);
    raw[17] = raw[17]! ^ 0xff;
    expect(decodeMitsubishiAc(encodeMitsubishiAcRaw(raw, 0))).toBeNull();
  });
});
