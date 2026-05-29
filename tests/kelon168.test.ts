import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildKelon168Raw,
  encodeKelon168Raw,
  sendKelon168,
  decodeKelon168,
  decodeKelon168Raw,
  validKelon168Checksum,
  parseKelon168State,
  Kelon168Mode,
  Kelon168Fan,
  Kelon168Command,
} from "../src/protocols/kelon168";
import type { Kelon168State } from "../src/protocols/kelon168";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
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

// Args: on temp mode fan swing light clockMins offEn offMins onEn onMins cmd
// (non-auto modes; super/sleep left at their reset defaults)
interface TC {
  label: string;
  state: Kelon168State;
  cppArgs: string;
}

const cases: TC[] = [
  {
    label: "cool 24 max, swing, light, cmd=temp",
    state: { power: true, powerFlag: true, temp: 24, mode: Kelon168Mode.Cool, fan: Kelon168Fan.Max,
      swingV: true, light: true, command: Kelon168Command.Temp },
    cppArgs: "1 24 2 5 1 1 0 0 0 0 0 2",
  },
  {
    label: "heat 30 auto, off, clock+timers, cmd=mode",
    state: { power: false, powerFlag: true, temp: 30, mode: Kelon168Mode.Heat, fan: Kelon168Fan.Auto,
      swingV: false, light: false, clockMinutes: 510,
      offTimerEnabled: true, offTimerMinutes: 1320,
      onTimerEnabled: true, onTimerMinutes: 360, command: Kelon168Command.Mode },
    cppArgs: "0 30 0 0 0 0 510 1 1320 1 360 6",
  },
  {
    label: "dry 16 medium, clock max, on-timer, cmd=ontimer",
    state: { power: true, powerFlag: true, temp: 16, mode: Kelon168Mode.Dry, fan: Kelon168Fan.Medium,
      swingV: true, light: true, clockMinutes: 1439,
      onTimerEnabled: true, onTimerMinutes: 90, command: Kelon168Command.OnTimer },
    cppArgs: "1 16 3 3 1 1 1439 0 0 1 90 5",
  },
  {
    label: "fan-mode 28 high, cmd=fanspeed",
    state: { power: true, powerFlag: true, temp: 28, mode: Kelon168Mode.Fan, fan: Kelon168Fan.High,
      swingV: false, light: true, clockMinutes: 720, command: Kelon168Command.FanSpeed },
    cppArgs: "1 28 4 4 0 1 720 0 0 0 0 17",
  },
];

describe("kelon168 state cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw bytes for ${tc.label}`, () => {
      expect(bytesToHex(buildKelon168Raw(tc.state))).toBe(cpp(`kelon168 ${tc.cppArgs}`));
    });
  }
});

describe("kelon168 checksum cross-validation", () => {
  for (const tc of cases) {
    it(`C++ recomputes the same checksums for ${tc.label}`, () => {
      const hex = bytesToHex(buildKelon168Raw(tc.state));
      // Feeding our bytes back through C++'s checksum recompute must be a no-op.
      expect(cpp(`kelon168cksum ${hex}`)).toBe(hex);
    });
  }
});

describe("encodeKelon168Raw cross-validation", () => {
  for (const tc of cases) {
    it(`timings match C++ for ${tc.label}`, () => {
      const raw = buildKelon168Raw(tc.state);
      const cppTimings = parseCppTimings(cpp(`sendKelon168 ${bytesToHex(raw)} 0`));
      expect(encodeKelon168Raw(raw, 0)).toEqual(cppTimings);
    });
  }
});

describe("decodeKelon168 roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildKelon168Raw(tc.state);
      const decoded = decodeKelon168(sendKelon168(tc.state, 1));
      expect(decoded).not.toBeNull();
      expect(bytesToHex(buildKelon168Raw(decoded!))).toBe(bytesToHex(raw));
    });
  }

  it("decodes a second repeated frame at an offset", () => {
    const raw = buildKelon168Raw(cases[0]!.state);
    const timings = encodeKelon168Raw(raw, 1);
    const first = decodeKelon168Raw(timings, 0);
    expect(first).not.toBeNull();
    const second = decodeKelon168Raw(timings, first!.used);
    expect(second).not.toBeNull();
    expect(bytesToHex(second!.data)).toBe(bytesToHex(raw));
  });
});

describe("decodeKelon168 C++ cross-validation", () => {
  for (const tc of cases) {
    it(`decodes C++ timings for ${tc.label}`, () => {
      const hex = cpp(`kelon168 ${tc.cppArgs}`);
      const cppTimings = parseCppTimings(cpp(`sendKelon168 ${hex} 0`));
      const result = decodeKelon168Raw(cppTimings);
      expect(result).not.toBeNull();
      expect(bytesToHex(result!.data)).toBe(hex);
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Kelon168 frame as protocol kelon168 / brand kelon", () => {
    const result = decode(sendKelon168(cases[1]!.state, 1));
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("kelon168");
    expect(result!.brand).toBe("kelon");
    expect(result!.confidence).toBe("checksum_valid");
  });
});

describe("kelon168 checksum / rejection", () => {
  it("buildKelon168Raw produces valid checksums", () => {
    expect(validKelon168Checksum(buildKelon168Raw(cases[2]!.state))).toBe(true);
  });

  it("rejects empty / short timings", () => {
    expect(decodeKelon168Raw([])).toBeNull();
    expect(decodeKelon168Raw([1, 2, 3])).toBeNull();
  });

  it("rejects a corrupted checksum", () => {
    const raw = buildKelon168Raw(cases[0]!.state);
    raw[13] = raw[13]! ^ 0xff;
    expect(validKelon168Checksum(raw)).toBe(false);
    expect(decodeKelon168(encodeKelon168Raw(raw, 0))).toBeNull();
  });

  it("super/sleep bits round-trip (raw path)", () => {
    const raw = buildKelon168Raw({ ...cases[0]!.state, super: true, sleep: true });
    const decoded = parseKelon168State(raw);
    expect(decoded.super).toBe(true);
    expect(decoded.sleep).toBe(true);
  });
});
