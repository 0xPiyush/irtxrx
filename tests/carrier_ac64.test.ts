import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildCarrierAc64Raw, encodeCarrierAc64Raw, sendCarrierAc64, decodeCarrierAc64,
  CarrierAc64Mode, CarrierAc64Fan,
} from "../src/protocols/carrier_ac64";
import type { CarrierAc64State } from "../src/protocols/carrier_ac64";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(v: bigint): string { return v.toString(16).toUpperCase().padStart(16, "0"); }
beforeAll(() => { ensureRunner(); });

interface TC { label: string; state: CarrierAc64State; args: string; }
const cases: TC[] = [
  { label: "cool 24 auto", state: { power: true, mode: CarrierAc64Mode.Cool, temp: 24, fan: CarrierAc64Fan.Auto }, args: "1 2 24 0 0 0 0 0" },
  { label: "heat 30 high swingV", state: { power: true, mode: CarrierAc64Mode.Heat, temp: 30, fan: CarrierAc64Fan.High, swingV: true }, args: "1 1 30 3 1 0 0 0" },
  { label: "fan 16 med", state: { power: true, mode: CarrierAc64Mode.Fan, temp: 16, fan: CarrierAc64Fan.Medium }, args: "1 3 16 2 0 0 0 0" },
  { label: "off sleep", state: { power: false, mode: CarrierAc64Mode.Cool, temp: 25, fan: CarrierAc64Fan.Auto, sleep: true }, args: "0 2 25 0 0 1 0 0" },
  { label: "onTimer 3h", state: { power: true, mode: CarrierAc64Mode.Cool, temp: 22, fan: CarrierAc64Fan.Low, onTimer: 180 }, args: "1 2 22 1 0 0 180 0" },
  { label: "offTimer 5h", state: { power: true, mode: CarrierAc64Mode.Cool, temp: 22, fan: CarrierAc64Fan.Low, offTimer: 300 }, args: "1 2 22 1 0 0 0 300" },
];

describe("buildCarrierAc64Raw + encode cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw + timings for ${tc.label}`, () => {
      const ref = cpp(`carrierAc64 ${tc.args}`);
      const raw = buildCarrierAc64Raw(tc.state);
      expect(hex(raw)).toBe(ref);
      expect(encodeCarrierAc64Raw(raw)).toEqual(timings(cpp(`sendCarrierAC64 ${ref} 64`)));
    });
  }
});

describe("decodeCarrierAc64 roundtrip + C++", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildCarrierAc64Raw(tc.state);
      const d = decodeCarrierAc64(sendCarrierAc64(tc.state));
      expect(d).not.toBeNull();
      expect(hex(buildCarrierAc64Raw(d!))).toBe(hex(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const out = cpp(`decodeValue ${sendCarrierAc64(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe("CARRIER_AC64");
      expect(BigInt("0x" + out[1]!)).toBe(buildCarrierAc64Raw(tc.state));
    });
  }

  it("reads fields", () => {
    const s = decodeCarrierAc64(sendCarrierAc64(cases[1]!.state))!;
    expect(s.power).toBe(true);
    expect(s.mode).toBe(CarrierAc64Mode.Heat);
    expect(s.temp).toBe(30);
    expect(s.fan).toBe(CarrierAc64Fan.High);
    expect(s.swingV).toBe(true);
  });
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Carrier AC64 frame", () => {
    const r = decode(sendCarrierAc64(cases[0]!.state));
    expect(r?.protocol).toBe("carrier_ac64");
    expect(r?.confidence).toBe("checksum_valid");
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildCarrierAc64Raw(cases[0]!.state) ^ (1n << 24n); // flip a Temp bit, not the checksum
    expect(decodeCarrierAc64(encodeCarrierAc64Raw(raw))).toBeNull();
  });
});
