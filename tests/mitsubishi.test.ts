import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeMitsubishiRaw, sendMitsubishi, decodeMitsubishi } from "../src/protocols/mitsubishi";
import { encodeMitsubishi2Raw, sendMitsubishi2, decodeMitsubishi2 } from "../src/protocols/mitsubishi2";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function parseCppTimings(s: string): number[] {
  return s.split(",").map(Number);
}
const hex = (v: number) => v.toString(16).toUpperCase();

beforeAll(() => {
  ensureRunner();
});

const values = [0xe2c0, 0x1234, 0xabcd, 0x00ff, 0xf0f0];

// ---------------------------------------------------------------------------
// Mitsubishi (16-bit TV)
// ---------------------------------------------------------------------------

describe("mitsubishi (TV) cross-validation", () => {
  for (const v of values) {
    it(`timings match C++ for 0x${hex(v)}`, () => {
      const cppT = parseCppTimings(cpp(`sendMitsubishi ${hex(v)} 0`));
      const tsT = encodeMitsubishiRaw(v, 0);
      expect(tsT.length).toBe(cppT.length);
      expect(tsT.slice(0, -1)).toEqual(cppT.slice(0, -1));
    });
  }

  it("roundtrips via decode", () => {
    for (const v of values) {
      const decoded = decodeMitsubishi(sendMitsubishi({ value: v }, 1));
      expect(decoded).not.toBeNull();
      expect(decoded!.value).toBe(v);
    }
  });

  it("decodes C++ timings", () => {
    for (const v of values) {
      const decoded = decodeMitsubishi(parseCppTimings(cpp(`sendMitsubishi ${hex(v)} 0`)));
      expect(decoded!.value).toBe(v);
    }
  });

  it("dispatches as protocol mitsubishi", () => {
    const r = decode(sendMitsubishi({ value: 0xe2c0 }, 1));
    expect(r).not.toBeNull();
    expect(r!.protocol).toBe("mitsubishi");
    expect(r!.brand).toBe("mitsubishi");
  });
});

// ---------------------------------------------------------------------------
// Mitsubishi2 (HC3000 projector)
// ---------------------------------------------------------------------------

describe("mitsubishi2 cross-validation", () => {
  for (const v of values) {
    it(`timings match C++ for 0x${hex(v)}`, () => {
      const cppT = parseCppTimings(cpp(`sendMitsubishi2 ${hex(v)} 0`));
      const tsT = encodeMitsubishi2Raw(v, 0);
      expect(tsT.length).toBe(cppT.length);
      expect(tsT.slice(0, -1)).toEqual(cppT.slice(0, -1));
    });
  }

  it("roundtrips via decode", () => {
    for (const v of values) {
      const decoded = decodeMitsubishi2(sendMitsubishi2({ value: v }, 1));
      expect(decoded).not.toBeNull();
      expect(decoded!.value).toBe(v);
    }
  });

  it("decodes C++ timings", () => {
    for (const v of values) {
      const decoded = decodeMitsubishi2(parseCppTimings(cpp(`sendMitsubishi2 ${hex(v)} 0`)));
      expect(decoded!.value).toBe(v);
    }
  });

  it("dispatches as protocol mitsubishi2", () => {
    const r = decode(sendMitsubishi2({ value: 0x1234 }, 1));
    expect(r).not.toBeNull();
    expect(r!.protocol).toBe("mitsubishi2");
    expect(r!.brand).toBe("mitsubishi");
  });
});

describe("rejection", () => {
  it("rejects empty timings", () => {
    expect(decodeMitsubishi([])).toBeNull();
    expect(decodeMitsubishi2([])).toBeNull();
  });
});
