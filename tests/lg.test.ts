import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  encodeLgData,
  encodeLgRaw,
  sendLg,
  decodeLg,
} from "../src/protocols/lg";
import type { LgState } from "../src/protocols/lg";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function hex(v: bigint): string { return v.toString(16).toUpperCase(); }

beforeAll(() => { ensureRunner(); });

const codes: Array<[number, number]> = [[0x12, 0x3456], [0, 0], [0xff, 0xffff], [0x34, 0x00ff]];
// Known/derived valid 28-bit values (valid nibble checksums).
const values = codes.map(([a, c]) => encodeLgData(a, c)).concat([0x88c0051n, 0x8813149n]);

describe("encodeLgData cross-validation", () => {
  for (const [a, c] of codes) {
    it(`matches C++ for ${a},${c}`, () => {
      expect(encodeLgData(a, c)).toBe(BigInt("0x" + cpp(`encodeLG ${a} ${c}`)));
    });
  }
});

describe("encodeLgRaw cross-validation", () => {
  for (const v of values) {
    for (const [fn, lg2] of [["sendLG", false], ["sendLG2", true]] as const) {
      for (const rep of [0, 1, 2]) {
        it(`${fn} ${hex(v)} repeat=${rep}`, () => {
          expect(encodeLgRaw(v, 28, lg2, rep)).toEqual(parseCppTimings(cpp(`${fn} ${hex(v)} 28 ${rep}`)));
        });
      }
    }
  }
});

describe("decodeLg roundtrip", () => {
  for (const v of values) {
    it(`roundtrips ${hex(v)} (LG)`, () => {
      const d = decodeLg(encodeLgRaw(v, 28, false));
      expect(d).not.toBeNull();
      expect(d!.data).toBe(v);
      expect(d!.lg2).toBe(false);
      expect(sendLg(d!)).toEqual(encodeLgRaw(v, 28, false));
    });
    it(`roundtrips ${hex(v)} (LG2)`, () => {
      const d = decodeLg(encodeLgRaw(v, 28, true));
      expect(d).not.toBeNull();
      expect(d!.data).toBe(v);
      expect(d!.lg2).toBe(true);
    });
  }

  it("decodes without a header", () => {
    const v = encodeLgData(0x12, 0x3456);
    expect(decodeLg(encodeLgRaw(v, 28, false).slice(1), 0, true)?.data).toBe(v);
  });
});

describe("decodeLg C++ cross-validation", () => {
  for (const v of values) {
    it(`C++ decode agrees for ${hex(v)} (LG/LG2)`, () => {
      const lg = cpp(`decodeValue ${encodeLgRaw(v, 28, false).join(",")}`).split("\n");
      expect(lg[0]).toBe("LG");
      expect(BigInt("0x" + lg[1]!)).toBe(v);
      const lg2 = cpp(`decodeValue ${encodeLgRaw(v, 28, true).join(",")}`).split("\n");
      expect(lg2[0]).toBe("LG2");
      expect(BigInt("0x" + lg2[1]!)).toBe(v);
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a non-A/C LG frame as lg", () => {
    const v = encodeLgData(0x12, 0x3456); // address != 0x88 → not an A/C frame
    const r = decode(encodeLgRaw(v, 28, false));
    expect(r?.protocol).toBe("lg");
    expect(r?.brand).toBe("lg");
    expect((r?.state as LgState).data).toBe(v);
  });
});

describe("decodeLg rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeLg([])).toBeNull();
    expect(decodeLg([1, 2, 3])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const v = encodeLgData(0x12, 0x3456) ^ 0x1n; // flip a checksum bit
    expect(decodeLg(encodeLgRaw(v, 28, false))).toBeNull();
  });
});
