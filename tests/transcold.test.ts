import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeTranscoldRaw, sendTranscold, decodeTranscold, TRANSCOLD_BITS } from "../src/protocols/transcold";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(v: number): string { return v.toString(16).toUpperCase(); }
beforeAll(() => { ensureRunner(); });

const values = [0xff6e54, 0x123456, 0, 0xabcdef, 0xffffff];

describe("encodeTranscoldRaw cross-validation", () => {
  for (const v of values) for (const rep of [0, 1]) {
    it(`matches C++ for ${hex(v)} repeat=${rep}`, () => {
      expect(encodeTranscoldRaw(v, TRANSCOLD_BITS, rep)).toEqual(timings(cpp(`sendTranscold ${hex(v)} ${rep}`)));
    });
  }
});

describe("decodeTranscold roundtrip + C++", () => {
  for (const v of values) {
    it(`roundtrips ${hex(v)}`, () => {
      const d = decodeTranscold(encodeTranscoldRaw(v));
      expect(d?.data).toBe(v & 0xffffff);
      expect(sendTranscold(d!)).toEqual(encodeTranscoldRaw(v));
    });
    it(`C++ decode agrees for ${hex(v)}`, () => {
      const out = cpp(`decodeValue ${encodeTranscoldRaw(v).join(",")}`).split("\n");
      expect(out[0]).toBe("TRANSCOLD");
      expect(parseInt(out[1]!, 16)).toBe(v & 0xffffff);
    });
  }
});

describe("decode() dispatch + real capture + rejection", () => {
  it("identifies a Transcold frame", () => {
    const r = decode(encodeTranscoldRaw(0xff6e54));
    expect(r?.protocol).toBe("transcold");
    expect(r?.brand).toBe("transcold");
  });

  // Real capture from a Lloyd-compatible universal remote.
  it("decodes a real captured frame", () => {
    const cap = [6408,7568,640,3387,640,3417,640,3387,640,3417,640,3417,610,3417,640,3417,640,3387,640,1403,610,1403,640,1373,640,1373,640,1403,640,1373,640,1373,640,1373,640,1403,640,3387,640,3417,640,1373,640,3417,640,3387,640,3417,640,1373,640,3417,640,1373,640,1373,640,3417,640,1373,640,1373,640,1403,640,3387,640,1373,640,3417,640,1373,640,3417,640,1373,640,3417,640,1373,640,1373,640,3417,640,1373,640,3417,640,1373,640,3387,640,1403,640,3387,640,3417,640,7324,640,0,0,0,0,0,0,0];
    const d = decodeTranscold(cap, 0, true);
    expect(d?.data).toBe(0xff6e54);
  });

  it("rejects a broken inversion", () => {
    const t = encodeTranscoldRaw(0xff6e54);
    // Corrupt the very first space so the normal/inverted check fails.
    t[3] = t[3]! > 2000 ? 1526 : 3556;
    expect(decodeTranscold(t)).toBeNull();
  });
});
