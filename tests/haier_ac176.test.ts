import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildHaierAc176Raw, encodeHaierAc176Raw, sendHaierAc176, decodeHaierAc176,
  HaierAcYrw02Mode, HaierAcYrw02Fan, HaierAc176SwingV, HaierAc176SwingH, HaierAc176Model,
} from "../src/protocols/haier_ac176";
import type { HaierAc176State } from "../src/protocols/haier_ac176";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

const CFAB = 0b11010, POWER = 0b00101;
interface TC { label: string; state: HaierAc176State; args: string; }
// model power temp mode fan swingV swingH health sleep turbo quiet button
const cases: TC[] = [
  { label: "A cool 24 high turbo", state: { model: HaierAc176Model.V9014557A, power: true, temp: 24, mode: HaierAcYrw02Mode.Cool, fan: HaierAcYrw02Fan.High, swingV: HaierAc176SwingV.Top, swingH: HaierAc176SwingH.Left, health: true, turbo: true, button: CFAB }, args: `1 1 24 1 1 1 4 1 0 1 0 ${CFAB}` },
  { label: "B heat 30 low quiet", state: { model: HaierAc176Model.V9014557B, power: true, temp: 30, mode: HaierAcYrw02Mode.Heat, fan: HaierAcYrw02Fan.Low, swingV: HaierAc176SwingV.Auto, swingH: HaierAc176SwingH.Auto, sleep: true, quiet: true, button: CFAB }, args: `2 1 30 4 3 12 7 0 1 0 1 ${CFAB}` },
  { label: "A off 16 dry", state: { model: HaierAc176Model.V9014557A, power: false, temp: 16, mode: HaierAcYrw02Mode.Dry, fan: HaierAcYrw02Fan.Auto, swingV: HaierAc176SwingV.Off, swingH: HaierAc176SwingH.Middle, button: POWER }, args: `1 0 16 2 5 0 0 0 0 0 0 ${POWER}` },
];

describe("buildHaierAc176Raw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw for ${tc.label}`, () => {
      expect(hex(buildHaierAc176Raw(tc.state))).toBe(cpp(`haier176 ${tc.args}`).toLowerCase());
    });
    it(`encode matches C++ send for ${tc.label}`, () => {
      const raw = buildHaierAc176Raw(tc.state);
      expect(encodeHaierAc176Raw(raw)).toEqual(timings(cpp(`sendHaier ${hex(raw)}`)));
    });
  }
});

describe("decodeHaierAc176 roundtrip + C++", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const d = decodeHaierAc176(sendHaierAc176(tc.state));
      expect(d).not.toBeNull();
      expect(hex(buildHaierAc176Raw(d!))).toBe(hex(buildHaierAc176Raw(tc.state)));
    });
    it(`C++ decodes ${tc.label}`, () => {
      const out = cpp(`decode ${sendHaierAc176(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe("HAIER_AC176");
      expect(out[1]!.toLowerCase()).toBe(hex(buildHaierAc176Raw(tc.state)));
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Haier AC176 frame", () => {
    const r = decode(sendHaierAc176(cases[0]!.state));
    expect(r?.protocol).toBe("haier_ac176");
    expect(r?.brand).toBe("haier");
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildHaierAc176Raw(cases[0]!.state);
    raw[13] = (raw[13]! ^ 0xff) & 0xff;
    expect(decodeHaierAc176(encodeHaierAc176Raw(raw))).toBeNull();
  });
});
