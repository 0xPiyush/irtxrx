import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildCoronaAcRaw, encodeCoronaAcRaw, sendCoronaAc, decodeCoronaAc, coronaAcValidSection,
  CoronaAcMode, CoronaAcFan,
} from "../src/protocols/corona_ac";
import type { CoronaAcState } from "../src/protocols/corona_ac";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function t(o: string): number[] { return o.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

interface CC { label: string; state: CoronaAcState; cppArgs: string; }
// power temp mode fan econo swingV onTimer offTimer powerButton
const cases: CC[] = [
  { label: "cool 24 auto on", state: { power: true, temp: 24, mode: CoronaAcMode.Cool, fan: CoronaAcFan.Auto, powerButton: true }, cppArgs: "1 24 2 0 0 0 0 0 1" },
  { label: "heat 30 high", state: { power: true, temp: 30, mode: CoronaAcMode.Heat, fan: CoronaAcFan.High, powerButton: true }, cppArgs: "1 30 0 3 0 0 0 0 1" },
  { label: "dry 17 low", state: { power: true, temp: 17, mode: CoronaAcMode.Dry, fan: CoronaAcFan.Low, powerButton: true }, cppArgs: "1 17 1 1 0 0 0 0 1" },
  { label: "fan med", state: { power: true, temp: 22, mode: CoronaAcMode.Fan, fan: CoronaAcFan.Medium, powerButton: true }, cppArgs: "1 22 3 2 0 0 0 0 1" },
  { label: "cool econo", state: { power: true, temp: 23, mode: CoronaAcMode.Cool, fan: CoronaAcFan.Auto, econo: true, powerButton: true }, cppArgs: "1 23 2 0 1 0 0 0 1" },
  { label: "cool swingV", state: { power: true, temp: 23, mode: CoronaAcMode.Cool, fan: CoronaAcFan.Auto, swingVToggle: true, powerButton: true }, cppArgs: "1 23 2 0 0 1 0 0 1" },
  { label: "power off no button", state: { power: true, temp: 24, mode: CoronaAcMode.Cool, fan: CoronaAcFan.Auto, powerButton: false }, cppArgs: "1 24 2 0 0 0 0 0 0" },
  { label: "onTimer 120", state: { power: true, temp: 24, mode: CoronaAcMode.Cool, fan: CoronaAcFan.Auto, onTimer: 120, powerButton: true }, cppArgs: "1 24 2 0 0 0 120 0 1" },
  { label: "offTimer 90", state: { power: true, temp: 24, mode: CoronaAcMode.Cool, fan: CoronaAcFan.Auto, offTimer: 90, powerButton: true }, cppArgs: "1 24 2 0 0 0 0 90 1" },
  { label: "off", state: { power: false, temp: 26, mode: CoronaAcMode.Cool, fan: CoronaAcFan.Auto, powerButton: true }, cppArgs: "0 26 2 0 0 0 0 0 1" },
];

describe("Corona build + encode cross-validation", () => {
  for (const tc of cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`corona ${tc.cppArgs}`).split("\n");
      expect(toHex(buildCoronaAcRaw(tc.state))).toBe(lines[0]!);
      expect(encodeCoronaAcRaw(buildCoronaAcRaw(tc.state), 0)).toEqual(t(lines[1]!));
    });
  }
  it("repeat", () => {
    const raw = buildCoronaAcRaw(cases[0]!.state);
    expect(encodeCoronaAcRaw(raw, 1)).toEqual(t(cpp(`sendCorona ${toHex(raw)} 1`)));
  });
});

describe("Corona decode", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildCoronaAcRaw(tc.state);
      const d = decodeCoronaAc(sendCoronaAc(tc.state));
      expect(d).not.toBeNull();
      expect(toHex(buildCoronaAcRaw(d!))).toBe(toHex(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const out = cpp(`decode ${encodeCoronaAcRaw(buildCoronaAcRaw(tc.state)).join(",")}`).split("\n");
      expect(out[0]).toBe("CORONA_AC");
      expect(out[1]).toBe(toHex(buildCoronaAcRaw(tc.state)));
    });
  }
  it("reads timer + dispatch + rejection", () => {
    const d = decodeCoronaAc(sendCoronaAc(cases[7]!.state))!;
    expect(d.onTimer).toBe(120);
    expect(decode(sendCoronaAc(cases[0]!.state))?.protocol).toBe("corona_ac");
    expect(decodeCoronaAc([])).toBeNull();
    const bad = buildCoronaAcRaw(cases[0]!.state); bad[3] ^= 0x01; // break inversion
    expect(decodeCoronaAc(encodeCoronaAcRaw(bad))).toBeNull();
    expect(coronaAcValidSection(buildCoronaAcRaw(cases[1]!.state), 0)).toBe(true);
  });
});
