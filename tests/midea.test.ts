import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildMideaRaw,
  encodeMideaRaw,
  sendMidea,
  decodeMidea,
  parseMideaState,
  mideaValidChecksum,
  MideaMode,
  MideaFan,
  MIDEA_SPECIALS,
  MIDEA_BITS,
} from "../src/protocols/midea";
import type { MideaState, MideaSpecial } from "../src/protocols/midea";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;

function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function parseCppTimings(o: string): number[] { return o.split(",").map(Number); }
function hex12(v: bigint): string {
  return v.toString(16).toUpperCase().padStart(12, "0");
}

beforeAll(() => { ensureRunner(); });

interface TestCase {
  label: string;
  state: MideaState;
  // power temp mode fan sleep celsius sensorTemp onTimer offTimer
  cppArgs: string;
}

const cases: TestCase[] = [
  { label: "cool 24 auto", state: { power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto }, cppArgs: "1 24 0 0 0 1 -1 -1 -1" },
  { label: "auto 25", state: { power: true, temp: 25, mode: MideaMode.Auto, fan: MideaFan.Auto }, cppArgs: "1 25 2 0 0 1 -1 -1 -1" },
  { label: "heat 30 high", state: { power: true, temp: 30, mode: MideaMode.Heat, fan: MideaFan.High }, cppArgs: "1 30 3 3 0 1 -1 -1 -1" },
  { label: "dry 17 low", state: { power: true, temp: 17, mode: MideaMode.Dry, fan: MideaFan.Low }, cppArgs: "1 17 1 1 0 1 -1 -1 -1" },
  { label: "fan 22 med", state: { power: true, temp: 22, mode: MideaMode.Fan, fan: MideaFan.Med }, cppArgs: "1 22 4 2 0 1 -1 -1 -1" },
  { label: "cool 20 sleep", state: { power: true, temp: 20, mode: MideaMode.Cool, fan: MideaFan.High, sleep: true }, cppArgs: "1 20 0 3 1 1 -1 -1 -1" },
  { label: "off cool 26", state: { power: false, temp: 26, mode: MideaMode.Cool, fan: MideaFan.Med }, cppArgs: "0 26 0 2 0 1 -1 -1 -1" },
  // Fahrenheit native
  { label: "cool 75F", state: { power: true, temp: 75, mode: MideaMode.Cool, fan: MideaFan.Auto, celsius: false }, cppArgs: "1 75 0 0 0 0 -1 -1 -1" },
  { label: "heat 62F low", state: { power: true, temp: 62, mode: MideaMode.Heat, fan: MideaFan.Low, celsius: false }, cppArgs: "1 62 3 1 0 0 -1 -1 -1" },
  // FollowMe sensor temperature (Type → Follow)
  { label: "followMe sensor 28C", state: { power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto, sensorTemp: 28 }, cppArgs: "1 24 0 0 0 1 28 -1 -1" },
  { label: "followMe sensor 0C", state: { power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto, sensorTemp: 0 }, cppArgs: "1 24 0 0 0 1 0 -1 -1" },
  { label: "followMe sensor 99F", state: { power: true, temp: 75, mode: MideaMode.Heat, fan: MideaFan.High, celsius: false, sensorTemp: 99 }, cppArgs: "1 75 3 3 0 0 99 -1 -1" },
  // Timers
  { label: "onTimer 120m", state: { power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto, onTimer: 120 }, cppArgs: "1 24 0 0 0 1 -1 120 -1" },
  { label: "onTimer 90m (round to 60)", state: { power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto, onTimer: 75 }, cppArgs: "1 24 0 0 0 1 -1 75 -1" },
  { label: "offTimer 90m", state: { power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto, offTimer: 90 }, cppArgs: "1 24 0 0 0 1 -1 -1 90" },
  { label: "onTimer 30 + offTimer 1440", state: { power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto, onTimer: 30, offTimer: 1440 }, cppArgs: "1 24 0 0 0 1 -1 30 1440" },
];

