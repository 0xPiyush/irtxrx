import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildSanyoAc88Raw, encodeSanyoAc88Raw, sendSanyoAc88, decodeSanyoAc88,
  SanyoAc88Mode, SanyoAc88Fan,
} from "../src/protocols/sanyo_ac88";
import type { SanyoAc88State } from "../src/protocols/sanyo_ac88";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

interface TC { label: string; state: SanyoAc88State; args: string; }
// power temp mode fan swingV filter turbo sleep clockMins
const cases: TC[] = [
  { label: "cool 24 auto", state: { power: true, temp: 24, mode: SanyoAc88Mode.Cool, fan: SanyoAc88Fan.Auto }, args: "1 24 2 0 0 0 0 0 0" },
  { label: "heat 18 high full", state: { power: true, temp: 18, mode: SanyoAc88Mode.Heat, fan: SanyoAc88Fan.High, swingV: true, filter: true, turbo: true, sleep: true, clock: 750 }, args: "1 18 4 3 1 1 1 1 750" },
  { label: "fan 30 medium", state: { power: false, temp: 30, mode: SanyoAc88Mode.Fan, fan: SanyoAc88Fan.Medium }, args: "0 30 5 2 0 0 0 0 0" },
];

describe("buildSanyoAc88Raw + encode cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw + timings for ${tc.label}`, () => {
      const raw = buildSanyoAc88Raw(tc.state);
      expect(hex(raw)).toBe(cpp(`sanyoAc88 ${tc.args}`).toLowerCase());
      for (const rep of [0, 2]) expect(encodeSanyoAc88Raw(raw, rep)).toEqual(timings(cpp(`sendSanyoAc88 ${hex(raw)} ${rep}`)));
    });
  }
});

describe("decodeSanyoAc88 roundtrip + C++", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      expect(hex(buildSanyoAc88Raw(decodeSanyoAc88(sendSanyoAc88(tc.state))!))).toBe(hex(buildSanyoAc88Raw(tc.state)));
    });
    it(`C++ decodes ${tc.label} (sent 3x)`, () => {
      const out = cpp(`decode ${sendSanyoAc88(tc.state, 2).join(",")}`).split("\n");
      expect(out[0]).toBe("SANYO_AC88");
      expect(out[1]!.toLowerCase()).toBe(hex(buildSanyoAc88Raw(tc.state)));
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Sanyo AC88 frame", () => {
    expect(decode(sendSanyoAc88(cases[0]!.state))?.protocol).toBe("sanyo_ac88");
  });
  it("rejects a wrong lead byte", () => {
    const raw = buildSanyoAc88Raw(cases[0]!.state);
    raw[0] = 0x99;
    expect(decodeSanyoAc88(encodeSanyoAc88Raw(raw))).toBeNull();
  });
});
