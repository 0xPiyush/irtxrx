import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  sendTeknopoint,
  encodeTeknopointRaw,
  buildTeknopointRaw,
  decodeTeknopoint,
  TeknopointMode,
  TeknopointFan,
  TeknopointSwingV,
  TeknopointModel,
} from "../src/protocols/teknopoint";
import type { TeknopointState } from "../src/protocols/teknopoint";
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
  state: TeknopointState;
  // power temp mode fan swingV swingH econo health light turbo onTimer offTimer model
  cppArgs: string;
}

// Teknopoint defaults to the GZ055BE1 model; cases pin the model explicitly so
// the C++ IRTcl112Ac runner matches our builder byte-for-byte.
const cases: TestCase[] = [
  { label: "cool 24°C fan auto (GZ055BE1)", state: { power: true, temp: 24, mode: TeknopointMode.Cool, fan: TeknopointFan.Auto, model: TeknopointModel.GZ055BE1 }, cppArgs: "1 24 3 0 0 0 0 0 0 0 0 0 2" },
  { label: "heat 22.5°C fan high swingV on", state: { power: true, temp: 22.5, mode: TeknopointMode.Heat, fan: TeknopointFan.High, swingV: TeknopointSwingV.On, model: TeknopointModel.GZ055BE1 }, cppArgs: "1 22.5 1 5 7 0 0 0 0 0 0 0 2" },
  { label: "fan mode (forces high)", state: { power: true, temp: 24, mode: TeknopointMode.Fan, fan: TeknopointFan.Auto, model: TeknopointModel.GZ055BE1 }, cppArgs: "1 24 7 0 0 0 0 0 0 0 0 0 2" },
  { label: "turbo (forces fan high + swingV on)", state: { power: true, temp: 24, mode: TeknopointMode.Cool, fan: TeknopointFan.Auto, turbo: true, model: TeknopointModel.GZ055BE1 }, cppArgs: "1 24 3 0 0 0 0 0 0 1 0 0 2" },
  { label: "econo+health+light+swingH", state: { power: true, temp: 26, mode: TeknopointMode.Cool, fan: TeknopointFan.Low, swingH: true, econo: true, health: true, light: true, model: TeknopointModel.GZ055BE1 }, cppArgs: "1 26 3 2 0 1 1 1 1 0 0 0 2" },
  { label: "on/off timers", state: { power: true, temp: 24, mode: TeknopointMode.Cool, fan: TeknopointFan.Auto, onTimer: 60, offTimer: 120, model: TeknopointModel.GZ055BE1 }, cppArgs: "1 24 3 0 0 0 0 0 0 0 60 120 2" },
  { label: "model TAC09CHSD, off, 30°C", state: { power: false, temp: 30, mode: TeknopointMode.Cool, fan: TeknopointFan.High, model: TeknopointModel.TAC09CHSD }, cppArgs: "0 30 3 5 0 0 0 0 0 0 0 0 1" },
  { label: "dry 16°C fan low", state: { power: true, temp: 16, mode: TeknopointMode.Dry, fan: TeknopointFan.Low, model: TeknopointModel.GZ055BE1 }, cppArgs: "1 16 2 2 0 0 0 0 0 0 0 0 2" },
];

describe("sendTeknopoint raw cross-validation", () => {
  it("matches C++ for default-state bytes", () => {
    const raw = buildTeknopointRaw({});
    expect(encodeTeknopointRaw(raw, 0)).toEqual(parseCppTimings(cpp(`sendTeknopoint ${toHex(raw)}`)));
  });

  it("defaults to the GZ055BE1 model", () => {
    expect(buildTeknopointRaw({}).at(12)! >> 7).toBe(0); // isTcl bit cleared
  });
});

describe("teknopoint state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const lines = cpp(`teknopoint ${tc.cppArgs}`).split("\n");
      expect(toHex(buildTeknopointRaw(tc.state))).toBe(lines[0]!);
      expect(encodeTeknopointRaw(buildTeknopointRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
});

describe("decodeTeknopoint roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const decoded = decodeTeknopoint(sendTeknopoint(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildTeknopointRaw(decoded!))).toBe(toHex(buildTeknopointRaw(tc.state)));
    });
  }

  it("decodes without a header", () => {
    const state = cases[1]!.state;
    const decoded = decodeTeknopoint(sendTeknopoint(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildTeknopointRaw(decoded!))).toBe(toHex(buildTeknopointRaw(state)));
  });
});

