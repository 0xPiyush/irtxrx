import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  encodeSamsungData,
  encodeSamsungRaw,
  sendSamsung,
  decodeSamsung,
} from "../src/protocols/samsung";
import type { SamsungState } from "../src/protocols/samsung";
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

const codes: Array<[number, number]> = [[7, 7], [0x12, 0x34], [0, 0], [0xe0, 0xe0], [0xff, 0x01]];

describe("encodeSamsungData cross-validation", () => {
  for (const [cust, cmd] of codes) {
    it(`matches C++ for ${cust},${cmd}`, () => {
      const ref = BigInt("0x" + cpp(`encodeSAMSUNG ${cust} ${cmd}`));
      expect(encodeSamsungData(cust, cmd)).toBe(ref);
    });
  }
});

describe("encodeSamsungRaw cross-validation", () => {
  for (const [cust, cmd] of codes) {
    const v = encodeSamsungData(cust, cmd);
    const hex = v.toString(16).toUpperCase().padStart(8, "0");
    it(`matches C++ timings for ${hex}`, () => {
      expect(encodeSamsungRaw(v)).toEqual(parseCppTimings(cpp(`sendSAMSUNG ${hex} 32`)));
    });
    it(`matches C++ timings (repeat) for ${hex}`, () => {
      expect(encodeSamsungRaw(v, 32, 2)).toEqual(parseCppTimings(cpp(`sendSAMSUNG ${hex} 32 2`)));
    });
  }
});

describe("decodeSamsung roundtrip", () => {
  for (const [cust, cmd] of codes) {
    it(`roundtrips ${cust},${cmd}`, () => {
      const v = encodeSamsungData(cust, cmd);
      const decoded = decodeSamsung(encodeSamsungRaw(v));
      expect(decoded).not.toBeNull();
      expect(decoded!.data).toBe(v);
      expect(decoded!.command).toBe(cmd);
      expect(sendSamsung(decoded!)).toEqual(encodeSamsungRaw(v));
    });
  }

  it("decodes without a header", () => {
    const v = encodeSamsungData(0x12, 0x34);
    expect(decodeSamsung(encodeSamsungRaw(v).slice(2), 0, true)?.data).toBe(v);
  });
});

describe("decodeSamsung C++ cross-validation", () => {
  for (const [cust, cmd] of codes) {
    it(`C++ decode agrees for ${cust},${cmd}`, () => {
      const v = encodeSamsungData(cust, cmd);
      const out = cpp(`decodeValue ${encodeSamsungRaw(v).join(",")}`).split("\n");
      expect(out[0]).toBe("SAMSUNG");
      expect(BigInt("0x" + out[1]!)).toBe(v);
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Samsung frame", () => {
    const v = encodeSamsungData(0x12, 0x34);
    const r = decode(encodeSamsungRaw(v));
    expect(r?.protocol).toBe("samsung");
    expect(r?.brand).toBe("samsung");
    expect((r?.state as SamsungState).data).toBe(v);
  });
});

describe("decodeSamsung rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeSamsung([])).toBeNull();
    expect(decodeSamsung([1, 2, 3])).toBeNull();
  });
  it("rejects a non-repeated customer byte", () => {
    // Valid command halves, but customer byte not repeated.
    const v = (0x12n << 24n) | (0x99n << 16n) | (0x34n << 8n) | BigInt(0x34 ^ 0xff);
    expect(decodeSamsung(encodeSamsungRaw(v))).toBeNull();
  });
  it("rejects a non-inverted command byte", () => {
    const v = (0x12n << 24n) | (0x12n << 16n) | (0x34n << 8n) | 0x00n;
    expect(decodeSamsung(encodeSamsungRaw(v))).toBeNull();
  });
});
