import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { encodeCarrierAc84Raw, sendCarrierAc84, decodeCarrierAc84 } from "../src/protocols/carrier_ac84";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function timings(o: string): number[] { return o.split(",").map(Number); }
function hex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

// 11-byte payloads; only the low nibble of byte 0 is carried.
const samples = [
  Uint8Array.from([0x04, 0x1b, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  Uint8Array.from([0x0a, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa]),
  Uint8Array.from([0x0f, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00]),
];

describe("encodeCarrierAc84Raw cross-validation", () => {
  for (const s of samples) for (const rep of [0, 1]) {
    it(`matches C++ for ${hex(s)} repeat=${rep}`, () => {
      expect(encodeCarrierAc84Raw(s, rep)).toEqual(timings(cpp(`sendCarrierAC84 ${hex(s)} ${rep}`)));
    });
  }
});

describe("decodeCarrierAc84 roundtrip + C++", () => {
  for (const s of samples) {
    it(`roundtrips ${hex(s)}`, () => {
      const d = decodeCarrierAc84(sendCarrierAc84(s));
      expect(d).not.toBeNull();
      expect(hex(d!)).toBe(hex(s));
    });
    it(`C++ decode agrees for ${hex(s)}`, () => {
      const out = cpp(`decode ${sendCarrierAc84(s).join(",")}`).split("\n");
      expect(out[0]).toBe("CARRIER_AC84");
      expect(out[1]!.toLowerCase()).toBe(hex(s));
    });
  }
});

describe("decode() dispatch + rejection", () => {
  it("identifies a Carrier AC84 frame", () => {
    expect(decode(sendCarrierAc84(samples[0]!))?.protocol).toBe("carrier_ac84");
  });
  it("rejects garbage", () => {
    expect(decodeCarrierAc84([])).toBeNull();
    expect(decodeCarrierAc84([1, 2, 3, 4])).toBeNull();
  });
});
