import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildMitsubishiHeavy88Raw, encodeMitsubishiHeavy88Raw, sendMitsubishiHeavy88, decodeMitsubishiHeavy88,
  MitsubishiHeavy88Mode, MitsubishiHeavy88Fan, MitsubishiHeavy88SwingV, MitsubishiHeavy88SwingH,
} from "../src/protocols/mitsubishi_heavy88";
import type { MitsubishiHeavy88State } from "../src/protocols/mitsubishi_heavy88";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

const M = MitsubishiHeavy88Mode, F = MitsubishiHeavy88Fan, SV = MitsubishiHeavy88SwingV, SH = MitsubishiHeavy88SwingH;
interface TC { label: string; state: MitsubishiHeavy88State; args: string; }
// power temp mode fan swingV swingH clean
const cases: TC[] = [
  { label: "cool 24 auto", state: { power: true, temp: 24, mode: M.Cool, fan: F.Auto, swingV: SV.Off, swingH: SH.Off }, args: "1 24 1 0 0 0 0" },
  { label: "heat 30 turbo swing 3d", state: { power: true, temp: 30, mode: M.Heat, fan: F.Turbo, swingV: SV.Highest, swingH: SH.ThreeD }, args: "1 30 4 6 6 14 0" },
  { label: "dry econo mid clean", state: { power: true, temp: 20, mode: M.Dry, fan: F.Econo, swingV: SV.Middle, swingH: SH.Middle, clean: true }, args: "1 20 2 7 3 9 1" },
  { label: "off auto swing", state: { power: false, temp: 25, mode: M.Auto, fan: F.Auto, swingV: SV.Auto, swingH: SH.Auto }, args: "0 25 0 0 4 8 0" },
];

describe("buildMitsubishiHeavy88Raw + encode cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw + timings for ${tc.label}`, () => {
      const raw = buildMitsubishiHeavy88Raw(tc.state);
      expect(hex(raw)).toBe(cpp(`mheavy88 ${tc.args}`).toLowerCase());
      for (const rep of [0, 1]) expect(encodeMitsubishiHeavy88Raw(raw, rep)).toEqual(timings(cpp(`sendMitsubishiHeavy88 ${hex(raw)} ${rep}`)));
    });
  }
});

describe("decodeMitsubishiHeavy88 roundtrip + C++", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      expect(hex(buildMitsubishiHeavy88Raw(decodeMitsubishiHeavy88(sendMitsubishiHeavy88(tc.state))!))).toBe(hex(buildMitsubishiHeavy88Raw(tc.state)));
    });
    it(`C++ decodes ${tc.label}`, () => {
      const out = cpp(`decode ${sendMitsubishiHeavy88(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe("MITSUBISHI_HEAVY_88");
      expect(out[1]!.toLowerCase()).toBe(hex(buildMitsubishiHeavy88Raw(tc.state)));
    });
  }

  it("reads split swing fields", () => {
    const s = decodeMitsubishiHeavy88(sendMitsubishiHeavy88(cases[1]!.state))!;
    expect(s.swingV).toBe(SV.Highest);
    expect(s.swingH).toBe(SH.ThreeD);
    expect(s.fan).toBe(F.Turbo);
  });
});

describe("real-hardware captures", () => {
  // Headerless capture (receiver missed the 3140/1630 leader) with marks
  // reading long (488µs) — needs the C++-equivalent 50µs mark-excess. C++
  // `identify` can't decode this (it requires the header); irtxrx does.
  const headerless = [427,335,427,1159,488,335,457,335,457,1129,457,335,457,1159,457,335,457,335,457,1129,457,1159,457,1129,457,335,457,1159,457,335,457,1129,457,1159,457,1129,457,335,457,335,457,335,457,366,427,1159,457,1129,457,335,457,1159,457,1129,457,335,457,366,427,1159,457,335,457,335,457,1159,457,335,457,335,457,1129,457,1159,457,335,457,1129,457,1129,488,1129,457,1129,457,335,457,1159,457,1129,457,1129,457,1159,457,335,457,335,457,335,457,1159,457,335,457,335,457,335,457,335,457,1159,457,1129,457,1129,457,1159,457,1129,457,335,457,1159,457,335,457,1129,457,335,457,366,457,335,457,335,427,1159,457,335,457,1159,457,335,457,335,457,1159,457,1129,457,396,396,1129,457,366,457,1129,457,1129,457,1159,457,335,457,335,457,1129,457,366,457,1129,457,335,457,335,457,0,0,0];

  it("decodes a headerless real capture (marks read long)", () => {
    const s = decodeMitsubishiHeavy88(headerless, 0, true)!;
    expect(s).not.toBeNull();
    expect(s.power).toBe(true);
    expect(s.temp).toBe(19);
    expect(s.mode).toBe(M.Cool);
    expect(s.fan).toBe(F.Low);
  });

  it("dispatch identifies the headerless capture as mitsubishi_heavy88", () => {
    expect(decode(headerless)?.protocol).toBe("mitsubishi_heavy88");
  });
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Mitsubishi Heavy 88 frame", () => {
    expect(decode(sendMitsubishiHeavy88(cases[0]!.state))?.protocol).toBe("mitsubishi_heavy88");
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildMitsubishiHeavy88Raw(cases[0]!.state);
    raw[6] = (raw[6]! ^ 0xff) & 0xff;
    expect(decodeMitsubishiHeavy88(encodeMitsubishiHeavy88Raw(raw))).toBeNull();
  });
});
