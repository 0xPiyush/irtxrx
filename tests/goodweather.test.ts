import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeGoodweatherRaw, sendGoodweather, decodeGoodweather, GOODWEATHER_BITS } from "../src/protocols/goodweather";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(v: bigint): string { return v.toString(16).toUpperCase(); }
beforeAll(() => { ensureRunner(); });

const MASK = (1n << 48n) - 1n;
const values = [0xd52906000000n, 0xd5496a010000n, 0x123456789abcn, 0n, MASK];

describe("encodeGoodweatherRaw cross-validation", () => {
  for (const v of values) for (const rep of [0, 1]) {
    it(`matches C++ for ${hex(v)} repeat=${rep}`, () => {
      expect(encodeGoodweatherRaw(v, GOODWEATHER_BITS, rep)).toEqual(timings(cpp(`sendGoodweather ${hex(v)} ${rep}`)));
    });
  }
});

describe("decodeGoodweather roundtrip + C++", () => {
  for (const v of values) {
    it(`roundtrips ${hex(v)}`, () => {
      const d = decodeGoodweather(encodeGoodweatherRaw(v));
      expect(d?.data).toBe(v & MASK);
      expect(sendGoodweather(d!)).toEqual(encodeGoodweatherRaw(v));
    });
    it(`C++ decode agrees for ${hex(v)}`, () => {
      const out = cpp(`decodeValue ${encodeGoodweatherRaw(v).join(",")}`).split("\n");
      expect(out[0]).toBe("GOODWEATHER");
      expect(BigInt("0x" + out[1]!)).toBe(v & MASK);
    });
  }
});

describe("decode() dispatch + real capture", () => {
  it("identifies a Goodweather frame", () => {
    const r = decode(encodeGoodweatherRaw(0xd52906000000n));
    expect(r?.protocol).toBe("goodweather");
    expect(r?.brand).toBe("goodweather");
  });

  // Real headerless-tolerant capture from a Lloyd-compatible universal remote.
  it("decodes a real captured frame", () => {
    const cap = [5889,7354,549,1617,549,1647,518,1647,549,1647,518,1647,549,1617,549,1647,518,1647,518,579,518,549,549,549,549,549,518,579,518,549,549,549,518,579,518,1647,518,1647,549,1647,518,1647,549,1647,518,1647,518,1647,549,1647,518,549,549,549,549,549,518,549,549,549,549,549,518,549,549,549,549,1647,518,1647,518,1647,549,1647,518,1647,549,1617,549,1647,518,1647,549,549,518,579,518,549,549,549,518,579,518,549,549,549,549,549,518,1647,549,549,518,549,549,1647,518,1647,549,1647,518,1647,518,1647,549,549,518,1647,549,1647,518,549,549,549,549,549,518,549,549,549,549,549,518,1647,549,1647,518,549,549,1647,518,549,549,1647,518,1647,549,1617,549,549,549,549,518,1647,549,549,518,1647,549,549,518,579,549,549,549,1617,549,549,549,1617,549,549,549,1617,549,549,549,549,518,1647,549,549,549,1617,549,549,549,1617,549,549,549,1617,549,1647,518,7354,549,0];
    const d = decodeGoodweather(cap, 0, true);
    expect(d?.data).toBe(0xd52906000000n);
  });

  it("rejects garbage", () => {
    expect(decodeGoodweather([])).toBeNull();
    expect(decodeGoodweather([1, 2, 3])).toBeNull();
  });
});
