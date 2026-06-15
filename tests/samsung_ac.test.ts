import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildSamsungAcRaw,
  buildSamsungAcExtendedRaw,
  encodeSamsungAcRaw,
  sendSamsungAc,
  sendSamsungAcOn,
  sendSamsungAcOff,
  decodeSamsungAc,
  SamsungAcMode,
  SamsungAcFan,
} from "../src/protocols/samsung_ac";
import type { SamsungAcState } from "../src/protocols/samsung_ac";
import { decode } from "../src/decode";

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

interface TestCase {
  label: string;
  state: SamsungAcState;
  // power temp mode fan swingV swingH quiet powerful breeze econo clean beep display ion
  cppArgs: string;
}

const cases: TestCase[] = [
  { label: "cool 24 high", state: { power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.High }, cppArgs: "1 24 1 5 0 0 0 0 0 0 0 0 0 0" },
  { label: "auto 25", state: { power: true, temp: 25, mode: SamsungAcMode.Auto, fan: SamsungAcFan.Auto }, cppArgs: "1 25 0 0 0 0 0 0 0 0 0 0 0 0" },
  { label: "heat 30 low swingV", state: { power: true, temp: 30, mode: SamsungAcMode.Heat, fan: SamsungAcFan.Low, swingV: true }, cppArgs: "1 30 4 2 1 0 0 0 0 0 0 0 0 0" },
  { label: "dry 18 swing both", state: { power: true, temp: 18, mode: SamsungAcMode.Dry, fan: SamsungAcFan.Med, swingV: true, swingH: true }, cppArgs: "1 18 2 4 1 1 0 0 0 0 0 0 0 0" },
  { label: "fan mode quiet", state: { power: true, temp: 22, mode: SamsungAcMode.Fan, fan: SamsungAcFan.Auto, quiet: true }, cppArgs: "1 22 3 0 0 0 1 0 0 0 0 0 0 0" },
  { label: "powerful", state: { power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.High, powerful: true }, cppArgs: "1 24 1 5 0 0 0 1 0 0 0 0 0 0" },
  { label: "breeze (windfree)", state: { power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Auto, breeze: true }, cppArgs: "1 24 1 0 0 0 0 0 1 0 0 0 0 0" },
  { label: "econo", state: { power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Auto, econo: true }, cppArgs: "1 24 1 0 0 0 0 0 0 1 0 0 0 0" },
  { label: "off + clean+beep+display+ion", state: { power: false, temp: 26, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Med, clean: true, beep: true, display: true, ion: true }, cppArgs: "0 26 1 4 0 0 0 0 0 0 1 1 1 1" },
  { label: "swingH only", state: { power: true, temp: 20, mode: SamsungAcMode.Cool, fan: SamsungAcFan.High, swingH: true }, cppArgs: "1 20 1 5 0 1 0 0 0 0 0 0 0 0" },
];

describe("buildSamsungAcRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw for ${tc.label}`, () => {
      expect(toHex(buildSamsungAcRaw(tc.state))).toBe(cpp(`samsungAc ${tc.cppArgs}`).split("\n")[0]!);
    });
  }
});

describe("encodeSamsungAcRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ timings for ${tc.label}`, () => {
      const lines = cpp(`samsungAc ${tc.cppArgs}`).split("\n");
      expect(encodeSamsungAcRaw(buildSamsungAcRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }

  it("matches C++ timings with repeat", () => {
    const raw = buildSamsungAcRaw(cases[0]!.state);
    expect(encodeSamsungAcRaw(raw, 1)).toEqual(parseCppTimings(cpp(`sendSamsungAC ${toHex(raw)} 1`)));
  });
});

describe("decodeSamsungAc roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildSamsungAcRaw(tc.state);
      const decoded = decodeSamsungAc(sendSamsungAc(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildSamsungAcRaw(decoded!))).toBe(toHex(raw));
    });
  }

  it("decodes without a header", () => {
    const state = cases[0]!.state;
    const decoded = decodeSamsungAc(sendSamsungAc(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildSamsungAcRaw(decoded!))).toBe(toHex(buildSamsungAcRaw(state)));
  });

  it("reads the expected fields (powerful)", () => {
    const s = decodeSamsungAc(sendSamsungAc(cases[5]!.state))!;
    expect(s.power).toBe(true);
    expect(s.mode).toBe(SamsungAcMode.Cool);
    expect(s.temp).toBe(24);
    expect(s.powerful).toBe(true);
    expect(s.fan).toBe(SamsungAcFan.Turbo);
  });
});

