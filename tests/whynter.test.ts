import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeWhynter, decodeWhynter, WHYNTER_BITS } from "../src/protocols/whynter";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function t(o: string): number[] { return o.split(",").map(Number); }
beforeAll(() => { ensureRunner(); });

const CODES = [0x00000000n, 0x12345678n, 0xffffffffn, 0xdeadbeefn, 0x00000001n];
describe("Whynter", () => {
  for (const d of CODES) {
    it(`encode matches C++ for 0x${d.toString(16)}`, () => {
      expect(encodeWhynter(d, 0)).toEqual(t(cpp(`sendWhynter ${d.toString(16)} 0`)));
    });
    it(`roundtrips 0x${d.toString(16)}`, () => { expect(decodeWhynter(encodeWhynter(d, 0))).toBe(d); });
  }
  it("repeat + header-optional + dispatch + width", () => {
    expect(encodeWhynter(0x12345678n, 1)).toEqual(t(cpp("sendWhynter 12345678 1")));
    expect(decodeWhynter(encodeWhynter(0x12345678n, 0).slice(2), 0, true)).toBe(0x12345678n);
    const r = decode(encodeWhynter(0xdeadbeefn, 0));
    expect(r?.protocol).toBe("whynter");
    expect((r as { raw: bigint }).raw).toBe(0xdeadbeefn);
    expect(WHYNTER_BITS).toBe(32);
    expect(decodeWhynter([])).toBeNull();
  });
});