describe("buildMideaRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ value for ${tc.label}`, () => {
      expect(hex12(buildMideaRaw(tc.state))).toBe(cpp(`midea ${tc.cppArgs}`).split("\n")[0]!);
    });
  }
});

describe("encodeMideaRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ timings for ${tc.label}`, () => {
      const lines = cpp(`midea ${tc.cppArgs}`).split("\n");
      expect(encodeMideaRaw(buildMideaRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }

  it("matches C++ timings with repeat", () => {
    const raw = buildMideaRaw(cases[0]!.state);
    expect(encodeMideaRaw(raw, 1)).toEqual(parseCppTimings(cpp(`sendMidea ${hex12(raw)} 1`)));
  });
});

describe("decodeMidea roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildMideaRaw(tc.state);
      const decoded = decodeMidea(sendMidea(tc.state));
      expect(decoded).not.toBeNull();
      expect(hex12(buildMideaRaw(decoded!))).toBe(hex12(raw));
    });
  }

  it("decodes without a header", () => {
    const state = cases[0]!.state;
    const decoded = decodeMidea(sendMidea(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(hex12(buildMideaRaw(decoded!))).toBe(hex12(buildMideaRaw(state)));
  });

  it("reads command fields", () => {
    const s = decodeMidea(sendMidea(cases[5]!.state))!;
    expect(s).toMatchObject({ power: true, mode: MideaMode.Cool, temp: 20, fan: MideaFan.High, sleep: true, celsius: true });
  });

  it("reads FollowMe sensor temperature", () => {
    const s = decodeMidea(sendMidea({ power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto, sensorTemp: 28 }))!;
    expect(s.sensorTemp).toBe(28);
    expect(s.onTimer).toBeUndefined();
  });

  it("reads timers", () => {
    const on = decodeMidea(sendMidea({ power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto, onTimer: 120 }))!;
    expect(on.onTimer).toBe(120);
    const off = decodeMidea(sendMidea({ power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto, offTimer: 90 }))!;
    expect(off.offTimer).toBe(90);
  });
});

