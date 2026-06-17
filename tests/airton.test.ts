import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildAirtonRaw, encodeAirtonRaw, sendAirton, decodeAirton, airtonValidChecksum,
  AirtonMode, AirtonFan, AIRTON_BITS,
} from "../src/protocols/airton";
import type { AirtonState } from "../src/protocols/airton";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(args: string): string { return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim(); }
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function hex14(v: bigint): string { return v.toString(16).toUpperCase().padStart(14, "0"); }
beforeAll(() => { ensureRunner(); });

interface ACase { label: string; state: AirtonState; cppArgs: string; }
// power temp mode fan turbo swingV econo sleep health light
const cases: ACase[] = [
  { label: "cool 24 med", state: { power: true, temp: 24, mode: AirtonMode.Cool, fan: AirtonFan.Med }, cppArgs: "1 24 1 3 0 0 0 0 0 0" },
  { label: "auto (fixed temp)", state: { power: true, temp: 24, mode: AirtonMode.Auto, fan: AirtonFan.Auto }, cppArgs: "1 24 0 0 0 0 0 0 0 0" },
  { label: "heat 30 high on", state: { power: true, temp: 30, mode: AirtonMode.Heat, fan: AirtonFan.High }, cppArgs: "1 30 4 4 0 0 0 0 0 0" },
  { label: "heat off (HeatOn cleared)", state: { power: false, temp: 30, mode: AirtonMode.Heat, fan: AirtonFan.High }, cppArgs: "0 30 4 4 0 0 0 0 0 0" },
  { label: "dry 16 min", state: { power: true, temp: 16, mode: AirtonMode.Dry, fan: AirtonFan.Min }, cppArgs: "1 16 2 1 0 0 0 0 0 0" },
  { label: "fan max", state: { power: true, temp: 22, mode: AirtonMode.Fan, fan: AirtonFan.Max }, cppArgs: "1 22 3 5 0 0 0 0 0 0" },
  { label: "cool swingV", state: { power: true, temp: 23, mode: AirtonMode.Cool, fan: AirtonFan.Low, swingV: true }, cppArgs: "1 23 1 2 0 1 0 0 0 0" },
  { label: "cool econo", state: { power: true, temp: 23, mode: AirtonMode.Cool, fan: AirtonFan.Low, econo: true }, cppArgs: "1 23 1 2 0 0 1 0 0 0" },
  { label: "econo ignored in heat", state: { power: true, temp: 23, mode: AirtonMode.Heat, fan: AirtonFan.Low, econo: true }, cppArgs: "1 23 4 2 0 0 1 0 0 0" },
  { label: "cool turbo (forces max fan)", state: { power: true, temp: 20, mode: AirtonMode.Cool, fan: AirtonFan.Low, turbo: true }, cppArgs: "1 20 1 2 1 0 0 0 0 0" },
  { label: "cool sleep", state: { power: true, temp: 25, mode: AirtonMode.Cool, fan: AirtonFan.Low, sleep: true }, cppArgs: "1 25 1 2 0 0 0 1 0 0" },
  { label: "sleep ignored in fan", state: { power: true, temp: 25, mode: AirtonMode.Fan, fan: AirtonFan.Low, sleep: true }, cppArgs: "1 25 3 2 0 0 0 1 0 0" },
  { label: "health+light", state: { power: true, temp: 26, mode: AirtonMode.Cool, fan: AirtonFan.Med, health: true, light: true }, cppArgs: "1 26 1 3 0 0 0 0 1 1" },
];

describe("buildAirtonRaw + encode cross-validation", () => {
  for (const tc of cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`airton ${tc.cppArgs}`).split("\n");
      expect(hex14(buildAirtonRaw(tc.state))).toBe(lines[0]!);
      expect(encodeAirtonRaw(buildAirtonRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
  it("matches C++ timings with repeat", () => {
    const raw = buildAirtonRaw(cases[0]!.state);
    expect(encodeAirtonRaw(raw, 1)).toEqual(parseCppTimings(cpp(`sendAirton ${hex14(raw)} 1`)));
  });
});

describe("decodeAirton", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildAirtonRaw(tc.state);
      const d = decodeAirton(sendAirton(tc.state));
      expect(d).not.toBeNull();
      expect(hex14(buildAirtonRaw(d!))).toBe(hex14(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildAirtonRaw(tc.state);
      const out = cpp(`decodeValue ${encodeAirtonRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("AIRTON");
      expect(BigInt(`0x${out[1]}`)).toBe(raw);
    });
  }
  it("decodes without a header", () => {
    const d = decodeAirton(sendAirton(cases[0]!.state).slice(2), 0, true);
    expect(hex14(buildAirtonRaw(d!))).toBe(hex14(buildAirtonRaw(cases[0]!.state)));
  });
  it("dispatch + rejection", () => {
    expect(decode(sendAirton(cases[0]!.state))?.protocol).toBe("airton");
    expect(decodeAirton([])).toBeNull();
    expect(decodeAirton(encodeAirtonRaw(buildAirtonRaw(cases[0]!.state) ^ (1n << 24n)))).toBeNull();
    expect(airtonValidChecksum(buildAirtonRaw(cases[2]!.state))).toBe(true);
    expect(AIRTON_BITS).toBe(56);
  });
});
