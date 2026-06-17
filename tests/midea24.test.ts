import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeMidea24, decodeMidea24, MIDEA24_BITS } from "../src/protocols/midea24";
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

const CODES: { label: string; data: bigint }[] = [
  { label: "mixed", data: 0xabcdefn },
  { label: "zero", data: 0x000000n },
  { label: "all ones", data: 0xffffffn },
  { label: "low byte", data: 0x000001n },
  { label: "high byte", data: 0xa50000n },
];

describe("encodeMidea24 cross-validation", () => {
  for (const tc of CODES) {
    it(`timings match C++ for ${tc.label}`, () => {
      const hex = tc.data.toString(16).toUpperCase();
      expect(encodeMidea24(tc.data, 0)).toEqual(parseCppTimings(cpp(`sendMidea24 ${hex} 24 0`)));
    });
  }

  it("matches C++ timings with repeat", () => {
    expect(encodeMidea24(0xabcdefn, 1)).toEqual(parseCppTimings(cpp(`sendMidea24 ABCDEF 24 1`)));
  });
});

describe("decodeMidea24 roundtrip", () => {
  for (const tc of CODES) {
    it(`roundtrips ${tc.label}`, () => {
      expect(decodeMidea24(encodeMidea24(tc.data, 0))).toBe(tc.data);
    });
  }

  it("decodes without a header", () => {
    expect(decodeMidea24(encodeMidea24(0xabcdefn, 0).slice(2), 0, true)).toBe(0xabcdefn);
  });
});

describe("decodeMidea24 C++ cross-validation", () => {
  for (const tc of CODES) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const hex = tc.data.toString(16).toUpperCase();
      const out = cpp(`decodeValue ${cpp(`sendMidea24 ${hex} 24 0`)}`).split("\n");
      expect(out[0]).toBe("MIDEA24");
      expect(BigInt(`0x${out[1] || "0"}`)).toBe(tc.data);
      expect(decodeMidea24(parseCppTimings(cpp(`sendMidea24 ${hex} 24 0`)))).toBe(tc.data);
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Midea24 frame", () => {
    const r = decode(encodeMidea24(0xabcdefn, 1));
    expect(r?.protocol).toBe("midea24");
    expect(r?.brand).toBe("midea");
    expect((r as { raw: bigint }).raw).toBe(0xabcdefn);
  });
});

describe("decodeMidea24 rejection", () => {
  it("rejects empty/short", () => {
    expect(decodeMidea24([])).toBeNull();
    expect(decodeMidea24([1, 2, 3])).toBeNull();
  });
  it("rejects a broken inverse-byte pair", () => {
    const t = encodeMidea24(0xabcdefn, 0);
    // Flip a bit in the complement half so a byte/inverse pair no longer matches.
    t[2 + 8 + 1] = t[2 + 8 + 1] === 1680 ? 560 : 1680;
    expect(decodeMidea24(t)).toBeNull();
  });
  it("exposes the bit width", () => {
    expect(MIDEA24_BITS).toBe(24);
  });
});
