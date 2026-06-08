import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeBluestarHeavyRaw, sendBluestarHeavy, decodeBluestarHeavy } from "../src/protocols/bluestar_heavy";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

const samples = [
  Uint8Array.from([0x2a, 0x00, 0x20, 0xd0, 0x05, 0xa0, 0x05, 0xa0, 0x00, 0x80, 0xba, 0x02, 0x23]),
  Uint8Array.from(Array.from({ length: 13 }, (_, i) => (i * 19) & 0xff)),
];

describe("encodeBluestarHeavyRaw cross-validation", () => {
  for (const s of samples) for (const rep of [0, 1]) {
    it(`matches C++ for ${hex(s)} repeat=${rep}`, () => {
      expect(encodeBluestarHeavyRaw(s, rep)).toEqual(timings(cpp(`sendBluestarHeavy ${hex(s)} ${rep}`)));
    });
  }
});

describe("decodeBluestarHeavy roundtrip + C++", () => {
  for (const s of samples) {
    it(`roundtrips ${hex(s)}`, () => {
      expect(hex(decodeBluestarHeavy(sendBluestarHeavy(s))!)).toBe(hex(s));
    });
    it(`C++ decodes ${hex(s)}`, () => {
      const out = cpp(`decode ${sendBluestarHeavy(s).join(",")}`).split("\n");
      expect(out[0]).toBe("BLUESTARHEAVY");
      expect(out[1]!.toLowerCase()).toBe(hex(s));
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a BluestarHeavy frame", () => {
    const r = decode(sendBluestarHeavy(samples[0]!));
    expect(r?.protocol).toBe("bluestar_heavy");
    expect(r?.brand).toBe("bluestar");
  });
  it("rejects garbage", () => {
    expect(decodeBluestarHeavy([])).toBeNull();
    expect(decodeBluestarHeavy([1, 2, 3])).toBeNull();
  });
});
