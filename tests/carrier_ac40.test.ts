import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeCarrierAc40Raw, sendCarrierAc40, decodeCarrierAc40 } from "../src/protocols/carrier_ac40";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(v: bigint): string { return v.toString(16).toUpperCase(); }
beforeAll(() => { ensureRunner(); });

const values = [0x12345678n, 0xabcdef0123n, 0xffffffffffn, 0n];

describe("encodeCarrierAc40Raw cross-validation", () => {
  for (const v of values) for (const rep of [0, 2]) {
    it(`matches C++ for ${hex(v)} repeat=${rep}`, () => {
      expect(encodeCarrierAc40Raw(v, 40, rep)).toEqual(timings(cpp(`sendCarrierAC40 ${hex(v)} 40 ${rep}`)));
    });
  }
});

describe("decodeCarrierAc40 roundtrip + C++", () => {
  for (const v of values) {
    it(`roundtrips ${hex(v)}`, () => {
      const d = decodeCarrierAc40(encodeCarrierAc40Raw(v));
      expect(d?.data).toBe(v);
      expect(sendCarrierAc40(d!)).toEqual(encodeCarrierAc40Raw(v));
    });
    it(`C++ decode agrees for ${hex(v)}`, () => {
      const out = cpp(`decodeValue ${encodeCarrierAc40Raw(v).join(",")}`).split("\n");
      expect(out[0]).toBe("CARRIER_AC40");
      expect(BigInt("0x" + out[1]!)).toBe(v);
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Carrier AC40 frame", () => {
    expect(decode(encodeCarrierAc40Raw(0x12345678n))?.protocol).toBe("carrier_ac40");
  });
  it("rejects garbage", () => {
    expect(decodeCarrierAc40([])).toBeNull();
    expect(decodeCarrierAc40([1, 2, 3])).toBeNull();
  });
});
