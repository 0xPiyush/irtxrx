import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildEcoclimRaw, encodeEcoclimRaw, sendEcoclim, decodeEcoclim,
  EcoclimMode, EcoclimFan, ECOCLIM_BITS,
} from "../src/protocols/ecoclim";
import type { EcoclimState } from "../src/protocols/ecoclim";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function t(o: string): number[] { return o.split(",").map(Number); }
function hex14(v: bigint): string { return v.toString(16).toUpperCase().padStart(14, "0"); }
beforeAll(() => { ensureRunner(); });

interface EC { label: string; state: EcoclimState; cppArgs: string; }
// power temp mode fan sensorTemp clock onTimer offTimer type
const cases: EC[] = [
  { label: "cool 24 auto", state: { power: true, temp: 24, mode: EcoclimMode.Cool, fan: EcoclimFan.Auto, sensorTemp: 22 }, cppArgs: "1 24 1 3 22 0 -1 -1 0" },
  { label: "heat 30 max", state: { power: true, temp: 30, mode: EcoclimMode.Heat, fan: EcoclimFan.Max, sensorTemp: 25 }, cppArgs: "1 30 5 2 25 0 -1 -1 0" },
  { label: "dry 18 min", state: { power: true, temp: 18, mode: EcoclimMode.Dry, fan: EcoclimFan.Min, sensorTemp: 20 }, cppArgs: "1 18 2 0 20 0 -1 -1 0" },
  { label: "recycle med", state: { power: true, temp: 22, mode: EcoclimMode.Recycle, fan: EcoclimFan.Med, sensorTemp: 22 }, cppArgs: "1 22 3 1 22 0 -1 -1 0" },
  { label: "fan mode", state: { power: true, temp: 22, mode: EcoclimMode.Fan, fan: EcoclimFan.Auto, sensorTemp: 22 }, cppArgs: "1 22 4 3 22 0 -1 -1 0" },
  { label: "sleep mode", state: { power: true, temp: 24, mode: EcoclimMode.Sleep, fan: EcoclimFan.Auto, sensorTemp: 22 }, cppArgs: "1 24 7 3 22 0 -1 -1 0" },
  { label: "clock 13:30", state: { power: true, temp: 24, mode: EcoclimMode.Cool, fan: EcoclimFan.Auto, sensorTemp: 22, clock: 810 }, cppArgs: "1 24 1 3 22 810 -1 -1 0" },
  { label: "onTimer 120", state: { power: true, temp: 24, mode: EcoclimMode.Cool, fan: EcoclimFan.Auto, sensorTemp: 22, onTimer: 120 }, cppArgs: "1 24 1 3 22 0 120 -1 0" },
  { label: "offTimer 90", state: { power: true, temp: 24, mode: EcoclimMode.Cool, fan: EcoclimFan.Auto, sensorTemp: 22, offTimer: 90 }, cppArgs: "1 24 1 3 22 0 -1 90 0" },
  { label: "slave", state: { power: true, temp: 24, mode: EcoclimMode.Cool, fan: EcoclimFan.Auto, sensorTemp: 22, type: 0b0111 }, cppArgs: "1 24 1 3 22 0 -1 -1 7" },
  { label: "off", state: { power: false, temp: 24, mode: EcoclimMode.Cool, fan: EcoclimFan.Auto, sensorTemp: 22 }, cppArgs: "0 24 1 3 22 0 -1 -1 0" },
];

describe("Ecoclim build + encode cross-validation", () => {
  for (const tc of cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`ecoclim ${tc.cppArgs}`).split("\n");
      expect(hex14(buildEcoclimRaw(tc.state))).toBe(lines[0]!);
      expect(encodeEcoclimRaw(buildEcoclimRaw(tc.state), 0)).toEqual(t(lines[1]!));
    });
  }
  it("repeat", () => {
    const raw = buildEcoclimRaw(cases[0]!.state);
    expect(encodeEcoclimRaw(raw, 1)).toEqual(t(cpp(`sendEcoclim ${hex14(raw)} 1`)));
  });
});

describe("Ecoclim decode", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildEcoclimRaw(tc.state);
      const d = decodeEcoclim(sendEcoclim(tc.state));
      expect(d).not.toBeNull();
      expect(hex14(buildEcoclimRaw(d!))).toBe(hex14(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildEcoclimRaw(tc.state);
      const out = cpp(`decodeValue ${encodeEcoclimRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("ECOCLIM");
      expect(BigInt(`0x${out[1]}`)).toBe(raw);
    });
  }
  it("dispatch + rejection", () => {
    expect(decode(sendEcoclim(cases[0]!.state))?.protocol).toBe("ecoclim");
    expect(decodeEcoclim([])).toBeNull();
    expect(ECOCLIM_BITS).toBe(56);
  });
});
