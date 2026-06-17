import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildArgoRaw, encodeArgoRaw, sendArgo, sendArgoSensorTemp, decodeArgo, argoValidChecksum,
  ArgoMode, ArgoFan, ArgoFlap,
} from "../src/protocols/argo";
import type { ArgoState } from "../src/protocols/argo";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function t(o: string): number[] { return o.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

interface AC { label: string; state: ArgoState; cppArgs: string; }
// power temp mode fan flap roomTemp max night ifeel
const cases: AC[] = [
  { label: "cool 24 max-fan", state: { power: true, temp: 24, mode: ArgoMode.Cool, fan: ArgoFan.Max, roomTemp: 24 }, cppArgs: "1 24 0 3 0 24 0 0 0" },
  { label: "auto 25", state: { power: true, temp: 25, mode: ArgoMode.Auto, fan: ArgoFan.Auto, roomTemp: 25 }, cppArgs: "1 25 2 0 0 25 0 0 0" },
  { label: "heat 30 min", state: { power: true, temp: 30, mode: ArgoMode.Heat, fan: ArgoFan.Min, roomTemp: 20 }, cppArgs: "1 30 4 1 0 20 0 0 0" },
  { label: "dry 18 med", state: { power: true, temp: 18, mode: ArgoMode.Dry, fan: ArgoFan.Med, roomTemp: 22 }, cppArgs: "1 18 1 2 0 22 0 0 0" },
  { label: "off mode 10", state: { power: true, temp: 10, mode: ArgoMode.Off, fan: ArgoFan.Auto, roomTemp: 24 }, cppArgs: "1 10 3 0 0 24 0 0 0" },
  { label: "flap pos3", state: { power: true, temp: 24, mode: ArgoMode.Cool, fan: ArgoFan.Auto, flap: ArgoFlap.Pos3, roomTemp: 24 }, cppArgs: "1 24 0 0 3 24 0 0 0" },
  { label: "max", state: { power: true, temp: 24, mode: ArgoMode.Cool, fan: ArgoFan.Max, roomTemp: 24, max: true }, cppArgs: "1 24 0 3 0 24 1 0 0" },
  { label: "night", state: { power: true, temp: 24, mode: ArgoMode.Cool, fan: ArgoFan.Auto, roomTemp: 24, night: true }, cppArgs: "1 24 0 0 0 24 0 1 0" },
  { label: "ifeel", state: { power: true, temp: 24, mode: ArgoMode.Cool, fan: ArgoFan.Auto, roomTemp: 24, iFeel: true }, cppArgs: "1 24 0 0 0 24 0 0 1" },
  { label: "off (power)", state: { power: false, temp: 26, mode: ArgoMode.Cool, fan: ArgoFan.Auto, roomTemp: 24 }, cppArgs: "0 26 0 0 0 24 0 0 0" },
];

describe("Argo WREM2 build + encode cross-validation", () => {
  for (const tc of cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(`argo ${tc.cppArgs}`).split("\n");
      expect(toHex(buildArgoRaw(tc.state))).toBe(lines[0]!);
      expect(encodeArgoRaw(buildArgoRaw(tc.state), 0)).toEqual(t(lines[1]!));
    });
  }
  it("matches C++ timings with repeat", () => {
    const raw = buildArgoRaw(cases[0]!.state);
    expect(encodeArgoRaw(raw, 1)).toEqual(t(cpp(`sendArgo ${toHex(raw)} 12 1`)));
  });
});

describe("Argo WREM2 iFeel sensor report", () => {
  for (const deg of [16, 20, 22, 25, 30, 35]) {
    it(`sensor ${deg}C matches C++`, () => {
      expect(sendArgoSensorTemp(deg, 0)).toEqual(t(cpp(`argoSensor ${deg}`)));
    });
  }
});

describe("Argo WREM2 decode", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildArgoRaw(tc.state);
      const d = decodeArgo(sendArgo(tc.state));
      expect(d).not.toBeNull();
      expect(toHex(buildArgoRaw(d!))).toBe(toHex(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const out = cpp(`decode ${encodeArgoRaw(buildArgoRaw(tc.state)).join(",")}`).split("\n");
      expect(out[0]).toBe("ARGO");
      expect(out[1]).toBe(toHex(buildArgoRaw(tc.state)));
    });
  }
  it("dispatch + rejection", () => {
    expect(decode(sendArgo(cases[0]!.state))?.protocol).toBe("argo");
    expect(decodeArgo([])).toBeNull();
    const bad = buildArgoRaw(cases[0]!.state); bad[5] ^= 0x04;
    expect(decodeArgo(encodeArgoRaw(bad))).toBeNull();
    expect(argoValidChecksum(buildArgoRaw(cases[2]!.state))).toBe(true);
  });
});
