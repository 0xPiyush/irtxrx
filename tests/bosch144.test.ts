import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildBosch144Raw,
  encodeBosch144Raw,
  sendBosch144,
  decodeBosch144,
  decodeBosch144Raw,
  isValidBosch144,
  Bosch144Mode,
  Bosch144Fan,
  BOSCH144_OFF,
  BOSCH144_STATE_LENGTH,
} from "../src/protocols/bosch144";
import type { Bosch144State } from "../src/protocols/bosch144";
import { decode } from "../src/decode";
import { decodeCoolixRaw, sendCoolix, encodeCoolixRaw, CoolixMode, CoolixFan } from "../src/protocols/coolix";

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
  state: Bosch144State;
  /** runner bosch144 <power> <temp> <fahrenheit> <mode> <fan> <quiet>; fan -1 = unset */
  cppArgs: string;
}

const cases: TestCase[] = [
  { label: "default (auto 25°C, fan unset → Auto0)", state: {}, cppArgs: "1 25 0 5 -1 0" },
  { label: "cool 24°C fan 60%", state: { power: true, mode: Bosch144Mode.Cool, temp: 24, fan: Bosch144Fan.Fan60 }, cppArgs: "1 24 0 0 158 0" },
  { label: "heat 16°C fan 20%", state: { mode: Bosch144Mode.Heat, temp: 16, fan: Bosch144Fan.Fan20 }, cppArgs: "1 16 0 6 458 0" },
  { label: "heat 30°C fan 100%", state: { mode: Bosch144Mode.Heat, temp: 30, fan: Bosch144Fan.Fan100 }, cppArgs: "1 30 0 6 114 0" },
  { label: "dry 22°C, fan unset → Auto0", state: { mode: Bosch144Mode.Dry, temp: 22 }, cppArgs: "1 22 0 3 -1 0" },
  { label: "dry 22°C, explicit fan 40% overrides Auto0", state: { mode: Bosch144Mode.Dry, temp: 22, fan: Bosch144Fan.Fan40 }, cppArgs: "1 22 0 3 276 0" },
  { label: "fan-only mode, fan 80%", state: { mode: Bosch144Mode.Fan, temp: 25, fan: Bosch144Fan.Fan80 }, cppArgs: "1 25 0 2 104 0" },
  { label: "cool 19°C fan auto", state: { mode: Bosch144Mode.Cool, temp: 19, fan: Bosch144Fan.Auto }, cppArgs: "1 19 0 0 371 0" },
  { label: "cool 27°C quiet, fan unset → Auto", state: { mode: Bosch144Mode.Cool, temp: 27, quiet: true }, cppArgs: "1 27 0 0 -1 1" },
  { label: "cool 27°C quiet with explicit fan 60%", state: { mode: Bosch144Mode.Cool, temp: 27, quiet: true, fan: Bosch144Fan.Fan60 }, cppArgs: "1 27 0 0 158 1" },
  { label: "cool 72°F fan 60%", state: { mode: Bosch144Mode.Cool, temp: 72, fahrenheit: true, fan: Bosch144Fan.Fan60 }, cppArgs: "1 72 1 0 158 0" },
  { label: "heat 61°F (half-degree bit) fan 20%", state: { mode: Bosch144Mode.Heat, temp: 61, fahrenheit: true, fan: Bosch144Fan.Fan20 }, cppArgs: "1 61 1 6 458 0" },
  { label: "auto 86°F quiet", state: { mode: Bosch144Mode.Auto, temp: 86, fahrenheit: true, quiet: true }, cppArgs: "1 86 1 5 -1 1" },
  { label: "auto 60°F fan 100%", state: { mode: Bosch144Mode.Auto, temp: 60, fahrenheit: true, fan: Bosch144Fan.Fan100 }, cppArgs: "1 60 1 5 114 0" },
];

// ---------------------------------------------------------------------------

