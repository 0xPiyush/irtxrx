import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  encodeSamsung36Raw,
  sendSamsung36,
  decodeSamsung36,
} from "../src/protocols/samsung36";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }

beforeAll(() => { ensureRunner(); });

const values: bigint[] = [0x123456789n, 0xabcdef012n, 0x0n, 0xfffffffffn, 0x400c0e01en];

describe("encodeSamsung36Raw cross-validation", () => {
  for (const v of values) {
    const hex = v.toString(16).toUpperCase();
    it(`matches C++ timings for ${hex}`, () => {
      expect(encodeSamsung36Raw(v)).toEqual(parseCppTimings(cpp(`sendSamsung36 ${hex} 36`)));
    });
    it(`matches C++ timings (repeat) for ${hex}`, () => {
      expect(encodeSamsung36Raw(v, 36, 1)).toEqual(parseCppTimings(cpp(`sendSamsung36 ${hex} 36 1`)));
    });
  }
});

describe("decodeSamsung36 roundtrip", () => {
  for (const v of values) {
    it(`roundtrips ${v.toString(16)}`, () => {
      const decoded = decodeSamsung36(encodeSamsung36Raw(v));
      expect(decoded).not.toBeNull();
      expect(decoded!.data).toBe(v);
      expect(decoded!.address).toBe(Number(v >> 20n));
      expect(decoded!.command).toBe(Number(v & 0xfffffn));
      expect(sendSamsung36(decoded!)).toEqual(encodeSamsung36Raw(v));
    });
  }
});

describe("decodeSamsung36 C++ cross-validation", () => {
  for (const v of values) {
    it(`C++ decode agrees for ${v.toString(16)}`, () => {
      const out = cpp(`decodeValue ${encodeSamsung36Raw(v).join(",")}`).split("\n");
      expect(out[0]).toBe("SAMSUNG36");
      expect(BigInt("0x" + out[1]!)).toBe(v);
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Samsung36 frame", () => {
    const r = decode(encodeSamsung36Raw(0x123456789n));
    expect(r?.protocol).toBe("samsung36");
    expect(r?.brand).toBe("samsung");
  });
});

describe("decodeSamsung36 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeSamsung36([])).toBeNull();
    expect(decodeSamsung36([1, 2, 3, 4, 5])).toBeNull();
  });
});
