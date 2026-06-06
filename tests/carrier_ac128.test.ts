import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeCarrierAc128Raw, sendCarrierAc128, decodeCarrierAc128 } from "../src/protocols/carrier_ac128";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

const samples = [
  Uint8Array.from([0x16, 0xb6, 0x81, 0x00, 0x10, 0x00, 0x00, 0x06, 0x16, 0xb6, 0x81, 0x00, 0x10, 0x00, 0x00, 0x06]),
  Uint8Array.from(Array.from({ length: 16 }, (_, i) => (i * 17) & 0xff)),
];

describe("encodeCarrierAc128Raw cross-validation", () => {
  for (const s of samples) for (const rep of [0, 1]) {
    it(`matches C++ for ${hex(s)} repeat=${rep}`, () => {
      expect(encodeCarrierAc128Raw(s, rep)).toEqual(timings(cpp(`sendCarrierAC128 ${hex(s)} ${rep}`)));
    });
  }
});

describe("decodeCarrierAc128 roundtrip + C++", () => {
  for (const s of samples) {
    it(`roundtrips ${hex(s)}`, () => {
      const d = decodeCarrierAc128(sendCarrierAc128(s));
      expect(d).not.toBeNull();
      expect(hex(d!)).toBe(hex(s));
    });
    it(`C++ decode agrees for ${hex(s)}`, () => {
      const out = cpp(`decode ${sendCarrierAc128(s).join(",")}`).split("\n");
      expect(out[0]).toBe("CARRIER_AC128");
      expect(out[1]!.toLowerCase()).toBe(hex(s));
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Carrier AC128 frame", () => {
    expect(decode(sendCarrierAc128(samples[0]!))?.protocol).toBe("carrier_ac128");
  });
  it("rejects garbage", () => {
    expect(decodeCarrierAc128([])).toBeNull();
    expect(decodeCarrierAc128([1, 2, 3, 4])).toBeNull();
  });
});
