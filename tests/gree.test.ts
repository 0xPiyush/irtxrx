import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildGreeRaw,
  encodeGreeRaw,
  sendGree,
  decodeGree,
  decodeGreeRaw,
  validGreeChecksum,
  parseGreeState,
  GreeMode,
  GreeFan,
  GreeSwingV,
  GreeSwingH,
} from "../src/protocols/gree";
import type { GreeState } from "../src/protocols/gree";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) {
    execSync("make", { cwd: `${import.meta.dir}/cpp` });
  }
}

function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}

function parseCppTimings(s: string): number[] {
  return s.split(",").map(Number);
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, "0")).join("");
}

beforeAll(() => {
  ensureRunner();
});

// ---------------------------------------------------------------------------
// State cases — each paired with the equivalent C++ `gree` runner args.
// Args: power temp mode fan swingVauto swingVpos swingH turbo light sleep
//       xfan econo ifeel wifi displayTemp timerMins
// ---------------------------------------------------------------------------

interface TC {
  label: string;
  state: GreeState;
  cppArgs: string;
}

const cases: TC[] = [
  {
    label: "cool 22 max, mid swing",
    state: { power: true, temp: 22, mode: GreeMode.Cool, fan: GreeFan.Max,
      swingAuto: false, swingV: GreeSwingV.Middle, swingH: GreeSwingH.Middle, light: true },
    cppArgs: "1 22 1 3 0 4 4 0 1 0 0 0 0 0 0 0",
  },
  {
    label: "auto (temp locks to 25)",
    state: { power: true, temp: 25, mode: GreeMode.Auto, fan: GreeFan.Auto,
      swingAuto: true, swingV: GreeSwingV.Auto, swingH: GreeSwingH.Off, light: true },
    cppArgs: "1 25 0 0 1 1 0 0 1 0 0 0 0 0 0 0",
  },
  {
    label: "heat 30 med, all toggles, timer 90, display inside",
    state: { power: true, temp: 30, mode: GreeMode.Heat, fan: GreeFan.Med,
      swingAuto: false, swingV: GreeSwingV.Down, swingH: GreeSwingH.MaxRight,
      turbo: true, light: true, sleep: true, xfan: true, econo: true,
      iFeel: true, wifi: true, displayTemp: 2, timerMinutes: 90 },
    cppArgs: "1 30 4 2 0 6 6 1 1 1 1 1 1 1 2 90",
  },
  {
    label: "dry (fan locks to 1)",
    state: { power: true, temp: 18, mode: GreeMode.Dry, fan: GreeFan.Max, light: true },
    cppArgs: "1 18 2 3 0 0 0 0 1 0 0 0 0 0 0 0",
  },
  {
    label: "power off, light off, timer max",
    state: { power: false, temp: 16, mode: GreeMode.Cool, fan: GreeFan.Min,
      swingAuto: false, swingV: GreeSwingV.LastPos, swingH: GreeSwingH.Off,
      light: false, timerMinutes: 1440 },
    cppArgs: "0 16 1 1 0 0 0 0 0 0 0 0 0 0 0 1440",
  },
];

// ---------------------------------------------------------------------------
// State encode cross-validation: buildGreeRaw vs C++ getRaw (fields + checksum)
// ---------------------------------------------------------------------------

describe("gree state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw bytes for ${tc.label}`, () => {
      const cppHex = cpp(`gree ${tc.cppArgs}`);
      expect(bytesToHex(buildGreeRaw(tc.state))).toBe(cppHex);
    });
  }
});

// ---------------------------------------------------------------------------
// Raw send cross-validation: encodeGreeRaw timings vs C++ sendGree
// ---------------------------------------------------------------------------

