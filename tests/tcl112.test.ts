import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  sendTcl112,
  encodeTcl112Raw,
  buildTcl112Raw,
  decodeTcl112,
  Tcl112Mode,
  Tcl112Fan,
  Tcl112SwingV,
  Tcl112Model,
} from "../src/protocols/tcl112";
import type { Tcl112State } from "../src/protocols/tcl112";

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
  state: Tcl112State;
  // power temp mode fan swingV swingH econo health light turbo onTimer offTimer model
  cppArgs: string;
}

const cases: TestCase[] = [
  { label: "cool 24°C fan auto (TAC09CHSD)", state: { power: true, temp: 24, mode: Tcl112Mode.Cool, fan: Tcl112Fan.Auto, model: Tcl112Model.TAC09CHSD }, cppArgs: "1 24 3 0 0 0 0 0 0 0 0 0 1" },
  { label: "heat 22.5°C fan high swingV on", state: { power: true, temp: 22.5, mode: Tcl112Mode.Heat, fan: Tcl112Fan.High, swingV: Tcl112SwingV.On, model: Tcl112Model.TAC09CHSD }, cppArgs: "1 22.5 1 5 7 0 0 0 0 0 0 0 1" },
  { label: "fan mode (forces high)", state: { power: true, temp: 24, mode: Tcl112Mode.Fan, fan: Tcl112Fan.Auto, model: Tcl112Model.TAC09CHSD }, cppArgs: "1 24 7 0 0 0 0 0 0 0 0 0 1" },
  { label: "turbo (forces fan high + swingV on)", state: { power: true, temp: 24, mode: Tcl112Mode.Cool, fan: Tcl112Fan.Auto, turbo: true, model: Tcl112Model.TAC09CHSD }, cppArgs: "1 24 3 0 0 0 0 0 0 1 0 0 1" },
  { label: "econo+health+light+swingH", state: { power: true, temp: 26, mode: Tcl112Mode.Cool, fan: Tcl112Fan.Low, swingH: true, econo: true, health: true, light: true, model: Tcl112Model.TAC09CHSD }, cppArgs: "1 26 3 2 0 1 1 1 1 0 0 0 1" },
  { label: "on/off timers", state: { power: true, temp: 24, mode: Tcl112Mode.Cool, fan: Tcl112Fan.Auto, onTimer: 60, offTimer: 120, model: Tcl112Model.TAC09CHSD }, cppArgs: "1 24 3 0 0 0 0 0 0 0 60 120 1" },
  { label: "model GZ055BE1, off, 30°C", state: { power: false, temp: 30, mode: Tcl112Mode.Cool, fan: Tcl112Fan.High, model: Tcl112Model.GZ055BE1 }, cppArgs: "0 30 3 5 0 0 0 0 0 0 0 0 2" },
  { label: "dry 16°C fan low", state: { power: true, temp: 16, mode: Tcl112Mode.Dry, fan: Tcl112Fan.Low, model: Tcl112Model.TAC09CHSD }, cppArgs: "1 16 2 2 0 0 0 0 0 0 0 0 1" },
];

describe("sendTcl112 raw cross-validation", () => {
  it("matches C++ for default-state bytes", () => {
    const raw = buildTcl112Raw({});
    expect(encodeTcl112Raw(raw, 0)).toEqual(parseCppTimings(cpp(`sendTcl112Ac ${toHex(raw)}`)));
  });
});

describe("tcl112 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ for ${tc.label}`, () => {
      const lines = cpp(`tcl112 ${tc.cppArgs}`).split("\n");
      expect(toHex(buildTcl112Raw(tc.state))).toBe(lines[0]!);
      expect(encodeTcl112Raw(buildTcl112Raw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
});

describe("decodeTcl112 roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const decoded = decodeTcl112(sendTcl112(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildTcl112Raw(decoded!))).toBe(toHex(buildTcl112Raw(tc.state)));
    });
  }

  it("decodes without a header", () => {
    const state = cases[1]!.state;
    const decoded = decodeTcl112(sendTcl112(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildTcl112Raw(decoded!))).toBe(toHex(buildTcl112Raw(state)));
  });
});

// Cross-validate our decoder against the shared C++ Mitsubishi112/TCL112AC
// decoder: feed it OUR timings and confirm it identifies TCL112AC + same bytes.
describe("decodeTcl112 C++ (Mitsubishi112) cross-validation", () => {
  for (const tc of cases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildTcl112Raw(tc.state);
      const timings = encodeTcl112Raw(raw, 0);
      const out = cpp(`decode ${timings.join(",")}`).split("\n");
      expect(out[0]).toBe("TCL112AC");
      expect(out[1]).toBe(toHex(raw));
      // And our decoder agrees on the same timings.
      expect(toHex(buildTcl112Raw(decodeTcl112(timings)!))).toBe(toHex(raw));
    });
  }
});

describe("decodeTcl112 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeTcl112([])).toBeNull();
    expect(decodeTcl112([1, 2, 3])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildTcl112Raw(cases[0]!.state);
    raw[13] = (raw[13]! ^ 0xFF) & 0xFF;
    expect(decodeTcl112(encodeTcl112Raw(raw, 0))).toBeNull();
  });
  it("rejects a wrong fixed prefix", () => {
    const raw = buildTcl112Raw(cases[0]!.state);
    raw[0] = 0x99;
    raw[13] = ((raw[0]! + 0xCB + 0x26 + 0x01 + 0x00 + raw[5]! + raw[6]! + raw[7]! + raw[8]! + raw[9]! + raw[10]! + raw[11]! + raw[12]!) & 0xFF);
    expect(decodeTcl112(encodeTcl112Raw(raw, 0))).toBeNull();
  });
});
