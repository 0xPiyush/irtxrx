import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildAirwellRaw, encodeAirwellRaw, sendAirwell, decodeAirwell,
  AirwellMode, AirwellFan, AIRWELL_BITS,
} from "../src/protocols/airwell";
import type { AirwellState } from "../src/protocols/airwell";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function t(o: string): number[] { return o.split(",").map(Number); }
function hex9(v: bigint): string { return v.toString(16).toUpperCase().padStart(9, "0"); }
beforeAll(() => { ensureRunner(); });

interface AW { label: string; state: AirwellState; cppArgs: string; } // powerToggle temp mode fan
const cases: AW[] = [
  { label: "cool 24 auto", state: { temp: 24, mode: AirwellMode.Cool, fan: AirwellFan.Auto }, cppArgs: "0 24 1 3" },
  { label: "heat 30 high", state: { temp: 30, mode: AirwellMode.Heat, fan: AirwellFan.High }, cppArgs: "0 30 2 2" },
  { label: "auto 16 low", state: { temp: 16, mode: AirwellMode.Auto, fan: AirwellFan.Low }, cppArgs: "0 16 3 0" },
  { label: "dry forces low", state: { temp: 22, mode: AirwellMode.Dry, fan: AirwellFan.High }, cppArgs: "0 22 4 2" },
  { label: "fan med", state: { temp: 25, mode: AirwellMode.Fan, fan: AirwellFan.Medium }, cppArgs: "0 25 5 1" },
  { label: "power toggle", state: { temp: 24, mode: AirwellMode.Cool, fan: AirwellFan.Auto, powerToggle: true }, cppArgs: "1 24 1 3" },
];

describe("Airwell build + encode cross-validation", () => {
  for (const tc of cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`airwell ${tc.cppArgs}`).split("\n");
      expect(hex9(buildAirwellRaw(tc.state))).toBe(lines[0]!);
      expect(encodeAirwellRaw(buildAirwellRaw(tc.state), 0)).toEqual(t(lines[1]!));
    });
  }
  it("matches C++ timings with repeat", () => {
    const raw = buildAirwellRaw(cases[0]!.state);
    expect(encodeAirwellRaw(raw, 2)).toEqual(t(cpp(`sendAirwell ${hex9(raw)} 2`)));
  });
});

describe("Airwell decode", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildAirwellRaw(tc.state);
      const d = decodeAirwell(encodeAirwellRaw(raw, 0));
      expect(d).not.toBeNull();
      expect(hex9(buildAirwellRaw(d!))).toBe(hex9(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildAirwellRaw(tc.state);
      const out = cpp(`decodeValue ${encodeAirwellRaw(raw, 0).join(",")}`).split("\n");
      expect(out[0]).toBe("AIRWELL");
      expect(BigInt(`0x${out[1]}`)).toBe(raw);
    });
  }
  it("dispatch + rejection", () => {
    expect(decode(encodeAirwellRaw(buildAirwellRaw(cases[0]!.state), 0))?.protocol).toBe("airwell");
    expect(decodeAirwell([])).toBeNull();
    expect(AIRWELL_BITS).toBe(34);
  });
});
