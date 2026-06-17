import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeGorenje, decodeGorenje, GORENJE_BITS } from "../src/protocols/gorenje";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function t(o: string): number[] { return o.split(",").map(Number); }
beforeAll(() => { ensureRunner(); });

const CODES = [0x00n, 0x01n, 0x55n, 0xaan, 0xffn, 0x3cn];
describe("Gorenje", () => {
  for (const d of CODES) {
    it(`encode matches C++ for 0x${d.toString(16)}`, () => {
      expect(encodeGorenje(d, 0)).toEqual(t(cpp(`sendGorenje ${d.toString(16)} 0`)));
    });
    it(`roundtrips 0x${d.toString(16)}`, () => { expect(decodeGorenje(encodeGorenje(d, 0))).toBe(d); });
  }
  it("repeat + dispatch + width", () => {
    expect(encodeGorenje(0x3cn, 1)).toEqual(t(cpp("sendGorenje 3C 1")));
    const r = decode(encodeGorenje(0x3cn, 0));
    expect(r?.protocol).toBe("gorenje");
    expect((r as { raw: bigint }).raw).toBe(0x3cn);
    expect(GORENJE_BITS).toBe(8);
    expect(decodeGorenje([])).toBeNull();
  });
});
