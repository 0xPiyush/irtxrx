import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildHaierAcRaw, encodeHaierAcRaw, sendHaierAc, decodeHaierAc,
  HaierAcCommand, HaierAcMode, HaierAcFan, HaierAcSwingV,
} from "../src/protocols/haier_ac";
import type { HaierAcState } from "../src/protocols/haier_ac";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

const cases: HaierAcState[] = [
  { command: HaierAcCommand.On, temp: 25, mode: HaierAcMode.Auto, fan: HaierAcFan.Auto, swingV: HaierAcSwingV.Off },
  { command: HaierAcCommand.Mode, temp: 20, mode: HaierAcMode.Cool, fan: HaierAcFan.High, swingV: HaierAcSwingV.Up, health: true },
  { command: HaierAcCommand.Sleep, temp: 30, mode: HaierAcMode.Heat, fan: HaierAcFan.Low, swingV: HaierAcSwingV.Down, sleep: true },
  { command: HaierAcCommand.TimerSet, temp: 16, mode: HaierAcMode.Dry, fan: HaierAcFan.Med, swingV: HaierAcSwingV.Chg, onTimer: 90, offTimer: 480 },
  { command: HaierAcCommand.Fan, temp: 24, mode: HaierAcMode.Fan, fan: HaierAcFan.High, currTime: 13 * 60 + 30 },
];

describe("HAIER_AC encode + decode", () => {
  for (const s of cases) {
    const raw = buildHaierAcRaw(s);
    it(`encode matches C++ send for ${hex(raw)}`, () => {
      for (const rep of [0, 1]) {
        expect(encodeHaierAcRaw(raw, rep)).toEqual(timings(cpp(`sendHaier ${hex(raw)} ${rep}`)));
      }
    });
    it(`roundtrips ${hex(raw)}`, () => {
      const d = decodeHaierAc(sendHaierAc(s));
      expect(d).not.toBeNull();
      expect(hex(buildHaierAcRaw(d!))).toBe(hex(raw));
    });
    it(`C++ decodes ${hex(raw)} as HAIER_AC`, () => {
      const out = cpp(`decode ${sendHaierAc(s).join(",")}`).split("\n");
      expect(out[0]).toBe("HAIER_AC");
      expect(out[1]!.toLowerCase()).toBe(hex(raw));
    });
  }

  it("reads fields", () => {
    const s = decodeHaierAc(sendHaierAc(cases[1]!))!;
    expect(s.temp).toBe(20);
    expect(s.mode).toBe(HaierAcMode.Cool);
    expect(s.fan).toBe(HaierAcFan.High);
    expect(s.swingV).toBe(HaierAcSwingV.Up);
    expect(s.health).toBe(true);
  });
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Haier AC frame", () => {
    const r = decode(sendHaierAc(cases[0]!));
    expect(r?.protocol).toBe("haier_ac");
    expect(r?.brand).toBe("haier");
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildHaierAcRaw(cases[0]!);
    raw[8] = (raw[8]! ^ 0xff) & 0xff;
    expect(decodeHaierAc(encodeHaierAcRaw(raw))).toBeNull();
  });
});
