import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  encodeHitachiAc3Raw,
  sendHitachiAc3,
  decodeHitachiAc3,
  applyHitachiAc3Parity,
  HITACHI_AC3_LENGTHS,
} from "../src/protocols/hitachi3";

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

beforeAll(() => { ensureRunner(); });

/** Build a valid (parity-correct) AC3 frame of the given length. */
function makeFrame(length: number): Uint8Array {
  const data = new Uint8Array(length);
  // A fixed header plus some varied source bytes at the odd "data" positions.
  data[0] = 0x01; data[1] = 0x10; data[2] = 0x00;
  for (let i = 3; i < length; i += 2) data[i] = (i * 7 + 0x40) & 0xFF;
  return applyHitachiAc3Parity(data);
}

const frames = HITACHI_AC3_LENGTHS.map(makeFrame);

describe("sendHitachiAc3 raw cross-validation", () => {
  for (const frame of frames) {
    it(`matches C++ timings for a ${frame.length}-byte frame`, () => {
      const cppTimings = parseCppTimings(cpp(`sendHitachiAc3 ${toHex(frame)}`));
      expect(encodeHitachiAc3Raw(frame, 0)).toEqual(cppTimings);
    });
  }
});

describe("decodeHitachiAc3 roundtrip", () => {
  for (const frame of frames) {
    it(`roundtrips a ${frame.length}-byte frame`, () => {
      const decoded = decodeHitachiAc3(sendHitachiAc3(frame));
      expect(decoded).not.toBeNull();
      expect(decoded!.length).toBe(frame.length);
      expect(toHex(decoded!)).toBe(toHex(frame));
    });
  }

  it("decodes C++ timings back to the original bytes", () => {
    const frame = frames[0]!; // 27-byte
    const cppTimings = parseCppTimings(cpp(`sendHitachiAc3 ${toHex(frame)}`));
    expect(toHex(decodeHitachiAc3(cppTimings)!)).toBe(toHex(frame));
  });

  it("decodes without a header", () => {
    const frame = frames[3]!; // 17-byte
    const decoded = decodeHitachiAc3(sendHitachiAc3(frame).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(decoded!)).toBe(toHex(frame));
  });
});

describe("decodeHitachiAc3 rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeHitachiAc3([])).toBeNull();
    expect(decodeHitachiAc3([1, 2, 3])).toBeNull();
  });

  it("rejects broken byte-pair inversion", () => {
    const frame = makeFrame(23);
    frame[4] = (frame[4]! ^ 0xFF) & 0xFF; // break inverse of byte 3
    expect(decodeHitachiAc3(encodeHitachiAc3Raw(frame, 0))).toBeNull();
  });
});