// Cross-validate our decoder against the C++ TEKNOPOINT decoder: feed it OUR
// timings and confirm it identifies TEKNOPOINT + the same bytes.
describe("decodeTeknopoint C++ cross-validation", () => {
  for (const tc of cases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildTeknopointRaw(tc.state);
      const timings = encodeTeknopointRaw(raw, 0);
      const out = cpp(`decode ${timings.join(",")}`).split("\n");
      expect(out[0]).toBe("TEKNOPOINT");
      expect(out[1]).toBe(toHex(raw));
      // And our decoder agrees on the same timings.
      expect(toHex(buildTeknopointRaw(decodeTeknopoint(timings)!))).toBe(toHex(raw));
    });
  }
});

// A real capture from a Teknopoint GZ-055B-E1 remote (power on, heat, 23°C,
// fan low, swingV highest). Trailing zero padding is from the hardware buffer.
// The reference C++ decoder reads the same 14 bytes from this frame:
//   TEKNOPOINT 23CB2601002401080A0000011461
describe("decodeTeknopoint real capture", () => {
  const capture = [3753,1434,579,1159,579,1190,579,457,579,457,579,457,579,1159,579,457,579,457,579,1190,579,1159,610,427,579,1190,579,457,579,457,579,1159,610,1159,579,457,579,1159,610,1159,579,457,579,457,579,1190,579,457,579,427,610,1159,579,457,579,457,579,457,579,457,579,457,579,457,579,427,610,427,610,427,610,427,579,457,579,457,579,457,579,457,579,457,579,457,579,457,579,1159,579,457,579,457,579,1190,579,457,579,427,610,1159,579,457,579,457,579,457,579,457,579,457,579,457,579,427,610,427,610,427,579,457,579,1190,579,457,579,457,579,427,610,427,610,427,579,1190,579,457,579,1159,610,427,610,427,610,427,579,457,579,457,579,457,579,457,579,457,579,457,579,427,610,427,610,427,610,427,579,457,579,518,518,457,579,457,579,457,579,457,579,427,610,1159,579,457,579,457,579,457,579,457,579,457,579,457,579,427,610,427,610,427,610,1159,579,457,579,1159,610,427,610,427,579,457,579,1190,579,457,579,457,579,427,610,427,610,1159,579,1190,579,427,610,0,0,0,0,0,0,0];

  it("matches the C++ reference decode of the capture", () => {
    const out = cpp(`decode ${capture.filter((v) => v !== 0).join(",")}`).split("\n");
    expect(out[0]).toBe("TEKNOPOINT");
    expect(out[1]).toBe("23CB2601002401080A0000011461");
  });

  it("decodes the captured frame via the unified dispatcher", () => {
    const result = decode(capture);
    expect(result?.protocol).toBe("teknopoint");
    expect(result?.confidence).toBe("checksum_valid");
  });

  it("reads the expected fields", () => {
    const s = decodeTeknopoint(capture)!;
    expect(s.power).toBe(true);
    expect(s.mode).toBe(TeknopointMode.Heat);
    expect(s.temp).toBe(23);
    expect(s.fan).toBe(TeknopointFan.Low);
    expect(s.swingV).toBe(TeknopointSwingV.Highest);
    expect(s.model).toBe(TeknopointModel.GZ055BE1);
  });
});

describe("decodeTeknopoint rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeTeknopoint([])).toBeNull();
    expect(decodeTeknopoint([1, 2, 3])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildTeknopointRaw(cases[0]!.state);
    raw[13] = (raw[13]! ^ 0xFF) & 0xFF;
    expect(decodeTeknopoint(encodeTeknopointRaw(raw, 0))).toBeNull();
  });
  it("rejects a wrong fixed prefix", () => {
    const raw = buildTeknopointRaw(cases[0]!.state);
    raw[0] = 0x99;
    raw[13] = ((raw[0]! + 0xCB + 0x26 + 0x01 + 0x00 + raw[5]! + raw[6]! + raw[7]! + raw[8]! + raw[9]! + raw[10]! + raw[11]! + raw[12]!) & 0xFF);
    expect(decodeTeknopoint(encodeTeknopointRaw(raw, 0))).toBeNull();
  });
});
