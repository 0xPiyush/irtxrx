import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeCarrierAcRaw, sendCarrierAc, decodeCarrierAc } from "../src/protocols/carrier_ac";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(v: bigint): string { return v.toString(16).toUpperCase(); }
beforeAll(() => { ensureRunner(); });

const values = [0x4fb847n, 0x12345678n, 0xabcdef01n, 0n, 0xffffffffn];

describe("encodeCarrierAcRaw cross-validation", () => {
  for (const v of values) for (const rep of [0, 1]) {
    it(`matches C++ for ${hex(v)} repeat=${rep}`, () => {
      expect(encodeCarrierAcRaw(v, 32, rep)).toEqual(timings(cpp(`sendCarrierAC ${hex(v)} 32 ${rep}`)));
    });
  }
});

describe("decodeCarrierAc roundtrip + C++", () => {
  for (const v of values) {
    it(`roundtrips ${hex(v)}`, () => {
      const d = decodeCarrierAc(encodeCarrierAcRaw(v));
      expect(d).not.toBeNull();
      expect(d!.data).toBe(v);
      expect(sendCarrierAc(d!)).toEqual(encodeCarrierAcRaw(v));
    });
    it(`C++ decode agrees for ${hex(v)}`, () => {
      const out = cpp(`decodeValue ${encodeCarrierAcRaw(v).join(",")}`).split("\n");
      expect(out[0]).toBe("CARRIER_AC");
      expect(BigInt("0x" + out[1]!)).toBe(v);
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Carrier AC frame", () => {
    const r = decode(encodeCarrierAcRaw(0x4fb847n));
    expect(r?.protocol).toBe("carrier_ac");
    expect(r?.brand).toBe("carrier");
  });
  it("rejects garbage and a broken inverted block", () => {
    expect(decodeCarrierAc([])).toBeNull();
    const t = encodeCarrierAcRaw(0x4fb847n);
    t[2 + 64 + 4]! += 5000; // corrupt a bit in the inverted (2nd) block
    expect(decodeCarrierAc(t)).toBeNull();
  });
});
