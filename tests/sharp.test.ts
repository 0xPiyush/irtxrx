import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeSharpData, encodeSharpRaw, sendSharp, decodeSharp } from "../src/protocols/sharp";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(v: bigint): string { return v.toString(16).toUpperCase(); }
beforeAll(() => { ensureRunner(); });

const codes: Array<[number, number]> = [[1, 0x4a], [0x1f, 0xff], [0, 0], [0x12, 0x34]];

describe("encodeSharpData cross-validation", () => {
  for (const [a, c] of codes) {
    it(`matches C++ for ${a},${c}`, () => {
      expect(encodeSharpData(a, c)).toBe(BigInt("0x" + cpp(`encodeSharp ${a} ${c}`)));
    });
  }
});

describe("encodeSharpRaw cross-validation", () => {
  for (const [a, c] of codes) {
    const v = encodeSharpData(a, c);
    for (const rep of [0, 1]) {
      it(`matches C++ for ${hex(v)} repeat=${rep}`, () => {
        expect(encodeSharpRaw(v, 15, rep)).toEqual(timings(cpp(`sendSharpRaw ${hex(v)} 15 ${rep}`)));
      });
    }
  }
});

describe("decodeSharp roundtrip + C++", () => {
  for (const [a, c] of codes) {
    it(`roundtrips ${a},${c}`, () => {
      const v = encodeSharpData(a, c);
      const d = decodeSharp(encodeSharpRaw(v));
      expect(d?.data).toBe(v);
      expect(d?.command).toBe(c);
      expect(sendSharp(d!)).toEqual(encodeSharpRaw(v));
    });
    it(`C++ decode agrees for ${a},${c}`, () => {
      const v = encodeSharpData(a, c);
      const out = cpp(`decodeValue ${encodeSharpRaw(v).join(",")}`).split("\n");
      expect(out[0]).toBe("SHARP");
      expect(BigInt("0x" + out[1]!)).toBe(v);
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Sharp frame", () => {
    expect(decode(encodeSharpRaw(encodeSharpData(1, 0x4a)))?.protocol).toBe("sharp");
  });
  it("rejects empty/garbage", () => {
    expect(decodeSharp([])).toBeNull();
    expect(decodeSharp([1, 2, 3])).toBeNull();
  });
});
