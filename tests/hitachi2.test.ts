import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  encodeHitachiAc2Raw,
  sendHitachiAc2,
  decodeHitachiAc2,
} from "../src/protocols/hitachi2";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) {
    execSync("make", { cwd: `${import.meta.dir}/cpp` });
  }
}

function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}

function parseCppTimings(output: string): number[] {
  return output.split(",").map(Number);
}

function toHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

beforeAll(() => {
  ensureRunner();
});

// Two arbitrary 53-byte (106 hex char) payloads — AC2 has no structured state.
const PAYLOADS = [
  "0110004000FFFFCC927F1F".padEnd(106, "0"),
  "0210104201020304050607FECDAB8967452301102030405060708090A0B0C0D0E0F0112233445566".padEnd(106, "0"),
];

describe("hitachiAc2 raw cross-validation", () => {
  for (const hex of PAYLOADS) {
    it(`matches C++ timings for ${hex.slice(0, 16)}…`, () => {
      const data = fromHex(hex);
      const cppTimings = parseCppTimings(cpp(`sendHitachiAc2 ${hex}`));
      expect(encodeHitachiAc2Raw(data, 0)).toEqual(cppTimings);
    });
  }
});

describe("decodeHitachiAc2 roundtrip", () => {
  for (const hex of PAYLOADS) {
    it(`roundtrips ${hex.slice(0, 16)}…`, () => {
      const data = fromHex(hex);
      const decoded = decodeHitachiAc2(sendHitachiAc2(data));
      expect(decoded).not.toBeNull();
      expect(toHex(decoded!)).toBe(hex.toUpperCase());
    });
  }

  it("decodes C++ timings back to the original bytes", () => {
    const hex = PAYLOADS[1]!;
    const cppTimings = parseCppTimings(cpp(`sendHitachiAc2 ${hex}`));
    expect(toHex(decodeHitachiAc2(cppTimings)!)).toBe(hex.toUpperCase());
  });

  it("decodes without a header", () => {
    const data = fromHex(PAYLOADS[0]!);
    const noHeader = sendHitachiAc2(data).slice(2);
    expect(toHex(decodeHitachiAc2(noHeader, 0, true)!)).toBe(PAYLOADS[0]!.toUpperCase());
  });
});

describe("decodeHitachiAc2 rejection", () => {
  it("rejects empty/short input", () => {
    expect(decodeHitachiAc2([])).toBeNull();
    expect(decodeHitachiAc2([1, 2, 3])).toBeNull();
  });
});