describe("Bosch144 raw send cross-validation", () => {
  it("matches C++ for the default state bytes (repeat 0 and 1)", () => {
    const raw = buildBosch144Raw({});
    expect(encodeBosch144Raw(raw, 0)).toEqual(parseCppTimings(cpp(`sendBosch144 ${toHex(raw)}`)));
    expect(encodeBosch144Raw(raw, 1)).toEqual(parseCppTimings(cpp(`sendBosch144 ${toHex(raw)} 1`)));
  });

  it("matches C++ for the 96-bit Off message", () => {
    expect(encodeBosch144Raw(BOSCH144_OFF, 0)).toEqual(parseCppTimings(cpp(`sendBosch144 ${toHex(BOSCH144_OFF)}`)));
    expect(encodeBosch144Raw(BOSCH144_OFF, 2)).toEqual(parseCppTimings(cpp(`sendBosch144 ${toHex(BOSCH144_OFF)} 2`)));
  });

  it("matches C++ for arbitrary 18-byte payloads", () => {
    const samples = [
      Uint8Array.from(Array.from({ length: 18 }, (_, i) => (i * 37 + 11) & 0xff)),
      Uint8Array.from(Array.from({ length: 18 }, (_, i) => (0x5a ^ (i * 3)) & 0xff)),
    ];
    for (const s of samples) {
      expect(encodeBosch144Raw(s, 0)).toEqual(parseCppTimings(cpp(`sendBosch144 ${toHex(s)}`)));
    }
  });

  it("emits 3 sections of header + 48 bits + footer, then a 100ms gap", () => {
    const t = encodeBosch144Raw(buildBosch144Raw({}), 0);
    // 3 × (2 header + 96 data + 1 footer mark + 1 footer space) = 300
    expect(t.length).toBe(300);
    expect(t[0]).toBe(4366);
    expect(t[1]).toBe(4415);
    expect(t[99]).toBe(5235);              // section 1 footer space
    expect(t[100]).toBe(4366);             // section 2 header
    expect(t[299]).toBe(5235 + 100000);    // final footer space + message gap
  });

  it("rejects a payload that is not a multiple of 6 bytes", () => {
    expect(() => encodeBosch144Raw(new Uint8Array(7))).toThrow(RangeError);
    expect(() => encodeBosch144Raw(new Uint8Array(0))).toThrow(RangeError);
  });
});

describe("Bosch144 state cross-validation (IRBosch144AC setters)", () => {
  for (const tc of cases) {
    it(`matches C++ bytes + timings for ${tc.label}`, () => {
      const lines = cpp(`bosch144 ${tc.cppArgs}`).split("\n");
      expect(toHex(buildBosch144Raw(tc.state))).toBe(lines[0]!);
      expect(sendBosch144(tc.state)).toEqual(parseCppTimings(lines[1]!));
    });
  }

  it("power off sends the Coolix-style 96-bit Off frame, as C++ does", () => {
    const lines = cpp("bosch144 0 24 0 0 158 0").split("\n");
    const ours = sendBosch144({ power: false, mode: Bosch144Mode.Cool, temp: 24, fan: Bosch144Fan.Fan60 });
    expect(ours).toEqual(parseCppTimings(lines[1]!));
    expect(ours).toEqual(encodeBosch144Raw(BOSCH144_OFF));
    // 2 × (2 + 96 + 2) = 200 timings
    expect(ours.length).toBe(200);
  });

  it("clamps the temperature to the table range in both units", () => {
    expect(toHex(buildBosch144Raw({ temp: 5 }))).toBe(toHex(buildBosch144Raw({ temp: 16 })));
    expect(toHex(buildBosch144Raw({ temp: 99 }))).toBe(toHex(buildBosch144Raw({ temp: 30 })));
    expect(toHex(buildBosch144Raw({ temp: 40, fahrenheit: true }))).toBe(toHex(buildBosch144Raw({ temp: 60, fahrenheit: true })));
    expect(toHex(buildBosch144Raw({ temp: 120, fahrenheit: true }))).toBe(toHex(buildBosch144Raw({ temp: 86, fahrenheit: true })));
    // Cross-check the clamp against the C++ setTemp() constraint.
    expect(toHex(buildBosch144Raw({ temp: 5, mode: Bosch144Mode.Cool, fan: Bosch144Fan.Fan60 })))
      .toBe(cpp("bosch144 1 5 0 0 158 0").split("\n")[0]!);
  });

  it("matches the upstream default state image except for the Auto0 fan setMode() forces", () => {
    // kBosch144DefaultState is On / 25°C / Auto with FanS3 = 0b110010 (not a
    // table value). Both here and upstream, applying mode Auto forces Auto0
    // (0b110011), so only byte 13 (and the checksum) differ from the raw image.
    const ours = toHex(buildBosch144Raw({}));
    const image = "B24D1FE0C837B24D1FE0C837D5650000003A";
    expect(ours.slice(0, 26)).toBe(image.slice(0, 26));
    expect(ours.slice(28, 34)).toBe(image.slice(28, 34));
    expect(ours.slice(26, 28)).toBe("67");
  });
});

