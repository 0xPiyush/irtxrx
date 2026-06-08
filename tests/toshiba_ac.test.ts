import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildToshibaAcRaw, encodeToshibaAcRaw, sendToshibaAc, decodeToshibaAc,
  ToshibaAcMode, ToshibaAcFan, ToshibaAcModel,
} from "../src/protocols/toshiba_ac";
import type { ToshibaAcState } from "../src/protocols/toshiba_ac";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

interface TC { label: string; state: ToshibaAcState; args: string; }
// model power temp mode fan filter turbo econo
const cases: TC[] = [
  { label: "cool 22 auto", state: { power: true, temp: 22, mode: ToshibaAcMode.Cool, fan: ToshibaAcFan.Auto }, args: "0 1 22 1 0 0 0 0" },
  { label: "heat 30 max filter", state: { power: true, temp: 30, mode: ToshibaAcMode.Heat, fan: ToshibaAcFan.Max, filter: true }, args: "0 1 30 3 5 1 0 0" },
  { label: "off", state: { power: false, temp: 25, mode: ToshibaAcMode.Cool }, args: "0 0 25 1 0 0 0 0" },
  { label: "turbo (long msg)", state: { power: true, temp: 24, mode: ToshibaAcMode.Cool, fan: ToshibaAcFan.Med, turbo: true }, args: "0 1 24 1 3 0 1 0" },
  { label: "econo (long msg)", state: { power: true, temp: 18, mode: ToshibaAcMode.Dry, fan: ToshibaAcFan.Min, econo: true }, args: "0 1 18 2 1 0 0 1" },
  { label: "model B fan", state: { model: ToshibaAcModel.B, power: true, temp: 26, mode: ToshibaAcMode.Fan, fan: ToshibaAcFan.Auto }, args: "1 1 26 4 0 0 0 0" },
];

describe("buildToshibaAcRaw + encode cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw + timings for ${tc.label}`, () => {
      const raw = buildToshibaAcRaw(tc.state);
      expect(hex(raw)).toBe(cpp(`toshibaAc ${tc.args}`).toLowerCase());
      for (const rep of [0, 1]) expect(encodeToshibaAcRaw(raw, rep)).toEqual(timings(cpp(`sendToshibaAC ${hex(raw)} ${rep}`)));
    });
  }
});

describe("decodeToshibaAc roundtrip + C++", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildToshibaAcRaw(tc.state);
      expect(hex(buildToshibaAcRaw(decodeToshibaAc(sendToshibaAc(tc.state))!))).toBe(hex(raw));
    });
    it(`C++ decodes ${tc.label}`, () => {
      const raw = buildToshibaAcRaw(tc.state);
      const out = cpp(`decode ${sendToshibaAc(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe("TOSHIBA_AC");
      expect(out[1]!.toLowerCase()).toBe(hex(raw));
    });
  }

  it("reads fields", () => {
    const s = decodeToshibaAc(sendToshibaAc(cases[3]!.state))!;
    expect(s.power).toBe(true);
    expect(s.temp).toBe(24);
    expect(s.turbo).toBe(true);
  });
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Toshiba AC frame", () => {
    expect(decode(sendToshibaAc(cases[0]!.state))?.protocol).toBe("toshiba_ac");
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildToshibaAcRaw(cases[0]!.state);
    raw[raw.length - 1] = (raw[raw.length - 1]! ^ 0xff) & 0xff;
    expect(decodeToshibaAc(encodeToshibaAcRaw(raw))).toBeNull();
  });
});
