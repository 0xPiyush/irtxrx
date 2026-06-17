import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildAmcorRaw, encodeAmcorRaw, sendAmcor, decodeAmcor, amcorValidChecksum,
  AmcorMode, AmcorFan,
} from "../src/protocols/amcor";
import type { AmcorState } from "../src/protocols/amcor";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function t(o: string): number[] { return o.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

interface AC { label: string; state: AmcorState; cppArgs: string; } // power temp mode fan max
const cases: AC[] = [
  { label: "cool 24 med", state: { power: true, temp: 24, mode: AmcorMode.Cool, fan: AmcorFan.Med }, cppArgs: "1 24 1 2 0" },
  { label: "auto 25 auto", state: { power: true, temp: 25, mode: AmcorMode.Auto, fan: AmcorFan.Auto }, cppArgs: "1 25 5 4 0" },
  { label: "heat 30 min", state: { power: true, temp: 30, mode: AmcorMode.Heat, fan: AmcorFan.Min }, cppArgs: "1 30 2 1 0" },
  { label: "dry 18 max-fan", state: { power: true, temp: 18, mode: AmcorMode.Dry, fan: AmcorFan.Max }, cppArgs: "1 18 4 3 0" },
  { label: "fan mode (vent)", state: { power: true, temp: 22, mode: AmcorMode.Fan, fan: AmcorFan.Med }, cppArgs: "1 22 3 2 0" },
  { label: "cool max (->12C)", state: { power: true, temp: 24, mode: AmcorMode.Cool, fan: AmcorFan.Max, max: true }, cppArgs: "1 24 1 3 1" },
  { label: "heat max (->32C)", state: { power: true, temp: 24, mode: AmcorMode.Heat, fan: AmcorFan.Max, max: true }, cppArgs: "1 24 2 3 1" },
  { label: "max ignored in auto", state: { power: true, temp: 24, mode: AmcorMode.Auto, fan: AmcorFan.Auto, max: true }, cppArgs: "1 24 5 4 1" },
  { label: "off", state: { power: false, temp: 26, mode: AmcorMode.Cool, fan: AmcorFan.Med }, cppArgs: "0 26 1 2 0" },
  { label: "min temp 12", state: { power: true, temp: 12, mode: AmcorMode.Cool, fan: AmcorFan.Med }, cppArgs: "1 12 1 2 0" },
];

describe("Amcor build + encode cross-validation", () => {
  for (const tc of cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`amcor ${tc.cppArgs}`).split("\n");
      expect(toHex(buildAmcorRaw(tc.state))).toBe(lines[0]!);
      expect(encodeAmcorRaw(buildAmcorRaw(tc.state), 0)).toEqual(t(lines[1]!));
    });
  }
  it("repeat", () => {
    const raw = buildAmcorRaw(cases[0]!.state);
    expect(encodeAmcorRaw(raw, 1)).toEqual(t(cpp(`sendAmcor ${toHex(raw)} 1`)));
  });
});

describe("Amcor decode", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildAmcorRaw(tc.state);
      const d = decodeAmcor(sendAmcor(tc.state));
      expect(d).not.toBeNull();
      expect(toHex(buildAmcorRaw(d!))).toBe(toHex(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const out = cpp(`decode ${encodeAmcorRaw(buildAmcorRaw(tc.state)).join(",")}`).split("\n");
      expect(out[0]).toBe("AMCOR");
      expect(out[1]).toBe(toHex(buildAmcorRaw(tc.state)));
    });
  }
  it("header-optional + dispatch + rejection", () => {
    const d = decodeAmcor(sendAmcor(cases[0]!.state).slice(2), 0, true);
    expect(toHex(buildAmcorRaw(d!))).toBe(toHex(buildAmcorRaw(cases[0]!.state)));
    expect(decode(sendAmcor(cases[0]!.state))?.protocol).toBe("amcor");
    expect(decodeAmcor([])).toBeNull();
    const bad = buildAmcorRaw(cases[0]!.state); bad[2] ^= 0x02;
    expect(decodeAmcor(encodeAmcorRaw(bad))).toBeNull();
    expect(amcorValidChecksum(buildAmcorRaw(cases[2]!.state))).toBe(true);
  });
});