describe("Bosch144 decode roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const decoded = decodeBosch144(sendBosch144(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildBosch144Raw(decoded!))).toBe(toHex(buildBosch144Raw(tc.state)));
      // Decoding the re-encoded state is a fixed point.
      expect(decodeBosch144(sendBosch144(decoded!))).toEqual(decoded);
    });
  }

  it("decodes every field of a fully-specified state", () => {
    const state: Bosch144State = {
      power: true, mode: Bosch144Mode.Heat, fan: Bosch144Fan.Fan80, temp: 79, fahrenheit: true, quiet: true,
    };
    expect(decodeBosch144(sendBosch144(state))).toEqual(state);
  });

  it("decodes the whole °C and °F temperature sweeps", () => {
    for (let t = 16; t <= 30; t++) {
      expect(decodeBosch144(sendBosch144({ temp: t }))!.temp, `${t}°C`).toBe(t);
    }
    for (let t = 60; t <= 86; t++) {
      const st = decodeBosch144(sendBosch144({ temp: t, fahrenheit: true }))!;
      expect(st.temp, `${t}°F`).toBe(t);
      expect(st.fahrenheit).toBe(true);
    }
  });

  it("decodes every mode and fan constant", () => {
    for (const mode of Object.values(Bosch144Mode)) {
      expect(decodeBosch144(sendBosch144({ mode }))!.mode).toBe(mode);
    }
    for (const fan of Object.values(Bosch144Fan)) {
      expect(decodeBosch144(sendBosch144({ fan }))!.fan).toBe(fan);
    }
  });

  it("decodes with the first section's header missing (headerOptional)", () => {
    const t = sendBosch144(cases[1]!.state);
    expect(decodeBosch144(t.slice(2), 0, false)).toBeNull();
    expect(toHex(buildBosch144Raw(decodeBosch144(t.slice(2), 0, true)!))).toBe(toHex(buildBosch144Raw(cases[1]!.state)));
  });

  it("decodes a frame without the trailing message gap", () => {
    const t = sendBosch144(cases[1]!.state);
    expect(decodeBosch144(t.slice(0, -1))).not.toBeNull();
  });

  it("decodes the second repeat at an offset", () => {
    const t = sendBosch144(cases[2]!.state, 1);
    expect(decodeBosch144(t, 300)).toEqual(decodeBosch144(t, 0));
  });

  it("falls back to 25°C / 77°F for a temperature code not in the table", () => {
    const raw = buildBosch144Raw({ mode: Bosch144Mode.Cool, fan: Bosch144Fan.Fan60 });
    // 0b111111 is not a valid code in either table. Set all four temp bits.
    raw[4] = (raw[4]! & 0x0f) | 0xf0; raw[5] = ~raw[4]! & 0xff;
    raw[10] = raw[4]!; raw[11] = raw[5]!;
    raw[14] = raw[14]! | 0x20; raw[15] = raw[15]! | 0x10;   // TempS4, TempS3
    raw[17] = raw.subarray(12, 17).reduce((a, b) => a + b, 0) & 0xff;
    expect(decodeBosch144(encodeBosch144Raw(raw))!.temp).toBe(25);
    raw[15] = raw[15]! | 0x01;                                // UseFahrenheit
    raw[17] = raw.subarray(12, 17).reduce((a, b) => a + b, 0) & 0xff;
    expect(decodeBosch144(encodeBosch144Raw(raw))!.temp).toBe(77);
  });
});

