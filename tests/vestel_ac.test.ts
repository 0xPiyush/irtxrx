import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildVestelAcRaw,
  encodeVestelAcRaw,
  sendVestelAc,
  decodeVestelAc,
  vestelAcValidChecksum,
  VestelAcMode,
  VestelAcFan,
  VESTEL_AC_BITS,
} from "../src/protocols/vestel_ac";
import type { VestelAcState } from "../src/protocols/vestel_ac";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function hex14(v: bigint): string {
  return v.toString(16).toUpperCase().padStart(14, "0");
}

beforeAll(() => { ensureRunner(); });

interface CmdCase {
  label: string;
  state: VestelAcState;
  // power temp mode fan swing ion sleep turbo
  cppArgs: string;
}

const cmdCases: CmdCase[] = [
  { label: "cool 24 auto", state: { power: true, temp: 24, mode: VestelAcMode.Cool, fan: VestelAcFan.Auto }, cppArgs: "1 24 1 1 0 0 0 0" },
  { label: "auto 25", state: { power: true, temp: 25, mode: VestelAcMode.Auto, fan: VestelAcFan.Auto }, cppArgs: "1 25 0 1 0 0 0 0" },
  { label: "heat 30 high", state: { power: true, temp: 30, mode: VestelAcMode.Heat, fan: VestelAcFan.High }, cppArgs: "1 30 4 11 0 0 0 0" },
  { label: "dry 18 low", state: { power: true, temp: 18, mode: VestelAcMode.Dry, fan: VestelAcFan.Low }, cppArgs: "1 18 2 5 0 0 0 0" },
  { label: "fan med", state: { power: true, temp: 22, mode: VestelAcMode.Fan, fan: VestelAcFan.Med }, cppArgs: "1 22 3 9 0 0 0 0" },
  { label: "cool swing", state: { power: true, temp: 23, mode: VestelAcMode.Cool, fan: VestelAcFan.Auto, swing: true }, cppArgs: "1 23 1 1 1 0 0 0" },
  { label: "cool ion", state: { power: true, temp: 23, mode: VestelAcMode.Cool, fan: VestelAcFan.High, ion: true }, cppArgs: "1 23 1 11 0 1 0 0" },
  { label: "cool sleep", state: { power: true, temp: 21, mode: VestelAcMode.Cool, fan: VestelAcFan.Low, sleep: true }, cppArgs: "1 21 1 5 0 0 1 0" },
  { label: "cool turbo", state: { power: true, temp: 20, mode: VestelAcMode.Cool, fan: VestelAcFan.High, turbo: true }, cppArgs: "1 20 1 11 0 0 0 1" },
  { label: "off", state: { power: false, temp: 26, mode: VestelAcMode.Heat, fan: VestelAcFan.Auto }, cppArgs: "0 26 4 1 0 0 0 0" },
];

describe("buildVestelAcRaw command cross-validation", () => {
  for (const tc of cmdCases) {
    it(`matches C++ value for ${tc.label}`, () => {
      expect(hex14(buildVestelAcRaw(tc.state))).toBe(cpp(`vestelCmd ${tc.cppArgs}`).split("\n")[0]!);
    });
  }
});

