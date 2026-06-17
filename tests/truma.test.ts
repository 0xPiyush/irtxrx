import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildTrumaRaw, encodeTrumaRaw, sendTruma, decodeTruma, trumaValidChecksum,
  TrumaMode, TrumaFan, TRUMA_BITS,
} from "../src/protocols/truma";
import type { TrumaState } from "../src/protocols/truma";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function t(o: string): number[] { return o.split(",").map(Number); }
function hex14(v: bigint): string { return v.toString(16).toUpperCase().padStart(14, "0"); }
beforeAll(() => { ensureRunner(); });

interface TC { label: string; state: TrumaState; cppArgs: string; } // power temp mode fan
const cases: TC[] = [
  { label: "cool 24 high", state: { power: true, temp: 24, mode: TrumaMode.Cool, fan: TrumaFan.High }, cppArgs: "1 24 2 4" },
  { label: "auto 16 high", state: { power: true, temp: 16, mode: TrumaMode.Auto, fan: TrumaFan.High }, cppArgs: "1 16 0 4" },
  { label: "fan 31 med", state: { power: true, temp: 31, mode: TrumaMode.Fan, fan: TrumaFan.Med }, cppArgs: "1 31 3 5" },
  { label: "cool 20 low", state: { power: true, temp: 20, mode: TrumaMode.Cool, fan: TrumaFan.Low }, cppArgs: "1 20 2 6" },
  { label: "cool quiet (allowed)", state: { power: true, temp: 22, mode: TrumaMode.Cool, fan: TrumaFan.Quiet }, cppArgs: "1 22 2 3" },
  { label: "auto quiet (-> high)", state: { power: true, temp: 22, mode: TrumaMode.Auto, fan: TrumaFan.Quiet }, cppArgs: "1 22 0 3" },
  { label: "off", state: { power: false, temp: 24, mode: TrumaMode.Cool, fan: TrumaFan.High }, cppArgs: "0 24 2 4" },
];

describe("Truma build + encode cross-validation", () => {
  for (const tc of cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`truma ${tc.cppArgs}`).split("\n");
      expect(hex14(buildTrumaRaw(tc.state))).toBe(lines[0]!);
      expect(encodeTrumaRaw(buildTrumaRaw(tc.state), 0)).toEqual(t(lines[1]!));
    });
  }
  it("repeat", () => {
    const raw = buildTrumaRaw(cases[0]!.state);
    expect(encodeTrumaRaw(raw, 1)).toEqual(t(cpp(`sendTruma ${hex14(raw)} 1`)));
  });
});

describe("Truma decode", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildTrumaRaw(tc.state);
      const d = decodeTruma(sendTruma(tc.state));
      expect(d).not.toBeNull();
      expect(hex14(buildTrumaRaw(d!))).toBe(hex14(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildTrumaRaw(tc.state);
      const out = cpp(`decodeValue ${encodeTrumaRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("TRUMA");
      expect(BigInt(`0x${out[1]}`)).toBe(raw);
    });
  }
  it("header-optional + dispatch + rejection", () => {
    const d = decodeTruma(sendTruma(cases[0]!.state).slice(2), 0, true);
    expect(hex14(buildTrumaRaw(d!))).toBe(hex14(buildTrumaRaw(cases[0]!.state)));
    expect(decode(sendTruma(cases[0]!.state))?.protocol).toBe("truma");
    expect(decodeTruma([])).toBeNull();
    expect(trumaValidChecksum(buildTrumaRaw(cases[2]!.state))).toBe(true);
    expect(TRUMA_BITS).toBe(56);
  });
});
