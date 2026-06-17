import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildTechnibelAcRaw, encodeTechnibelAcRaw, sendTechnibelAc, decodeTechnibelAc, technibelAcValidChecksum,
  TechnibelAcMode, TechnibelAcFan,
} from "../src/protocols/technibel_ac";
import type { TechnibelAcState } from "../src/protocols/technibel_ac";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function t(o: string): number[] { return o.split(",").map(Number); }
function hex14(v: bigint): string { return v.toString(16).toUpperCase().padStart(14, "0"); }
beforeAll(() => { ensureRunner(); });

interface TC { label: string; state: TechnibelAcState; cppArgs: string; } // power temp celsius mode fan swing sleep timer
const cases: TC[] = [
  { label: "cool 24 med", state: { power: true, temp: 24, mode: TechnibelAcMode.Cool, fan: TechnibelAcFan.Medium }, cppArgs: "1 24 1 1 2 0 0 0" },
  { label: "heat 31 high", state: { power: true, temp: 31, mode: TechnibelAcMode.Heat, fan: TechnibelAcFan.High }, cppArgs: "1 31 1 8 4 0 0 0" },
  { label: "dry forces low", state: { power: true, temp: 20, mode: TechnibelAcMode.Dry, fan: TechnibelAcFan.High }, cppArgs: "1 20 1 2 4 0 0 0" },
  { label: "fan low", state: { power: true, temp: 22, mode: TechnibelAcMode.Fan, fan: TechnibelAcFan.Low }, cppArgs: "1 22 1 4 1 0 0 0" },
  { label: "cool 75F", state: { power: true, temp: 75, celsius: false, mode: TechnibelAcMode.Cool, fan: TechnibelAcFan.Medium }, cppArgs: "1 75 0 1 2 0 0 0" },
  { label: "cool swing", state: { power: true, temp: 24, mode: TechnibelAcMode.Cool, fan: TechnibelAcFan.Medium, swing: true }, cppArgs: "1 24 1 1 2 1 0 0" },
  { label: "cool sleep", state: { power: true, temp: 24, mode: TechnibelAcMode.Cool, fan: TechnibelAcFan.Low, sleep: true }, cppArgs: "1 24 1 1 1 0 1 0" },
  { label: "timer 3h", state: { power: true, temp: 24, mode: TechnibelAcMode.Cool, fan: TechnibelAcFan.Medium, timer: 180 }, cppArgs: "1 24 1 1 2 0 0 180" },
  { label: "off", state: { power: false, temp: 26, mode: TechnibelAcMode.Cool, fan: TechnibelAcFan.Medium }, cppArgs: "0 26 1 1 2 0 0 0" },
];

describe("Technibel build + encode cross-validation", () => {
  for (const tc of cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`technibel ${tc.cppArgs}`).split("\n");
      expect(hex14(buildTechnibelAcRaw(tc.state))).toBe(lines[0]!);
      expect(encodeTechnibelAcRaw(buildTechnibelAcRaw(tc.state), 0)).toEqual(t(lines[1]!));
    });
  }
  it("repeat", () => {
    const raw = buildTechnibelAcRaw(cases[0]!.state);
    expect(encodeTechnibelAcRaw(raw, 1)).toEqual(t(cpp(`sendTechnibel ${hex14(raw)} 1`)));
  });
});

describe("Technibel decode", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildTechnibelAcRaw(tc.state);
      const d = decodeTechnibelAc(sendTechnibelAc(tc.state));
      expect(d).not.toBeNull();
      expect(hex14(buildTechnibelAcRaw(d!))).toBe(hex14(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildTechnibelAcRaw(tc.state);
      const out = cpp(`decodeValue ${encodeTechnibelAcRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("TECHNIBEL_AC");
      expect(BigInt(`0x${out[1]}`)).toBe(raw);
    });
  }
  it("header-optional + dispatch + rejection", () => {
    const d = decodeTechnibelAc(sendTechnibelAc(cases[0]!.state).slice(2), 0, true);
    expect(hex14(buildTechnibelAcRaw(d!))).toBe(hex14(buildTechnibelAcRaw(cases[0]!.state)));
    expect(decode(sendTechnibelAc(cases[0]!.state))?.protocol).toBe("technibel_ac");
    expect(decodeTechnibelAc([])).toBeNull();
    expect(technibelAcValidChecksum(buildTechnibelAcRaw(cases[1]!.state))).toBe(true);
  });
});
