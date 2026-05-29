import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeCoolix48, decodeCoolix48, COOLIX48_BITS } from "../src/protocols/coolix48";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) {
    execSync("make", { cwd: `${import.meta.dir}/cpp` });
  }
}

function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}

function parseCppTimings(s: string): number[] {
  return s.split(",").map(Number);
}

beforeAll(() => {
  ensureRunner();
});

// 48-bit codes. These deliberately do NOT follow the 24-bit Coolix
// byte/inverse-byte structure, so they are genuine Coolix48 frames.
const CODES: { label: string; data: bigint }[] = [
  { label: "incrementing", data: 0x123456789abcn },
  { label: "all ones", data: 0xffffffffffffn },
  { label: "low bit", data: 0x000000000001n },
  { label: "high byte", data: 0xab0000000000n },
  { label: "mixed", data: 0xdeadbeefcafen },
];

// ---------------------------------------------------------------------------
// Encode cross-validation: TS encode vs C++ sendCoolix48
// ---------------------------------------------------------------------------

describe("encodeCoolix48 cross-validation", () => {
  for (const tc of CODES) {
    it(`timings match C++ for ${tc.label}`, () => {
      const hex = tc.data.toString(16).toUpperCase();
      const cppTimings = parseCppTimings(cpp(`sendCoolix48 ${hex} 0`));
      const tsTimings = encodeCoolix48(tc.data, 0);

      // All entries match except the final gap (C++ pads it to its default
      // inter-message gap).
      expect(tsTimings.length).toBe(cppTimings.length);
      expect(tsTimings.slice(0, -1)).toEqual(cppTimings.slice(0, -1));
    });
  }
});

// ---------------------------------------------------------------------------
// Decode roundtrip: encode → decode
// ---------------------------------------------------------------------------

describe("decodeCoolix48 roundtrip", () => {
  for (const tc of CODES) {
    it(`roundtrips ${tc.label}`, () => {
      const timings = encodeCoolix48(tc.data, 1);
      expect(decodeCoolix48(timings)).toBe(tc.data);
    });
  }

  it("decodes a second repeated frame at an offset", () => {
    const timings = encodeCoolix48(0x123456789abcn, 1);
    // One frame = header(2) + 48 bits(96) + footer(2) = 100 entries.
    expect(decodeCoolix48(timings, 100)).toBe(0x123456789abcn);
  });
});

// ---------------------------------------------------------------------------
// Decode C++ cross-validation: C++ encode → TS decode
// ---------------------------------------------------------------------------

describe("decodeCoolix48 C++ cross-validation", () => {
  for (const tc of CODES) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const hex = tc.data.toString(16).toUpperCase();
      const cppTimings = parseCppTimings(cpp(`sendCoolix48 ${hex} 0`));
      expect(decodeCoolix48(cppTimings)).toBe(tc.data);
    });
  }
});

// ---------------------------------------------------------------------------
// Unified dispatcher
// ---------------------------------------------------------------------------

describe("decode() dispatch", () => {
  it("identifies a Coolix48 frame as protocol coolix48 / brand coolix", () => {
    const timings = encodeCoolix48(0xdeadbeefcafen, 1);
    const result = decode(timings);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("coolix48");
    expect(result!.brand).toBe("coolix");
    expect(result!.confidence).toBe("timing_match");
    expect((result as { raw: bigint }).raw).toBe(0xdeadbeefcafen);
  });

  it("honours a coolix48 protocol hint", () => {
    const timings = encodeCoolix48(0x010203040506n, 0);
    const result = decode(timings, { protocol: "coolix48" });
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("coolix48");
  });
});

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

describe("decodeCoolix48 rejection", () => {
  it("rejects empty timings", () => {
    expect(decodeCoolix48([])).toBeNull();
  });

  it("rejects timings that are too short", () => {
    expect(decodeCoolix48([1, 2, 3])).toBeNull();
  });

  it("rejects garbage data", () => {
    const garbage = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 500 : 100));
    expect(decodeCoolix48(garbage)).toBeNull();
  });

  it("exposes the bit width", () => {
    expect(COOLIX48_BITS).toBe(48);
  });
});
