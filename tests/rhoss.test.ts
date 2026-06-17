import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildRhossRaw, encodeRhossRaw, sendRhoss, decodeRhoss, rhossValidChecksum,
  RhossMode, RhossFan,
} from "../src/protocols/rhoss";
import type { RhossState } from "../src/protocols/rhoss";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function t(o: string): number[] { return o.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

interface RC { label: string; state: RhossState; cppArgs: string; } // power temp mode fan swing
const cases: RC[] = [
  { label: "cool 24 med", state: { power: true, temp: 24, mode: RhossMode.Cool, fan: RhossFan.Med }, cppArgs: "1 24 2 2 0" },
  { label: "heat 30 max", state: { power: true, temp: 30, mode: RhossMode.Heat, fan: RhossFan.Max }, cppArgs: "1 30 1 3 0" },
  { label: "dry 16 min", state: { power: true, temp: 16, mode: RhossMode.Dry, fan: RhossFan.Min }, cppArgs: "1 16 3 1 0" },
  { label: "fan auto", state: { power: true, temp: 22, mode: RhossMode.Fan, fan: RhossFan.Auto }, cppArgs: "1 22 4 0 0" },
  { label: "auto 25", state: { power: true, temp: 25, mode: RhossMode.Auto, fan: RhossFan.Auto }, cppArgs: "1 25 5 0 0" },
  { label: "cool swing", state: { power: true, temp: 23, mode: RhossMode.Cool, fan: RhossFan.Med, swing: true }, cppArgs: "1 23 2 2 1" },
  { label: "off", state: { power: false, temp: 21, mode: RhossMode.Cool, fan: RhossFan.Auto }, cppArgs: "0 21 2 0 0" },
];

describe("Rhoss build + encode cross-validation", () => {
  for (const tc of cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`rhoss ${tc.cppArgs}`).split("\n");
      expect(toHex(buildRhossRaw(tc.state))).toBe(lines[0]!);
      expect(encodeRhossRaw(buildRhossRaw(tc.state), 0)).toEqual(t(lines[1]!));
    });
  }
  it("repeat", () => {
    const raw = buildRhossRaw(cases[0]!.state);
    expect(encodeRhossRaw(raw, 1)).toEqual(t(cpp(`sendRhoss ${toHex(raw)} 1`)));
  });
});

describe("Rhoss decode", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildRhossRaw(tc.state);
      const d = decodeRhoss(sendRhoss(tc.state));
      expect(d).not.toBeNull();
      expect(toHex(buildRhossRaw(d!))).toBe(toHex(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const out = cpp(`decode ${encodeRhossRaw(buildRhossRaw(tc.state)).join(",")}`).split("\n");
      expect(out[0]).toBe("RHOSS");
      expect(out[1]).toBe(toHex(buildRhossRaw(tc.state)));
    });
  }
  it("header-optional + dispatch + rejection", () => {
    const d = decodeRhoss(sendRhoss(cases[0]!.state).slice(2), 0, true);
    expect(toHex(buildRhossRaw(d!))).toBe(toHex(buildRhossRaw(cases[0]!.state)));
    expect(decode(sendRhoss(cases[0]!.state))?.protocol).toBe("rhoss");
    expect(decodeRhoss([])).toBeNull();
    const bad = buildRhossRaw(cases[0]!.state); bad[1] ^= 0x0f;
    expect(decodeRhoss(encodeRhossRaw(bad))).toBeNull();
    expect(rhossValidChecksum(buildRhossRaw(cases[1]!.state))).toBe(true);
  });
});