describe("encodeGreeRaw cross-validation", () => {
  for (const tc of cases) {
    it(`timings match C++ for ${tc.label}`, () => {
      const raw = buildGreeRaw(tc.state);
      const hex = bytesToHex(raw);
      const cppTimings = parseCppTimings(cpp(`sendGree ${hex} 0`));
      const tsTimings = encodeGreeRaw(raw, 0);
      expect(tsTimings).toEqual(cppTimings);
    });
  }
});

// ---------------------------------------------------------------------------
// Decode roundtrip: send → decode → build
// ---------------------------------------------------------------------------

describe("decodeGree roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildGreeRaw(tc.state);
      const timings = sendGree(tc.state, 1); // two frames
      const decoded = decodeGree(timings);
      expect(decoded).not.toBeNull();
      expect(bytesToHex(buildGreeRaw(decoded!))).toBe(bytesToHex(raw));
    });
  }

  it("decodes a second repeated frame at an offset", () => {
    const raw = buildGreeRaw(cases[0]!.state);
    const timings = encodeGreeRaw(raw, 1);
    const first = decodeGreeRaw(timings, 0);
    expect(first).not.toBeNull();
    const second = decodeGreeRaw(timings, first!.used);
    expect(second).not.toBeNull();
    expect(bytesToHex(second!.data)).toBe(bytesToHex(raw));
  });
});

// ---------------------------------------------------------------------------
// Decode C++ cross-validation: C++ encode → TS decode
// ---------------------------------------------------------------------------

describe("decodeGree C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const hex = cpp(`gree ${tc.cppArgs}`);
      const cppTimings = parseCppTimings(cpp(`sendGree ${hex} 0`));
      const result = decodeGreeRaw(cppTimings);
      expect(result).not.toBeNull();
      expect(bytesToHex(result!.data)).toBe(hex);
    });
  }
});

// ---------------------------------------------------------------------------
// Unified dispatcher
// ---------------------------------------------------------------------------

describe("decode() dispatch", () => {
  it("identifies a Gree frame as protocol gree / brand gree", () => {
    const timings = sendGree(cases[2]!.state, 1);
    const result = decode(timings);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("gree");
    expect(result!.brand).toBe("gree");
    expect(result!.confidence).toBe("checksum_valid");
  });

  it("honours a gree protocol hint", () => {
    const result = decode(sendGree(cases[0]!.state, 0), { protocol: "gree" });
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("gree");
  });
});

// ---------------------------------------------------------------------------
// Checksum + rejection
// ---------------------------------------------------------------------------

describe("gree checksum / rejection", () => {
  it("buildGreeRaw produces a valid checksum", () => {
    expect(validGreeChecksum(buildGreeRaw(cases[2]!.state))).toBe(true);
  });

  it("rejects empty / short timings", () => {
    expect(decodeGreeRaw([])).toBeNull();
    expect(decodeGreeRaw([1, 2, 3])).toBeNull();
  });

  it("rejects a corrupted checksum", () => {
    const raw = buildGreeRaw(cases[0]!.state);
    raw[7] = (raw[7]! ^ 0x10); // flip a checksum bit
    expect(validGreeChecksum(raw)).toBe(false);
    expect(decodeGree(encodeGreeRaw(raw, 0))).toBeNull();
  });

  it("rejects a corrupted block footer", () => {
    const timings = encodeGreeRaw(buildGreeRaw(cases[0]!.state), 0);
    // The 3 footer bits sit right after the header(2) + 32 data bits(64) = idx 66.
    timings[66] = 1; // mangle the first footer-bit mark
    timings[67] = 1;
    expect(decodeGree(timings)).toBeNull();
  });

  it("parseGreeState is the inverse of buildGreeRaw fields", () => {
    const decoded = parseGreeState(buildGreeRaw(cases[2]!.state));
    expect(decoded.mode).toBe(GreeMode.Heat);
    expect(decoded.temp).toBe(30);
    expect(decoded.fan).toBe(GreeFan.Med);
    expect(decoded.timerMinutes).toBe(90);
    expect(decoded.wifi).toBe(true);
  });
});