// Feed OUR timings to the vendored C++ decoder and confirm it identifies
// BOSCH144 with the identical 18 bytes.
describe("Bosch144 C++ decode cross-validation", () => {
  for (const tc of cases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildBosch144Raw(tc.state);
      const out = cpp(`decode ${encodeBosch144Raw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("BOSCH144");
      expect(out[1]).toBe(toHex(raw));
    });
  }
});

describe("Bosch144 decode() dispatch vs Coolix", () => {
  it("identifies a Bosch144 frame (before Coolix claims sections 1-2)", () => {
    const r = decode(sendBosch144(cases[1]!.state));
    expect(r).not.toBeNull();
    expect(r!.protocol).toBe("bosch144");
    expect(r!.brand).toBe("bosch");
    expect((r as any).state.temp).toBe(24);
  });

  it("identifies a headerless Bosch144 capture via the header-optional tier", () => {
    const r = decode(sendBosch144(cases[2]!.state).slice(2));
    expect(r?.protocol).toBe("bosch144");
  });

  it("honours brand / protocol hints", () => {
    const t = sendBosch144(cases[3]!.state);
    expect(decode(t, { brand: "bosch" })?.protocol).toBe("bosch144");
    expect(decode(t, { protocol: "bosch144" })?.protocol).toBe("bosch144");
    // A Coolix-only search sees the first section as a Coolix frame — this
    // is the inherent overlap that dictates the registry order.
    expect(decode(t, { brand: "coolix" })?.protocol).toBe("coolix");
  });

  it("leaves genuine Coolix frames to the Coolix decoder", () => {
    const coolix = sendCoolix({ power: true, mode: CoolixMode.Cool, temp: 24, fan: CoolixFan.Auto });
    expect(decodeBosch144(coolix)).toBeNull();
    expect(decode(coolix)?.protocol).toBe("coolix");
    // Even a Coolix command repeated 3 times (three 48-bit sections) is not
    // Bosch144: section 3 lacks the 0xD5 signature and checksum.
    const tripled = encodeCoolixRaw(0xb27be0, 2);
    expect(decodeBosch144(tripled)).toBeNull();
    expect(decode(tripled)?.protocol).toBe("coolix");
  });

  it("reports the Bosch144 Off frame as the identical Coolix Off command", () => {
    const off = sendBosch144({ power: false });
    expect(decodeBosch144(off)).toBeNull();
    const r = decode(off);
    expect(r?.protocol).toBe("coolix");
    expect(decodeCoolixRaw(off)!.data).toBe(0xb27be0);
  });
});

describe("Bosch144 rejection", () => {
  it("rejects a corrupted section-3 checksum", () => {
    const raw = buildBosch144Raw(cases[1]!.state);
    raw[BOSCH144_STATE_LENGTH - 1] = (raw[BOSCH144_STATE_LENGTH - 1]! ^ 0xff) & 0xff;
    expect(isValidBosch144(raw)).toBe(false);
    expect(decodeBosch144(encodeBosch144Raw(raw))).toBeNull();
    // The raw section matcher itself still succeeds — it is the validation
    // that rejects.
    expect(decodeBosch144Raw(encodeBosch144Raw(raw))).not.toBeNull();
  });

  it("rejects a broken inverse byte pair", () => {
    const raw = buildBosch144Raw(cases[1]!.state);
    raw[3] = raw[3]! ^ 0x01;
    expect(decodeBosch144(encodeBosch144Raw(raw))).toBeNull();
  });

  it("rejects wrong section signatures", () => {
    for (const idx of [0, 6, 12]) {
      const raw = buildBosch144Raw(cases[1]!.state);
      raw[idx] = 0x99;
      if (idx < 12) raw[idx + 1] = ~raw[idx]! & 0xff;
      raw[17] = raw.subarray(12, 17).reduce((a, b) => a + b, 0) & 0xff;
      expect(decodeBosch144(encodeBosch144Raw(raw)), `byte ${idx}`).toBeNull();
    }
  });

  it("rejects a truncated frame (two sections only)", () => {
    const t = sendBosch144(cases[1]!.state);
    expect(decodeBosch144(t.slice(0, 200))).toBeNull();
  });

  it("rejects noise", () => {
    expect(decodeBosch144([])).toBeNull();
    expect(decodeBosch144([1, 2, 3])).toBeNull();
    expect(decodeBosch144(new Array(400).fill(456))).toBeNull();
  });
});
