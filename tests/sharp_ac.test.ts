import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildSharpAcRaw, encodeSharpAcRaw, sendSharpAc, decodeSharpAc,
  SharpAcModel, SharpAcMode, SharpAcFan, SharpAcSwingV,
} from "../src/protocols/sharp_ac";
import type { SharpAcState } from "../src/protocols/sharp_ac";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

interface TC { label: string; state: SharpAcState; args: string; }
// model power temp mode fan swingV ion
const cases: TC[] = [
  { label: "A907 cool 24 auto", state: { model: SharpAcModel.A907, power: true, temp: 24, mode: SharpAcMode.Cool, fan: SharpAcFan.Auto, swingV: SharpAcSwingV.Ignore }, args: "1 1 24 2 2 0 0" },
  { label: "A907 heat 30 max swing high", state: { model: SharpAcModel.A907, power: true, temp: 30, mode: SharpAcMode.Heat, fan: SharpAcFan.Max, swingV: SharpAcSwingV.High }, args: "1 1 30 1 7 1 0" },
  { label: "A907 auto", state: { model: SharpAcModel.A907, power: true, temp: 25, mode: SharpAcMode.Auto, fan: SharpAcFan.Auto, swingV: SharpAcSwingV.Ignore }, args: "1 1 25 0 2 0 0" },
  { label: "A907 dry off", state: { model: SharpAcModel.A907, power: false, temp: 25, mode: SharpAcMode.Dry, fan: SharpAcFan.Auto, swingV: SharpAcSwingV.Ignore }, args: "1 0 25 3 2 0 0" },
  { label: "A903 cool 20 min ion", state: { model: SharpAcModel.A903, power: true, temp: 20, mode: SharpAcMode.Cool, fan: SharpAcFan.Min, swingV: SharpAcSwingV.Off, ion: true }, args: "3 1 20 2 4 2 1" },
  { label: "A705 cool 18 med", state: { model: SharpAcModel.A705, power: true, temp: 18, mode: SharpAcMode.Cool, fan: SharpAcFan.Med, swingV: SharpAcSwingV.Ignore }, args: "2 1 18 2 3 0 0" },
];

describe("buildSharpAcRaw + encode cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw + timings for ${tc.label}`, () => {
      const raw = buildSharpAcRaw(tc.state);
      expect(hex(raw)).toBe(cpp(`sharpAc ${tc.args}`).toLowerCase());
      expect(encodeSharpAcRaw(raw)).toEqual(timings(cpp(`sendSharpAc ${hex(raw)}`)));
    });
  }
});

describe("decodeSharpAc roundtrip + C++", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      expect(hex(buildSharpAcRaw(decodeSharpAc(sendSharpAc(tc.state))!))).toBe(hex(buildSharpAcRaw(tc.state)));
    });
    it(`C++ decodes ${tc.label}`, () => {
      const out = cpp(`decode ${sendSharpAc(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe("SHARP_AC");
      expect(out[1]!.toLowerCase()).toBe(hex(buildSharpAcRaw(tc.state)));
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Sharp AC frame", () => {
    expect(decode(sendSharpAc(cases[0]!.state))?.protocol).toBe("sharp_ac");
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildSharpAcRaw(cases[0]!.state);
    raw[12] = (raw[12]! ^ 0xf0) & 0xff;
    expect(decodeSharpAc(encodeSharpAcRaw(raw))).toBeNull();
  });
});