describe("encodeVestelAcRaw cross-validation", () => {
  for (const tc of cmdCases) {
    it(`matches C++ timings for ${tc.label}`, () => {
      const lines = cpp(`vestelCmd ${tc.cppArgs}`).split("\n");
      expect(encodeVestelAcRaw(buildVestelAcRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }

  it("matches C++ timings with repeat", () => {
    const raw = buildVestelAcRaw(cmdCases[0]!.state);
    expect(encodeVestelAcRaw(raw, 1)).toEqual(parseCppTimings(cpp(`sendVestel ${hex14(raw)} 1`)));
  });
});

describe("decodeVestelAc command roundtrip", () => {
  for (const tc of cmdCases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildVestelAcRaw(tc.state);
      const decoded = decodeVestelAc(sendVestelAc(tc.state));
      expect(decoded).not.toBeNull();
      expect(hex14(buildVestelAcRaw(decoded!))).toBe(hex14(raw));
    });
  }

  it("decodes without a header", () => {
    const state = cmdCases[8]!.state;
    const decoded = decodeVestelAc(sendVestelAc(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(hex14(buildVestelAcRaw(decoded!))).toBe(hex14(buildVestelAcRaw(state)));
  });

  it("reads command fields", () => {
    const s = decodeVestelAc(sendVestelAc(cmdCases[8]!.state))!;
    expect(s).toMatchObject({ timeCommand: false, power: true, mode: VestelAcMode.Cool, temp: 20, turbo: true });
  });
});

describe("decodeVestelAc C++ cross-validation", () => {
  for (const tc of cmdCases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildVestelAcRaw(tc.state);
      const out = cpp(`decodeValue ${encodeVestelAcRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("VESTEL_AC");
      expect(BigInt(`0x${out[1]}`)).toBe(raw);
    });
  }
});

// --- Time / timer message variant ------------------------------------------

interface TimeCase {
  label: string;
  state: VestelAcState;
  // clock onTimer offTimer
  cppArgs: string;
}

const timeCases: TimeCase[] = [
  { label: "clock 13:30", state: { timeCommand: true, clock: 13 * 60 + 30 }, cppArgs: "810 -1 -1" },
  { label: "onTimer 90m", state: { timeCommand: true, clock: 0, onTimer: 90, onTimerActive: true }, cppArgs: "0 90 -1" },
  { label: "offTimer 120m", state: { timeCommand: true, clock: 0, offTimer: 120, offTimerActive: true }, cppArgs: "0 -1 120" },
  { label: "clock + on + off", state: { timeCommand: true, clock: 8 * 60, onTimer: 30, onTimerActive: true, offTimer: 300, offTimerActive: true }, cppArgs: "480 30 300" },
];

describe("buildVestelAcRaw time cross-validation", () => {
  for (const tc of timeCases) {
    it(`matches C++ value for ${tc.label}`, () => {
      expect(hex14(buildVestelAcRaw(tc.state))).toBe(cpp(`vestelTime ${tc.cppArgs}`).split("\n")[0]!);
    });
  }
});

describe("decodeVestelAc time roundtrip + vendor cross-validation", () => {
  for (const tc of timeCases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildVestelAcRaw(tc.state);
      const decoded = decodeVestelAc(sendVestelAc(tc.state))!;
      expect(decoded.timeCommand).toBe(true);
      expect(hex14(buildVestelAcRaw(decoded))).toBe(hex14(raw));
      const out = cpp(`decodeValue ${encodeVestelAcRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("VESTEL_AC");
      expect(BigInt(`0x${out[1]}`)).toBe(raw);
    });
  }

  it("reads timer fields", () => {
    const s = decodeVestelAc(sendVestelAc(timeCases[3]!.state))!;
    expect(s.clock).toBe(480);
    expect(s.onTimer).toBe(30);
    expect(s.offTimer).toBe(300);
  });
});

describe("decode() dispatch", () => {
  it("identifies a Vestel command frame", () => {
    const r = decode(sendVestelAc(cmdCases[0]!.state));
    expect(r?.protocol).toBe("vestel_ac");
    expect(r?.brand).toBe("vestel");
    expect(r?.confidence).toBe("checksum_valid");
  });
});

describe("decodeVestelAc rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeVestelAc([])).toBeNull();
    expect(decodeVestelAc([1, 2, 3, 4])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildVestelAcRaw(cmdCases[0]!.state) ^ (1n << 36n); // flip a temp bit
    expect(decodeVestelAc(encodeVestelAcRaw(raw, 0))).toBeNull();
  });
  it("exposes the bit width", () => {
    expect(VESTEL_AC_BITS).toBe(56);
  });
  it("validChecksum agrees with a freshly built value", () => {
    expect(vestelAcValidChecksum(buildVestelAcRaw(cmdCases[2]!.state))).toBe(true);
  });
});
