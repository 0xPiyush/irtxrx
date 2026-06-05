import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  encodePanasonicData,
  encodePanasonicRaw,
  sendPanasonic,
  decodePanasonic,
  PANASONIC_MANUFACTURER,
} from "../src/protocols/panasonic";
import type { PanasonicState } from "../src/protocols/panasonic";
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

// device, subdevice, function triples to exercise encode + checksum.
const codes: Array<[number, number, number]> = [
  [1, 2, 3],
  [0x80, 0x00, 0x40],
  [0xAA, 0x55, 0x0F],
  [0x00, 0x00, 0x00],
  [0xFF, 0xFF, 0xFF],
];

describe("encodePanasonicData cross-validation", () => {
  for (const [dev, sub, fn] of codes) {
    it(`matches C++ for ${dev},${sub},${fn}`, () => {
      const ours = encodePanasonicData(PANASONIC_MANUFACTURER, dev, sub, fn);
      const ref = BigInt("0x" + cpp(`encodePanasonic 4004 ${dev} ${sub} ${fn}`));
      expect(ours).toBe(ref);
    });
  }
});

describe("sendPanasonic64 raw cross-validation", () => {
  for (const [dev, sub, fn] of codes) {
    const v = encodePanasonicData(PANASONIC_MANUFACTURER, dev, sub, fn);
    const hex = v.toString(16).toUpperCase().padStart(12, "0");
    it(`matches C++ timings for ${hex}`, () => {
      expect(encodePanasonicRaw(v, 48, 0)).toEqual(parseCppTimings(cpp(`sendPanasonic64 ${hex} 48`)));
    });
    it(`matches C++ timings for ${hex} with repeat`, () => {
      expect(encodePanasonicRaw(v, 48, 2)).toEqual(parseCppTimings(cpp(`sendPanasonic64 ${hex} 48 2`)));
    });
  }
});

describe("decodePanasonic roundtrip", () => {
  for (const [dev, sub, fn] of codes) {
    it(`roundtrips ${dev},${sub},${fn}`, () => {
      const v = encodePanasonicData(PANASONIC_MANUFACTURER, dev, sub, fn);
      const decoded = decodePanasonic(encodePanasonicRaw(v));
      expect(decoded).not.toBeNull();
      expect(decoded!.data).toBe(v);
      expect(decoded!.manufacturer).toBe(PANASONIC_MANUFACTURER);
      expect(decoded!.device).toBe(dev);
      expect(decoded!.subdevice).toBe(sub);
      expect(decoded!.function).toBe(fn);
    });
  }

  it("decodes without a header", () => {
    const v = encodePanasonicData(PANASONIC_MANUFACTURER, 0x12, 0x34, 0x56);
    const decoded = decodePanasonic(encodePanasonicRaw(v).slice(2), 0, true);
    expect(decoded?.data).toBe(v);
  });

  it("re-encodes a decoded state (sendPanasonic)", () => {
    const v = encodePanasonicData(PANASONIC_MANUFACTURER, 0x12, 0x34, 0x56);
    const timings = encodePanasonicRaw(v);
    const state = decodePanasonic(timings)!;
    expect(sendPanasonic(state)).toEqual(timings);
  });
});

describe("decodePanasonic C++ cross-validation", () => {
  for (const [dev, sub, fn] of codes) {
    it(`C++ decode agrees for ${dev},${sub},${fn}`, () => {
      const v = encodePanasonicData(PANASONIC_MANUFACTURER, dev, sub, fn);
      const timings = encodePanasonicRaw(v);
      const out = cpp(`decodeValue ${timings.join(",")}`).split("\n");
      expect(out[0]).toBe("PANASONIC");
      expect(BigInt("0x" + out[1]!)).toBe(v);
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Panasonic 48-bit frame", () => {
    const v = encodePanasonicData(PANASONIC_MANUFACTURER, 0x12, 0x34, 0x56);
    const r = decode(encodePanasonicRaw(v));
    expect(r?.protocol).toBe("panasonic");
    expect(r?.brand).toBe("panasonic");
    expect(r?.confidence).toBe("checksum_valid");
    expect((r?.state as PanasonicState).data).toBe(v);
  });
});

describe("decodePanasonic rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodePanasonic([])).toBeNull();
    expect(decodePanasonic([1, 2, 3])).toBeNull();
  });
  it("rejects a wrong manufacturer code", () => {
    const v = (0x1234n << 32n) | 0x01020300n; // checksum 1^2^3=0, but mfr != 0x4004
    expect(decodePanasonic(encodePanasonicRaw(v))).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const v = encodePanasonicData(PANASONIC_MANUFACTURER, 1, 2, 3) ^ 0x01n; // flip checksum
    expect(decodePanasonic(encodePanasonicRaw(v))).toBeNull();
  });
});
