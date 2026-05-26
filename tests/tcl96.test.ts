import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeTcl96Raw, sendTcl96, decodeTcl96 } from "../src/protocols/tcl96";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function toHex(a: Uint8Array): string {
  return Array.from(a).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

beforeAll(() => { ensureRunner(); });

// 12-byte (24 hex char) payloads. TCL96AC has no structured class/state.
const PAYLOADS = [
  "23060000000000000000000A",
  "1B79E4C3000102030405060A",
  "FFFFFFFFFFFFFFFFFFFFFFFF", // exercises all-0b11 symbols
  "000000000000000000000000", // all-0b00 symbols
];

describe("sendTcl96 raw cross-validation", () => {
  for (const hex of PAYLOADS) {
    it(`matches C++ timings for ${hex.slice(0, 8)}…`, () => {
      const cppTimings = parseCppTimings(cpp(`sendTcl96Ac ${hex}`));
      expect(encodeTcl96Raw(fromHex(hex), 0)).toEqual(cppTimings);
    });
  }
});

describe("decodeTcl96 roundtrip", () => {
  for (const hex of PAYLOADS) {
    it(`roundtrips ${hex.slice(0, 8)}…`, () => {
      const decoded = decodeTcl96(sendTcl96(fromHex(hex)));
      expect(decoded).not.toBeNull();
      expect(toHex(decoded!)).toBe(hex);
    });
  }

  it("decodes without a header", () => {
    const data = fromHex(PAYLOADS[1]!);
    const decoded = decodeTcl96(sendTcl96(data).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(decoded!)).toBe(PAYLOADS[1]!);
  });
});

// Cross-validate against the dedicated C++ decodeTcl96Ac (via IRrecv::decode).
describe("decodeTcl96 C++ cross-validation", () => {
  for (const hex of PAYLOADS) {
    it(`C++ decode agrees for ${hex.slice(0, 8)}…`, () => {
      const timings = encodeTcl96Raw(fromHex(hex), 0);
      const out = cpp(`decode ${timings.join(",")}`).split("\n");
      expect(out[0]).toBe("TCL96AC");
      expect(out[1]).toBe(hex);
    });
  }
});

describe("decodeTcl96 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeTcl96([])).toBeNull();
    expect(decodeTcl96([1, 2, 3])).toBeNull();
  });
  it("rejects a truncated frame", () => {
    const timings = encodeTcl96Raw(fromHex(PAYLOADS[0]!), 0).slice(0, 40);
    expect(decodeTcl96(timings)).toBeNull();
  });
});
