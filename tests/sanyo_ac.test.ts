import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildSanyoAcRaw, encodeSanyoAcRaw, sendSanyoAc, decodeSanyoAc,
  SanyoAcMode, SanyoAcFan, SanyoAcSwingV,
} from "../src/protocols/sanyo_ac";
import type { SanyoAcState } from "../src/protocols/sanyo_ac";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

interface TC { label: string; state: SanyoAcState; args: string; }
// power temp mode fan swingV sleep beep sensor sensorTemp offTimerMins
const cases: TC[] = [
  { label: "cool 24 auto", state: { power: true, temp: 24, mode: SanyoAcMode.Cool, fan: SanyoAcFan.Auto, swingV: SanyoAcSwingV.Auto, beep: true, sensorTemp: 25 }, args: "1 24 2 0 0 0 1 0 25 0" },
  { label: "heat 30 high swing sleep", state: { power: true, temp: 30, mode: SanyoAcMode.Heat, fan: SanyoAcFan.High, swingV: SanyoAcSwingV.Highest, sleep: true, beep: true, sensorTemp: 25 }, args: "1 30 1 1 7 1 1 0 25 0" },
  { label: "off off-timer + sensor", state: { power: false, temp: 18, mode: SanyoAcMode.Dry, fan: SanyoAcFan.Low, swingV: SanyoAcSwingV.Lowest, beep: false, sensor: true, sensorTemp: 22, offTimer: 180 }, args: "0 18 3 2 2 0 0 1 22 180" },
];

describe("buildSanyoAcRaw + encode cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw + timings for ${tc.label}`, () => {
      const raw = buildSanyoAcRaw(tc.state);
      expect(hex(raw)).toBe(cpp(`sanyoAc ${tc.args}`).toLowerCase());
      for (const rep of [0, 1]) expect(encodeSanyoAcRaw(raw, rep)).toEqual(timings(cpp(`sendSanyoAc ${hex(raw)} ${rep}`)));
    });
  }
});

describe("decodeSanyoAc roundtrip + C++", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      expect(hex(buildSanyoAcRaw(decodeSanyoAc(sendSanyoAc(tc.state))!))).toBe(hex(buildSanyoAcRaw(tc.state)));
    });
    it(`C++ decodes ${tc.label}`, () => {
      const out = cpp(`decode ${sendSanyoAc(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe("SANYO_AC");
      expect(out[1]!.toLowerCase()).toBe(hex(buildSanyoAcRaw(tc.state)));
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Sanyo AC frame", () => {
    expect(decode(sendSanyoAc(cases[0]!.state))?.protocol).toBe("sanyo_ac");
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildSanyoAcRaw(cases[0]!.state);
    raw[8] = (raw[8]! ^ 0xff) & 0xff;
    expect(decodeSanyoAc(encodeSanyoAcRaw(raw))).toBeNull();
  });
});
