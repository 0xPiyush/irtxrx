import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildHaierAcYrw02Raw, encodeHaierAcYrw02Raw, sendHaierAcYrw02, decodeHaierAcYrw02,
  HaierAcYrw02Mode, HaierAcYrw02Fan, HaierAcYrw02SwingV, HaierAcYrw02SwingH, HaierAcYrw02ModelEnum,
} from "../src/protocols/haier_ac_yrw02";
import type { HaierAcYrw02State } from "../src/protocols/haier_ac_yrw02";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

const CFAB = 0b11010, POWER = 0b00101;
const A = HaierAcYrw02ModelEnum.V9014557A;
interface TC { label: string; state: HaierAcYrw02State; args: string; }
// Model A only — the C++ IRrecv decoder only recognises YR-W02 model "A".
const cases: TC[] = [
  { label: "cool 24 high turbo", state: { model: A, power: true, temp: 24, mode: HaierAcYrw02Mode.Cool, fan: HaierAcYrw02Fan.High, swingV: HaierAcYrw02SwingV.Top, swingH: HaierAcYrw02SwingH.Left, health: true, turbo: true, button: CFAB }, args: `1 1 24 1 1 1 4 1 0 1 0 ${CFAB}` },
  { label: "heat 28 low quiet sleep", state: { model: A, power: true, temp: 28, mode: HaierAcYrw02Mode.Heat, fan: HaierAcYrw02Fan.Low, swingV: HaierAcYrw02SwingV.Auto, swingH: HaierAcYrw02SwingH.Auto, sleep: true, quiet: true, button: CFAB }, args: `1 1 28 4 3 12 7 0 1 0 1 ${CFAB}` },
  { label: "off 18 dry", state: { model: A, power: false, temp: 18, mode: HaierAcYrw02Mode.Dry, fan: HaierAcYrw02Fan.Auto, swingV: HaierAcYrw02SwingV.Off, swingH: HaierAcYrw02SwingH.Middle, button: POWER }, args: `1 0 18 2 5 0 0 0 0 0 0 ${POWER}` },
];

describe("buildHaierAcYrw02Raw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw for ${tc.label}`, () => {
      expect(hex(buildHaierAcYrw02Raw(tc.state))).toBe(cpp(`haierYrw02 ${tc.args}`).toLowerCase());
    });
    it(`encode matches C++ send for ${tc.label}`, () => {
      const raw = buildHaierAcYrw02Raw(tc.state);
      expect(encodeHaierAcYrw02Raw(raw)).toEqual(timings(cpp(`sendHaier ${hex(raw)}`)));
    });
  }
});

describe("decodeHaierAcYrw02 roundtrip + C++", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const d = decodeHaierAcYrw02(sendHaierAcYrw02(tc.state));
      expect(d).not.toBeNull();
      expect(hex(buildHaierAcYrw02Raw(d!))).toBe(hex(buildHaierAcYrw02Raw(tc.state)));
    });
    it(`C++ decodes ${tc.label}`, () => {
      const out = cpp(`decode ${sendHaierAcYrw02(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe("HAIER_AC_YRW02");
      expect(out[1]!.toLowerCase()).toBe(hex(buildHaierAcYrw02Raw(tc.state)));
    });
  }

  it("handles model B (build + roundtrip; C++ IRrecv only decodes model A)", () => {
    const s: HaierAcYrw02State = { model: HaierAcYrw02ModelEnum.V9014557B, power: true, temp: 22, mode: HaierAcYrw02Mode.Cool, fan: HaierAcYrw02Fan.Med, button: CFAB };
    const d = decodeHaierAcYrw02(sendHaierAcYrw02(s));
    expect(d?.model).toBe(HaierAcYrw02ModelEnum.V9014557B);
    expect(hex(buildHaierAcYrw02Raw(d!))).toBe(hex(buildHaierAcYrw02Raw(s)));
  });
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Haier YR-W02 frame", () => {
    expect(decode(sendHaierAcYrw02(cases[0]!.state))?.protocol).toBe("haier_ac_yrw02");
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildHaierAcYrw02Raw(cases[0]!.state);
    raw[13] = (raw[13]! ^ 0xff) & 0xff;
    expect(decodeHaierAcYrw02(encodeHaierAcYrw02Raw(raw))).toBeNull();
  });
});
