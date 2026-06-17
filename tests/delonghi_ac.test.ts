import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildDelonghiAcRaw, encodeDelonghiAcRaw, sendDelonghiAc, decodeDelonghiAc, delonghiAcValidChecksum,
  DelonghiAcMode, DelonghiAcFan, DELONGHI_AC_BITS,
} from "../src/protocols/delonghi_ac";
import type { DelonghiAcState } from "../src/protocols/delonghi_ac";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(args: string): string { return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim(); }
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function hex16(v: bigint): string { return v.toString(16).toUpperCase().padStart(16, "0"); }
beforeAll(() => { ensureRunner(); });

interface DCase { label: string; state: DelonghiAcState; cppArgs: string; }
// power temp celsius mode fan boost sleep onTimer offTimer
const cases: DCase[] = [
  { label: "cool 24 high", state: { power: true, temp: 24, mode: DelonghiAcMode.Cool, fan: DelonghiAcFan.High }, cppArgs: "1 24 1 0 1 0 0 0 0" },
  { label: "cool 18 low", state: { power: true, temp: 18, mode: DelonghiAcMode.Cool, fan: DelonghiAcFan.Low }, cppArgs: "1 18 1 0 3 0 0 0 0" },
  { label: "cool 32 med", state: { power: true, temp: 32, mode: DelonghiAcMode.Cool, fan: DelonghiAcFan.Medium }, cppArgs: "1 32 1 0 2 0 0 0 0" },
  { label: "auto (forced temp)", state: { power: true, temp: 24, mode: DelonghiAcMode.Auto, fan: DelonghiAcFan.Auto }, cppArgs: "1 24 1 4 0 0 0 0 0" },
  { label: "dry", state: { power: true, temp: 24, mode: DelonghiAcMode.Dry, fan: DelonghiAcFan.Auto }, cppArgs: "1 24 1 1 0 0 0 0 0" },
  { label: "fan (forced temp, no auto fan)", state: { power: true, temp: 24, mode: DelonghiAcMode.Fan, fan: DelonghiAcFan.High }, cppArgs: "1 24 1 2 1 0 0 0 0" },
  { label: "cool 75F", state: { power: true, temp: 75, celsius: false, mode: DelonghiAcMode.Cool, fan: DelonghiAcFan.High }, cppArgs: "1 75 0 0 1 0 0 0 0" },
  { label: "cool boost", state: { power: true, temp: 22, mode: DelonghiAcMode.Cool, fan: DelonghiAcFan.High, boost: true }, cppArgs: "1 22 1 0 1 1 0 0 0" },
  { label: "cool sleep", state: { power: true, temp: 22, mode: DelonghiAcMode.Cool, fan: DelonghiAcFan.Low, sleep: true }, cppArgs: "1 22 1 0 3 0 1 0 0" },
  { label: "onTimer 90m", state: { power: true, temp: 24, mode: DelonghiAcMode.Cool, fan: DelonghiAcFan.High, onTimer: 90 }, cppArgs: "1 24 1 0 1 0 0 90 0" },
  { label: "offTimer 8h", state: { power: true, temp: 24, mode: DelonghiAcMode.Cool, fan: DelonghiAcFan.High, offTimer: 480 }, cppArgs: "1 24 1 0 1 0 0 0 480" },
  { label: "off", state: { power: false, temp: 26, mode: DelonghiAcMode.Cool, fan: DelonghiAcFan.High }, cppArgs: "0 26 1 0 1 0 0 0 0" },
];

describe("buildDelonghiAcRaw + encode cross-validation", () => {
  for (const tc of cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`delonghiAc ${tc.cppArgs}`).split("\n");
      expect(hex16(buildDelonghiAcRaw(tc.state))).toBe(lines[0]!);
      expect(encodeDelonghiAcRaw(buildDelonghiAcRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
  it("matches C++ timings with repeat", () => {
    const raw = buildDelonghiAcRaw(cases[0]!.state);
    expect(encodeDelonghiAcRaw(raw, 1)).toEqual(parseCppTimings(cpp(`sendDelonghiAc ${hex16(raw)} 1`)));
  });
});

describe("decodeDelonghiAc", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildDelonghiAcRaw(tc.state);
      const d = decodeDelonghiAc(sendDelonghiAc(tc.state));
      expect(d).not.toBeNull();
      expect(hex16(buildDelonghiAcRaw(d!))).toBe(hex16(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildDelonghiAcRaw(tc.state);
      const out = cpp(`decodeValue ${encodeDelonghiAcRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("DELONGHI_AC");
      expect(BigInt(`0x${out[1]}`)).toBe(raw);
    });
  }
  it("decodes without a header + reads timers", () => {
    const d = decodeDelonghiAc(sendDelonghiAc(cases[9]!.state).slice(2), 0, true)!;
    expect(d.onTimer).toBe(90);
    expect(decode(sendDelonghiAc(cases[0]!.state))?.protocol).toBe("delonghi_ac");
    expect(decodeDelonghiAc([])).toBeNull();
    expect(delonghiAcValidChecksum(buildDelonghiAcRaw(cases[0]!.state))).toBe(true);
    expect(DELONGHI_AC_BITS).toBe(64);
  });
});
