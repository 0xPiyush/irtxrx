import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeSanyoAc152Raw, sendSanyoAc152, decodeSanyoAc152 } from "../src/protocols/sanyo_ac152";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

const samples = [
  Uint8Array.from(Array.from({ length: 19 }, (_, i) => (i * 13) & 0xff)),
  Uint8Array.from(Array.from({ length: 19 }, (_, i) => (0xa5 ^ (i * 7)) & 0xff)),
];

describe("encodeSanyoAc152Raw cross-validation", () => {
  for (const s of samples) for (const rep of [0, 1]) {
    it(`matches C++ for ${hex(s)} repeat=${rep}`, () => {
      expect(encodeSanyoAc152Raw(s, rep)).toEqual(timings(cpp(`sendSanyoAc152 ${hex(s)} ${rep}`)));
    });
  }
});

describe("decodeSanyoAc152 roundtrip + C++", () => {
  for (const s of samples) {
    it(`roundtrips ${hex(s)}`, () => {
      expect(hex(decodeSanyoAc152(sendSanyoAc152(s))!)).toBe(hex(s));
    });
    it(`C++ decodes ${hex(s)}`, () => {
      const out = cpp(`decode ${sendSanyoAc152(s).join(",")}`).split("\n");
      expect(out[0]).toBe("SANYO_AC152");
      expect(out[1]!.toLowerCase()).toBe(hex(s));
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Sanyo AC152 frame", () => {
    expect(decode(sendSanyoAc152(samples[0]!))?.protocol).toBe("sanyo_ac152");
  });
  it("rejects garbage", () => {
    expect(decodeSanyoAc152([])).toBeNull();
    expect(decodeSanyoAc152([1, 2, 3])).toBeNull();
  });
});
