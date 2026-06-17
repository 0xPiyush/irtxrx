import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildNeoclimaRaw, encodeNeoclimaRaw, sendNeoclima, decodeNeoclima, neoclimaValidChecksum,
  NeoclimaMode, NeoclimaFan, NeoclimaButton,
} from "../src/protocols/neoclima";
import type { NeoclimaState } from "../src/protocols/neoclima";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(args: string): string { return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim(); }
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function toHex(a: Uint8Array): string {
  return Array.from(a).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}
beforeAll(() => { ensureRunner(); });

interface NCase { label: string; state: NeoclimaState; cppArgs: string; }
// cppArgs: power temp celsius mode fan swingV swingH sleep turbo econo fresh hold ion light cheat eye button(hex)
const cases: NCase[] = [
  { label: "cool 24 high", state: { power: true, temp: 24, mode: NeoclimaMode.Cool, fan: NeoclimaFan.High, button: NeoclimaButton.Mode }, cppArgs: "1 24 1 1 1 0 1 0 0 0 0 0 0 0 0 0 01" },
  { label: "auto 26 (reset-ish)", state: { power: true, temp: 26, mode: NeoclimaMode.Cool, fan: NeoclimaFan.Low, button: NeoclimaButton.Power }, cppArgs: "1 26 1 1 3 0 1 0 0 0 0 0 0 0 0 0 00" },
  { label: "heat 32 med", state: { power: true, temp: 32, mode: NeoclimaMode.Heat, fan: NeoclimaFan.Med, button: NeoclimaButton.Mode }, cppArgs: "1 32 1 4 2 0 1 0 0 0 0 0 0 0 0 0 01" },
  { label: "dry forces low fan", state: { power: true, temp: 20, mode: NeoclimaMode.Dry, fan: NeoclimaFan.High, button: NeoclimaButton.Mode }, cppArgs: "1 20 1 2 1 0 1 0 0 0 0 0 0 0 0 0 01" },
  { label: "fan mode", state: { power: true, temp: 22, mode: NeoclimaMode.Fan, fan: NeoclimaFan.Auto, button: NeoclimaButton.FanSpeed }, cppArgs: "1 22 1 3 0 0 1 0 0 0 0 0 0 0 0 0 05" },
  { label: "swingV on", state: { power: true, temp: 24, mode: NeoclimaMode.Cool, fan: NeoclimaFan.Med, swingV: true, button: NeoclimaButton.Swing }, cppArgs: "1 24 1 1 2 1 1 0 0 0 0 0 0 0 0 0 04" },
  { label: "swingH off", state: { power: true, temp: 24, mode: NeoclimaMode.Cool, fan: NeoclimaFan.Med, swingH: false, button: NeoclimaButton.AirFlow }, cppArgs: "1 24 1 1 2 0 0 0 0 0 0 0 0 0 0 0 07" },
  { label: "turbo", state: { power: true, temp: 18, mode: NeoclimaMode.Cool, fan: NeoclimaFan.High, turbo: true, button: NeoclimaButton.Turbo }, cppArgs: "1 18 1 1 1 0 1 0 1 0 0 0 0 0 0 0 0A" },
  { label: "econo+light+ion+fresh+hold+eye+sleep", state: { power: true, temp: 25, mode: NeoclimaMode.Cool, fan: NeoclimaFan.Med, econo: true, light: true, ion: true, fresh: true, hold: true, eye: true, sleep: true, button: NeoclimaButton.Econo }, cppArgs: "1 25 1 1 2 0 1 1 0 1 1 1 1 1 0 1 0D" },
  { label: "8C heat", state: { power: true, temp: 16, mode: NeoclimaMode.Heat, fan: NeoclimaFan.Auto, eightCHeat: true, button: NeoclimaButton.Heat8C }, cppArgs: "1 16 1 4 0 0 1 0 0 0 0 0 0 0 1 0 1D" },
  { label: "fahrenheit 75F", state: { power: true, temp: 75, celsius: false, mode: NeoclimaMode.Cool, fan: NeoclimaFan.Med, button: NeoclimaButton.TempUnit }, cppArgs: "1 75 0 1 2 0 1 0 0 0 0 0 0 0 0 0 1E" },
  { label: "off", state: { power: false, temp: 26, mode: NeoclimaMode.Cool, fan: NeoclimaFan.Low, button: NeoclimaButton.Power }, cppArgs: "0 26 1 1 3 0 1 0 0 0 0 0 0 0 0 0 00" },
];

describe("buildNeoclimaRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw for ${tc.label}`, () => {
      expect(toHex(buildNeoclimaRaw(tc.state))).toBe(cpp(`neoclima ${tc.cppArgs}`).split("\n")[0]!);
    });
  }
});

describe("encodeNeoclimaRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ timings for ${tc.label}`, () => {
      const lines = cpp(`neoclima ${tc.cppArgs}`).split("\n");
      expect(encodeNeoclimaRaw(buildNeoclimaRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }
  it("matches C++ timings with repeat", () => {
    const raw = buildNeoclimaRaw(cases[0]!.state);
    expect(encodeNeoclimaRaw(raw, 1)).toEqual(parseCppTimings(cpp(`sendNeoclima ${toHex(raw)} 1`)));
  });
});

describe("decodeNeoclima roundtrip + C++ cross-validation", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildNeoclimaRaw(tc.state);
      const d = decodeNeoclima(sendNeoclima(tc.state));
      expect(d).not.toBeNull();
      expect(toHex(buildNeoclimaRaw(d!))).toBe(toHex(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const out = cpp(`decode ${encodeNeoclimaRaw(buildNeoclimaRaw(tc.state)).join(",")}`).split("\n");
      expect(out[0]).toBe("NEOCLIMA");
      expect(out[1]).toBe(toHex(buildNeoclimaRaw(tc.state)));
    });
  }
  it("decodes without a header", () => {
    const d = decodeNeoclima(sendNeoclima(cases[0]!.state).slice(2), 0, true);
    expect(toHex(buildNeoclimaRaw(d!))).toBe(toHex(buildNeoclimaRaw(cases[0]!.state)));
  });
  it("reads °F + toggles", () => {
    const s = decodeNeoclima(sendNeoclima(cases[10]!.state))!;
    expect(s).toMatchObject({ celsius: false, temp: 75, mode: NeoclimaMode.Cool });
    const t = decodeNeoclima(sendNeoclima(cases[8]!.state))!;
    expect(t).toMatchObject({ econo: true, light: true, ion: true, fresh: true, hold: true, eye: true, sleep: true });
  });
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Neoclima frame", () => {
    const r = decode(sendNeoclima(cases[0]!.state));
    expect(r?.protocol).toBe("neoclima");
    expect(r?.brand).toBe("neoclima");
    expect(r?.confidence).toBe("checksum_valid");
  });
  it("rejects empty/garbage", () => {
    expect(decodeNeoclima([])).toBeNull();
    expect(decodeNeoclima([1, 2, 3, 4])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildNeoclimaRaw(cases[0]!.state); raw[9] ^= 0x07;
    expect(decodeNeoclima(encodeNeoclimaRaw(raw))).toBeNull();
  });
  it("validChecksum agrees with a freshly built state", () => {
    expect(neoclimaValidChecksum(buildNeoclimaRaw(cases[2]!.state))).toBe(true);
  });
});
