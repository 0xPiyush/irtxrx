import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeSanyoLc7461Data, encodeSanyoLc7461Raw, sendSanyoLc7461, decodeSanyoLc7461 } from "../src/protocols/sanyo_lc7461";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(v: bigint): string { return v.toString(16).toUpperCase(); }
beforeAll(() => { ensureRunner(); });

const codes: Array<[number, number]> = [[0x123, 0x4a], [0, 0], [0x1fff, 0xff], [0x55, 0xaa]];

describe("encodeSanyoLc7461Data cross-validation", () => {
  for (const [a, c] of codes) {
    it(`matches C++ for ${a},${c}`, () => {
      expect(encodeSanyoLc7461Data(a, c)).toBe(BigInt("0x" + cpp(`encodeSanyoLC7461 ${a} ${c}`)));
    });
  }
});

describe("encodeSanyoLc7461Raw cross-validation", () => {
  for (const [a, c] of codes) {
    const v = encodeSanyoLc7461Data(a, c);
    for (const rep of [0, 1]) {
      it(`matches C++ for ${hex(v)} repeat=${rep}`, () => {
        expect(encodeSanyoLc7461Raw(v, 42, rep)).toEqual(timings(cpp(`sendSanyoLC7461 ${hex(v)} 42 ${rep}`)));
      });
    }
  }
});

describe("decodeSanyoLc7461 roundtrip + C++", () => {
  for (const [a, c] of codes) {
    it(`roundtrips ${a},${c}`, () => {
      const v = encodeSanyoLc7461Data(a, c);
      const d = decodeSanyoLc7461(encodeSanyoLc7461Raw(v));
      expect(d?.data).toBe(v);
      expect(d?.address).toBe(a);
      expect(d?.command).toBe(c);
      expect(sendSanyoLc7461(d!)).toEqual(encodeSanyoLc7461Raw(v));
    });
    it(`C++ decode agrees for ${a},${c}`, () => {
      const v = encodeSanyoLc7461Data(a, c);
      const out = cpp(`decodeValue ${encodeSanyoLc7461Raw(v).join(",")}`).split("\n");
      expect(out[0]).toBe("SANYO_LC7461");
      expect(BigInt("0x" + out[1]!)).toBe(v);
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Sanyo LC7461 frame", () => {
    expect(decode(encodeSanyoLc7461Raw(encodeSanyoLc7461Data(0x123, 0x4a)))?.protocol).toBe("sanyo_lc7461");
  });
  it("rejects a corrupted inverted half", () => {
    const v = encodeSanyoLc7461Data(0x123, 0x4a) ^ 0x1n; // flip a check bit
    expect(decodeSanyoLc7461(encodeSanyoLc7461Raw(v))).toBeNull();
  });
});
