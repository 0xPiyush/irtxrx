import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildHaierAc160Raw, encodeHaierAc160Raw, sendHaierAc160, decodeHaierAc160,
  HaierAcYrw02Mode, HaierAcYrw02Fan, HaierAc160SwingV,
} from "../src/protocols/haier_ac160";
import type { HaierAc160State } from "../src/protocols/haier_ac160";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

const CFAB = 0b11010;
interface TC { label: string; state: HaierAc160State; args: string; }
// power temp mode fan swingV health sleep turbo quiet clean auxHeating button
const cases: TC[] = [
  { label: "cool 24 high turbo", state: { power: true, temp: 24, mode: HaierAcYrw02Mode.Cool, fan: HaierAcYrw02Fan.High, swingV: HaierAc160SwingV.Highest, health: true, turbo: true, button: CFAB }, args: `1 24 1 1 2 1 0 1 0 0 0 ${CFAB}` },
  { label: "heat 28 low quiet aux", state: { power: true, temp: 28, mode: HaierAcYrw02Mode.Heat, fan: HaierAcYrw02Fan.Low, swingV: HaierAc160SwingV.Auto, sleep: true, quiet: true, auxHeating: true, button: CFAB }, args: `1 28 4 3 12 0 1 0 1 0 1 ${CFAB}` },
  { label: "dry 20 clean off", state: { power: false, temp: 20, mode: HaierAcYrw02Mode.Dry, fan: HaierAcYrw02Fan.Auto, swingV: HaierAc160SwingV.Middle, clean: true, button: CFAB }, args: `0 20 2 5 6 0 0 0 0 1 0 ${CFAB}` },
];

describe("buildHaierAc160Raw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw for ${tc.label}`, () => {
      expect(hex(buildHaierAc160Raw(tc.state))).toBe(cpp(`haier160 ${tc.args}`).toLowerCase());
    });
    it(`encode matches C++ send for ${tc.label}`, () => {
      const raw = buildHaierAc160Raw(tc.state);
      expect(encodeHaierAc160Raw(raw)).toEqual(timings(cpp(`sendHaier ${hex(raw)}`)));
    });
  }
});

describe("decodeHaierAc160 roundtrip + C++", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const d = decodeHaierAc160(sendHaierAc160(tc.state));
      expect(d).not.toBeNull();
      expect(hex(buildHaierAc160Raw(d!))).toBe(hex(buildHaierAc160Raw(tc.state)));
    });
    it(`C++ decodes ${tc.label}`, () => {
      const out = cpp(`decode ${sendHaierAc160(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe("HAIER_AC160");
      expect(out[1]!.toLowerCase()).toBe(hex(buildHaierAc160Raw(tc.state)));
    });
  }

  it("reads fields (clean / aux)", () => {
    const heat = decodeHaierAc160(sendHaierAc160(cases[1]!.state))!;
    expect(heat.auxHeating).toBe(true);
    expect(heat.quiet).toBe(true);
    const dry = decodeHaierAc160(sendHaierAc160(cases[2]!.state))!;
    expect(dry.clean).toBe(true);
  });
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Haier AC160 frame", () => {
    expect(decode(sendHaierAc160(cases[0]!.state))?.protocol).toBe("haier_ac160");
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildHaierAc160Raw(cases[0]!.state);
    raw[19] = (raw[19]! ^ 0xff) & 0xff;
    expect(decodeHaierAc160(encodeHaierAc160Raw(raw))).toBeNull();
  });
});
