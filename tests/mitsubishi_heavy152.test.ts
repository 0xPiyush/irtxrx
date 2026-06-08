import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildMitsubishiHeavy152Raw, encodeMitsubishiHeavy152Raw, sendMitsubishiHeavy152, decodeMitsubishiHeavy152,
  MitsubishiHeavy152Mode, MitsubishiHeavy152Fan, MitsubishiHeavy152SwingV, MitsubishiHeavy152SwingH,
} from "../src/protocols/mitsubishi_heavy152";
import type { MitsubishiHeavy152State } from "../src/protocols/mitsubishi_heavy152";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

const M = MitsubishiHeavy152Mode, F = MitsubishiHeavy152Fan, SV = MitsubishiHeavy152SwingV, SH = MitsubishiHeavy152SwingH;
interface TC { label: string; state: MitsubishiHeavy152State; args: string; }
// power temp mode fan swingV swingH night silent filter clean 3d
const cases: TC[] = [
  { label: "cool 24 auto", state: { power: true, temp: 24, mode: M.Cool, fan: F.Auto, swingV: SV.Auto, swingH: SH.Auto }, args: "1 24 1 0 0 0 0 0 0 0 0" },
  { label: "heat 30 turbo swing night", state: { power: true, temp: 30, mode: M.Heat, fan: F.Turbo, swingV: SV.Highest, swingH: SH.Right, night: true }, args: "1 30 4 8 1 4 1 0 0 0 0" },
  { label: "dry econo filter clean 3d silent", state: { power: true, temp: 20, mode: M.Dry, fan: F.Econo, swingV: SV.Lowest, swingH: SH.Off, silent: true, filter: true, clean: true, threeD: true }, args: "1 20 2 6 5 8 0 1 1 1 1" },
  { label: "off auto-mode", state: { power: false, temp: 25, mode: M.Auto, fan: F.Auto, swingV: SV.Off, swingH: SH.Middle }, args: "0 25 0 0 6 3 0 0 0 0 0" },
];

describe("buildMitsubishiHeavy152Raw + encode cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw + timings for ${tc.label}`, () => {
      const raw = buildMitsubishiHeavy152Raw(tc.state);
      expect(hex(raw)).toBe(cpp(`mheavy152 ${tc.args}`).toLowerCase());
      for (const rep of [0, 1]) expect(encodeMitsubishiHeavy152Raw(raw, rep)).toEqual(timings(cpp(`sendMitsubishiHeavy152 ${hex(raw)} ${rep}`)));
    });
  }
});

describe("decodeMitsubishiHeavy152 roundtrip + C++", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      expect(hex(buildMitsubishiHeavy152Raw(decodeMitsubishiHeavy152(sendMitsubishiHeavy152(tc.state))!))).toBe(hex(buildMitsubishiHeavy152Raw(tc.state)));
    });
    it(`C++ decodes ${tc.label}`, () => {
      const out = cpp(`decode ${sendMitsubishiHeavy152(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe("MITSUBISHI_HEAVY_152");
      expect(out[1]!.toLowerCase()).toBe(hex(buildMitsubishiHeavy152Raw(tc.state)));
    });
  }

  it("reads fields", () => {
    const s = decodeMitsubishiHeavy152(sendMitsubishiHeavy152(cases[2]!.state))!;
    expect(s.mode).toBe(M.Dry);
    expect(s.fan).toBe(F.Econo);
    expect(s.threeD).toBe(true);
    expect(s.clean).toBe(true);
  });
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Mitsubishi Heavy 152 frame", () => {
    const r = decode(sendMitsubishiHeavy152(cases[0]!.state));
    expect(r?.protocol).toBe("mitsubishi_heavy152");
    expect(r?.brand).toBe("mitsubishi_heavy");
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildMitsubishiHeavy152Raw(cases[0]!.state);
    raw[6] = (raw[6]! ^ 0xff) & 0xff; // break an inverted-pair byte
    expect(decodeMitsubishiHeavy152(encodeMitsubishiHeavy152Raw(raw))).toBeNull();
  });
});
