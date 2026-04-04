import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeNEC, sendNEC } from "../src/protocols/nec";

const RUNNER = `${import.meta.dir}/cpp/runner`;

/** Compile the C++ runner if it doesn't exist. */
function ensureRunner() {
  if (!existsSync(RUNNER)) {
    execSync("make", { cwd: `${import.meta.dir}/cpp` });
  }
}

/** Run the C++ runner and return stdout trimmed. */
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}

/** Parse comma-separated uint32 output into a number array. */
function parseCppTimings(output: string): number[] {
  return output.split(",").map(Number);
}

beforeAll(() => {
  ensureRunner();
});

// ---------------------------------------------------------------------------
// sendNEC cross-validation
// ---------------------------------------------------------------------------

interface SendNECCase {
  label: string;
  dataHex: string;
  data: number | bigint;
  nbits: number;
  repeat: number;
}

const sendNECCases: SendNECCase[] = [
  // Basic data patterns
  { label: "all zeros, 32 bits", dataHex: "0", data: 0x0, nbits: 32, repeat: 0 },
  { label: "all ones, 32 bits", dataHex: "FFFFFFFF", data: 0xffffffff, nbits: 32, repeat: 0 },
  { label: "alternating bits", dataHex: "AA00FF55", data: 0xaa00ff55, nbits: 32, repeat: 0 },
  { label: "typical NEC command", dataHex: "807F40BF", data: 0x807f40bf, nbits: 32, repeat: 0 },

  // Different bit lengths
  { label: "4 bits", dataHex: "A", data: 0xa, nbits: 4, repeat: 0 },
  { label: "8 bits", dataHex: "0", data: 0, nbits: 8, repeat: 0 },
  { label: "8 bits 0xAA", dataHex: "AA", data: 0xaa, nbits: 8, repeat: 0 },
  { label: "16 bits", dataHex: "ABCD", data: 0xabcd, nbits: 16, repeat: 0 },
  { label: "64 bits", dataHex: "1234567890ABCDEF", data: 0x1234567890abcdefn, nbits: 64, repeat: 0 },

  // Repeats
  { label: "8 bits, 1 repeat", dataHex: "AA", data: 0xaa, nbits: 8, repeat: 1 },
  { label: "8 bits, 3 repeats", dataHex: "AA", data: 0xaa, nbits: 8, repeat: 3 },
  { label: "32 bits, 1 repeat", dataHex: "807F40BF", data: 0x807f40bf, nbits: 32, repeat: 1 },
  { label: "32 bits, 5 repeats", dataHex: "807F40BF", data: 0x807f40bf, nbits: 32, repeat: 5 },
];

describe("sendNEC cross-validation", () => {
  for (const tc of sendNECCases) {
    it(`matches C++ for ${tc.label}`, () => {
      const cppArgs = `sendNEC ${tc.dataHex} ${tc.nbits} ${tc.repeat}`;
      const cppOutput = parseCppTimings(cpp(cppArgs));
      const tsOutput = sendNEC(tc.data, tc.nbits, tc.repeat);
      expect(tsOutput).toEqual(cppOutput);
    });
  }
});

// ---------------------------------------------------------------------------
// encodeNEC cross-validation
// ---------------------------------------------------------------------------

interface EncodeNECCase {
  label: string;
  address: number;
  command: number;
}

const encodeNECCases: EncodeNECCase[] = [
  // Normal NEC (8-bit address)
  { label: "addr=0, cmd=0", address: 0, command: 0 },
  { label: "addr=1, cmd=2", address: 1, command: 2 },
  { label: "addr=0xFF, cmd=0xFF", address: 0xff, command: 0xff },
  { label: "addr=0x5A, cmd=0xA5", address: 0x5a, command: 0xa5 },

  // Extended NEC (16-bit address)
  { label: "addr=0x1234, cmd=0x56", address: 0x1234, command: 0x56 },
  { label: "addr=0x100, cmd=0", address: 0x100, command: 0 },
  { label: "addr=0xFFFF, cmd=0xFF", address: 0xffff, command: 0xff },
];

describe("encodeNEC cross-validation", () => {
  for (const tc of encodeNECCases) {
    it(`matches C++ for ${tc.label}`, () => {
      const cppResult = Number(cpp(`encodeNEC ${tc.address} ${tc.command}`));
      const tsResult = encodeNEC(tc.address, tc.command);
      expect(tsResult).toBe(cppResult);
    });
  }

  // Round-trip: encodeNEC → sendNEC should also match
  for (const tc of encodeNECCases) {
    it(`round-trip sendNEC(encodeNEC(${tc.label})) matches C++`, () => {
      const encoded = encodeNEC(tc.address, tc.command);
      const tsTimings = sendNEC(encoded);
      const cppTimings = parseCppTimings(
        cpp(`sendNEC ${encoded.toString(16).toUpperCase()} 32 0`),
      );
      expect(tsTimings).toEqual(cppTimings);
    });
  }
});
