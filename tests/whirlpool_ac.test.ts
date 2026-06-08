import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildWhirlpoolAcRaw, encodeWhirlpoolAcRaw, sendWhirlpoolAc, decodeWhirlpoolAc,
  WhirlpoolAcMode, WhirlpoolAcFan, WhirlpoolAcModel, WhirlpoolAcCommand,
} from "../src/protocols/whirlpool_ac";
import type { WhirlpoolAcState } from "../src/protocols/whirlpool_ac";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

const C = WhirlpoolAcCommand;
interface TC { label: string; state: WhirlpoolAcState; args: string; }
// model powerToggle temp mode fan swing light sleep clock onTimer onEn offTimer offEn command
const cases: TC[] = [
  { label: "3A cool 24 auto", state: { model: WhirlpoolAcModel.DG11J13A, temp: 24, mode: WhirlpoolAcMode.Cool, fan: WhirlpoolAcFan.Auto, light: true, command: C.Mode }, args: "1 0 24 2 0 0 1 0 0 0 0 0 0 6" },
  { label: "3A heat 30 high swing power", state: { model: WhirlpoolAcModel.DG11J13A, powerToggle: true, temp: 30, mode: WhirlpoolAcMode.Heat, fan: WhirlpoolAcFan.High, swing: true, light: true, command: C.Power }, args: "1 1 30 0 1 1 1 0 0 0 0 0 0 1" },
  { label: "91 cool 20 med clock", state: { model: WhirlpoolAcModel.DG11J191, temp: 20, mode: WhirlpoolAcMode.Cool, fan: WhirlpoolAcFan.Medium, light: true, clock: 750, command: C.Mode }, args: "2 0 20 2 2 0 1 0 750 0 0 0 0 6" },
  { label: "3A dry sleep", state: { model: WhirlpoolAcModel.DG11J13A, temp: 25, mode: WhirlpoolAcMode.Dry, fan: WhirlpoolAcFan.Low, light: true, sleep: true, command: C.Sleep }, args: "1 0 25 3 3 0 1 1 0 0 0 0 0 3" },
  { label: "3A on-timer", state: { model: WhirlpoolAcModel.DG11J13A, temp: 24, mode: WhirlpoolAcMode.Cool, fan: WhirlpoolAcFan.Auto, light: true, onTimer: 480, onTimerEnabled: true, command: C.OnTimer }, args: "1 0 24 2 0 0 1 0 0 480 1 0 0 5" },
  { label: "3A off-timer + light off", state: { model: WhirlpoolAcModel.DG11J13A, temp: 24, mode: WhirlpoolAcMode.Cool, fan: WhirlpoolAcFan.Auto, light: false, offTimer: 360, offTimerEnabled: true, command: C.OffTimer }, args: "1 0 24 2 0 0 0 0 0 0 0 360 1 29" },
];

describe("buildWhirlpoolAcRaw + encode cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw + timings for ${tc.label}`, () => {
      const raw = buildWhirlpoolAcRaw(tc.state);
      expect(hex(raw)).toBe(cpp(`whirlpoolAc ${tc.args}`).toLowerCase());
      for (const rep of [0, 1]) expect(encodeWhirlpoolAcRaw(raw, rep)).toEqual(timings(cpp(`sendWhirlpoolAc ${hex(raw)} ${rep}`)));
    });
  }
});

describe("decodeWhirlpoolAc roundtrip + C++", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      expect(hex(buildWhirlpoolAcRaw(decodeWhirlpoolAc(sendWhirlpoolAc(tc.state))!))).toBe(hex(buildWhirlpoolAcRaw(tc.state)));
    });
    it(`C++ decodes ${tc.label}`, () => {
      const out = cpp(`decode ${sendWhirlpoolAc(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe("WHIRLPOOL_AC");
      expect(out[1]!.toLowerCase()).toBe(hex(buildWhirlpoolAcRaw(tc.state)));
    });
  }

  it("round-trips Super (Jet) via the codec", () => {
    const s: WhirlpoolAcState = { model: WhirlpoolAcModel.DG11J13A, temp: 30, mode: WhirlpoolAcMode.Cool, fan: WhirlpoolAcFan.High, super: true, light: true, command: C.Super };
    const d = decodeWhirlpoolAc(sendWhirlpoolAc(s))!;
    expect(d.super).toBe(true);
    expect(hex(buildWhirlpoolAcRaw(d))).toBe(hex(buildWhirlpoolAcRaw(s)));
  });
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Whirlpool AC frame", () => {
    const r = decode(sendWhirlpoolAc(cases[0]!.state));
    expect(r?.protocol).toBe("whirlpool_ac");
    expect(r?.brand).toBe("whirlpool");
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildWhirlpoolAcRaw(cases[0]!.state);
    raw[13] = (raw[13]! ^ 0xff) & 0xff;
    expect(decodeWhirlpoolAc(encodeWhirlpoolAcRaw(raw))).toBeNull();
  });
});