describe("decodeMidea C++ cross-validation", () => {
  for (const tc of cases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildMideaRaw(tc.state);
      const out = cpp(`decodeValue ${encodeMideaRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("MIDEA");
      expect(BigInt(`0x${out[1]}`)).toBe(raw);
    });
  }
});

// --- Special / toggle one-shot codes ---------------------------------------

describe("special toggle codes", () => {
  it("match the vendor constants exactly", () => {
    const order: MideaSpecial[] = ["swing_v_toggle", "econo_toggle", "light_toggle", "turbo_toggle", "clean_toggle", "8c_heat_toggle", "quiet_on", "quiet_off"];
    const cppCodes = cpp("mideaSpecials").split("\n");
    order.forEach((name, i) => expect(hex12(MIDEA_SPECIALS[name])).toBe(cppCodes[i]!));
  });

  it("each special code has a valid checksum + round-trips through decode", () => {
    for (const [name, code] of Object.entries(MIDEA_SPECIALS) as [MideaSpecial, bigint][]) {
      expect(mideaValidChecksum(code)).toBe(true);
      const decoded = decodeMidea(sendMidea({ special: name }));
      expect(decoded).toEqual({ special: name });
    }
  });

  it("the vendor decodes each special code's timings to the same value", () => {
    for (const [, code] of Object.entries(MIDEA_SPECIALS) as [MideaSpecial, bigint][]) {
      const out = cpp(`decodeValue ${encodeMideaRaw(code).join(",")}`).split("\n");
      expect(out[0]).toBe("MIDEA");
      expect(BigInt(`0x${out[1]}`)).toBe(code);
    }
  });
});

// --- send() multi-message behaviour (main frame + appended specials) -------

describe("sendMidea appends special messages (mirrors IRMideaAC::send)", () => {
  const FRAME = 200; // entries per single Midea message: 2 phases × (hdr 2 + 96 bits + footer 2)

  function frames(timings: number[]): number[] {
    // Split into per-message 48-bit values by decoding each FRAME-sized chunk.
    const vals: number[] = [];
    for (let off = 0; off + FRAME <= timings.length; off += FRAME) {
      const d = decode(timings.slice(off, off + FRAME));
      vals.push(d ? 1 : 0);
    }
    return vals;
  }

  it("emits only the main frame when no toggles are set", () => {
    const t = sendMidea({ power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto });
    expect(t.length).toBe(FRAME);
  });

  it("appends swing/econo/turbo/light in order", () => {
    const t = sendMidea({ power: true, temp: 24, mode: MideaMode.Cool, fan: MideaFan.Auto, swingVToggle: true, econoToggle: true, turboToggle: true, lightToggle: true });
    // main + 4 specials
    expect(t.length).toBe(FRAME * 5);
    // The appended frames decode to the matching special markers, in order.
    const specials = ["swing_v_toggle", "econo_toggle", "turbo_toggle", "light_toggle"];
    specials.forEach((name, i) => {
      const r = decode(t.slice(FRAME * (i + 1), FRAME * (i + 2)));
      expect((r?.state as MideaState).special).toBe(name);
    });
  });

  it("emits self-clean only in Cool/Dry/Auto, never in Heat/Fan", () => {
    const cool = sendMidea({ mode: MideaMode.Cool, cleanToggle: true });
    expect(cool.length).toBe(FRAME * 2);
    expect((decode(cool.slice(FRAME))?.state as MideaState).special).toBe("clean_toggle");
    const heat = sendMidea({ mode: MideaMode.Heat, cleanToggle: true });
    expect(heat.length).toBe(FRAME); // clean suppressed in Heat
  });

  it("emits 8C-heat only in Heat mode", () => {
    const heat = sendMidea({ mode: MideaMode.Heat, eightCHeatToggle: true });
    expect(heat.length).toBe(FRAME * 2);
    expect((decode(heat.slice(FRAME))?.state as MideaState).special).toBe("8c_heat_toggle");
    const cool = sendMidea({ mode: MideaMode.Cool, eightCHeatToggle: true });
    expect(cool.length).toBe(FRAME); // 8C-heat suppressed outside Heat
  });

  it("emits a quiet on/off message only when quiet changes from quietPrev", () => {
    const on = sendMidea({ mode: MideaMode.Cool, quiet: true });
    expect(on.length).toBe(FRAME * 2);
    expect((decode(on.slice(FRAME))?.state as MideaState).special).toBe("quiet_on");
    const off = sendMidea({ mode: MideaMode.Cool, quiet: false, quietPrev: true });
    expect((decode(off.slice(FRAME))?.state as MideaState).special).toBe("quiet_off");
    const unchanged = sendMidea({ mode: MideaMode.Cool, quiet: true, quietPrev: true });
    expect(unchanged.length).toBe(FRAME); // no quiet message
    void frames;
  });
});

describe("decode() dispatch", () => {
  it("identifies a Midea frame", () => {
    const r = decode(sendMidea(cases[0]!.state));
    expect(r?.protocol).toBe("midea");
    expect(r?.brand).toBe("midea");
    expect(r?.confidence).toBe("checksum_valid");
  });
});

describe("decodeMidea rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeMidea([])).toBeNull();
    expect(decodeMidea([1, 2, 3, 4])).toBeNull();
  });
  it("rejects a non-inverted second phase", () => {
    const timings = sendMidea(cases[0]!.state);
    timings[102 + 5] = timings[102 + 5] === 1680 ? 560 : 1680;
    expect(decodeMidea(timings)).toBeNull();
  });
  it("exposes the bit width", () => {
    expect(MIDEA_BITS).toBe(48);
  });
  it("parseMideaState matches a freshly built value", () => {
    const built = buildMideaRaw(cases[1]!.state);
    expect(mideaValidChecksum(built)).toBe(true);
    expect(hex12(buildMideaRaw(parseMideaState(built)))).toBe(hex12(built));
  });
});