describe("decodeSamsungAc C++ cross-validation", () => {
  for (const tc of cases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildSamsungAcRaw(tc.state);
      const out = cpp(`decode ${encodeSamsungAcRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("SAMSUNG_AC");
      expect(out[1]).toBe(toHex(raw));
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies a Samsung AC frame", () => {
    const r = decode(sendSamsungAc(cases[0]!.state));
    expect(r?.protocol).toBe("samsung_ac");
    expect(r?.brand).toBe("samsung");
    expect(r?.confidence).toBe("checksum_valid");
  });
});

// --- Extended (21-byte) message: timers, sleep, explicit power ------------

interface ExtCase {
  label: string;
  state: SamsungAcState;
}

const extCases: ExtCase[] = [
  { label: "power toggle (extended flag, no timer)", state: { power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Auto, extended: true } },
  { label: "off timer 120m", state: { power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Auto, offTimer: 120 } },
  { label: "on timer 90m", state: { power: true, temp: 22, mode: SamsungAcMode.Heat, fan: SamsungAcFan.Low, onTimer: 90 } },
  { label: "sleep timer 480m", state: { power: true, temp: 26, mode: SamsungAcMode.Cool, fan: SamsungAcFan.High, sleepTimer: 480 } },
  { label: "on timer full day (1440m)", state: { power: true, temp: 25, mode: SamsungAcMode.Auto, fan: SamsungAcFan.Auto, onTimer: 1440 } },
  { label: "on 600m + off 300m, power off", state: { power: false, temp: 20, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Med, onTimer: 600, offTimer: 300 } },
  { label: "odd minutes round down to 10m (155m → 150m)", state: { power: true, temp: 21, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Auto, offTimer: 155 } },
];

describe("buildSamsungAcExtendedRaw cross-validation", () => {
  // The vendor IRrecv decoding our timings is the authoritative check that the
  // 21-byte layout, timer bits, and all three section checksums are correct.
  for (const tc of extCases) {
    it(`vendor decodes our extended timings for ${tc.label}`, () => {
      const raw = buildSamsungAcExtendedRaw(tc.state);
      expect(raw.length).toBe(21);
      const out = cpp(`decode ${sendSamsungAc(tc.state).join(",")}`).split("\n");
      expect(out[0]).toBe("SAMSUNG_AC");
      expect(out[1]).toBe(toHex(raw));
    });
  }

  // The vendor class loading our bytes recovers the exact timer/sleep/power
  // values we encoded — proves the field placement matches the firmware.
  for (const tc of extCases) {
    it(`vendor class recovers fields for ${tc.label}`, () => {
      const raw = buildSamsungAcExtendedRaw(tc.state);
      const ours = decodeSamsungAc(sendSamsungAc(tc.state))!;
      const f = cpp(`samsungAcGetExt ${toHex(raw)}`).split(" ").map(Number);
      // power temp mode fan swingV swingH quiet powerful breeze econo clean beep display ion onTimer offTimer sleepTimer
      expect(f[0]).toBe(ours.power ? 1 : 0);
      expect(f[1]).toBe(ours.temp);
      expect(f[2]).toBe(ours.mode);
      // In Auto mode the vendor reports the internal Auto2 fan code (6); our
      // decoder normalises it back to Auto (0), matching the standard decoder.
      expect(f[3] === 6 ? 0 : f[3]).toBe(ours.fan);
      expect(f[14]).toBe(ours.onTimer ?? 0);
      expect(f[15]).toBe(ours.offTimer ?? 0);
      expect(f[16]).toBe(ours.sleepTimer ?? 0);
    });
  }
});

describe("decodeSamsungAc extended roundtrip", () => {
  for (const tc of extCases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildSamsungAcExtendedRaw(tc.state);
      const decoded = decodeSamsungAc(sendSamsungAc(tc.state));
      expect(decoded).not.toBeNull();
      expect(decoded!.extended).toBe(true);
      // Re-encoding the decoded state reproduces the exact 21-byte message.
      expect(toHex(buildSamsungAcExtendedRaw(decoded!))).toBe(toHex(raw));
    });
  }

  it("reads the off timer (120m, no sleep)", () => {
    const s = decodeSamsungAc(sendSamsungAc({ power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Auto, offTimer: 120 }))!;
    expect(s.offTimer).toBe(120);
    expect(s.sleepTimer).toBe(0);
    expect(s.onTimer).toBe(0);
  });

  it("sleep timer is reported separately from the off timer", () => {
    const s = decodeSamsungAc(sendSamsungAc({ power: true, temp: 26, mode: SamsungAcMode.Cool, fan: SamsungAcFan.High, sleepTimer: 480 }))!;
    expect(s.sleepTimer).toBe(480);
    expect(s.offTimer).toBe(0);
  });
});

describe("extended message selection", () => {
  it("sends 14-byte (2 sections) when no timer/extended is set", () => {
    // header(2) + 2 sections × (2 header + 7×8×2 bits + footer mark + gap = 2+112+2)
    expect(decodeSamsungAc(sendSamsungAc(cases[0]!.state))!.extended).toBeUndefined();
  });
  it("sends 21-byte (extended) when a timer is set", () => {
    const r = decode(sendSamsungAc({ power: true, temp: 24, mode: SamsungAcMode.Cool, fan: SamsungAcFan.Auto, offTimer: 60 }));
    expect(r?.protocol).toBe("samsung_ac");
    expect((r?.state as SamsungAcState).extended).toBe(true);
  });
});

describe("fixed extended power messages", () => {
  it("sendSamsungAcOn matches the vendor sendOn payload timings", () => {
    const ON = "02920F000000F001D20F0000000001E2FE718011F0";
    expect(sendSamsungAcOn()).toEqual(parseCppTimings(cpp(`sendSamsungAC ${ON}`)));
    const r = decode(sendSamsungAcOn());
    expect(r?.protocol).toBe("samsung_ac");
    expect((r?.state as SamsungAcState).power).toBe(true);
  });
  it("sendSamsungAcOff matches the vendor sendOff payload timings", () => {
    const OFF = "02B20F000000C001D20F0000000001 02FF718011C0".replace(/ /g, "");
    expect(sendSamsungAcOff()).toEqual(parseCppTimings(cpp(`sendSamsungAC ${OFF}`)));
    const r = decode(sendSamsungAcOff());
    expect((r?.state as SamsungAcState).power).toBe(false);
  });
});

describe("decodeSamsungAc rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeSamsungAc([])).toBeNull();
    expect(decodeSamsungAc([1, 2, 3, 4])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildSamsungAcRaw(cases[0]!.state);
    raw[3] = (raw[3]! ^ 0xff) & 0xff; // a data byte in section 1 → checksum mismatch
    expect(decodeSamsungAc(encodeSamsungAcRaw(raw, 0))).toBeNull();
  });
});
