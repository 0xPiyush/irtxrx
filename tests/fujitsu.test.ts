import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  encodeFujitsuRaw,
  decodeFujitsuRaw,
  buildFujitsuRaw,
  parseFujitsuState,
  sendFujitsu,
  decodeFujitsu,
  validFujitsuFrame,
  FujitsuModel,
  FujitsuMode,
  FujitsuFan,
  FujitsuCmd,
  FujitsuTimer,
  FUJITSU_AC_LENGTHS,
  type FujitsuState,
} from "../src/protocols/fujitsu";
import { decode } from "../src/decode";
import { encode } from "../src/codec";
import { getProtocolInfo } from "../src/capabilities";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() {
  if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` });
}
function cpp(args: string): string {
  return execSync(`${RUNNER} ${args}`, { encoding: "utf-8" }).trim();
}
function timings(o: string): number[] { return o.split(",").map(Number); }
function toHex(a: Uint8Array): string {
  return Array.from(a).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}
function fromHex(h: string): Uint8Array {
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
  return a;
}

beforeAll(() => { ensureRunner(); });

// A spread of states. `args` is the runner's fujitsuAc command line; `state` is
// the equivalent FujitsuState. `cmd` must be a hex string (runner parses it base-16).
// args: model power mode temp fan swing clean filter outsideQuiet cmd [id celsius tenCHeat timerType timerValue]
const M = FujitsuModel, MO = FujitsuMode, FA = FujitsuFan, C = FujitsuCmd, T = FujitsuTimer;
interface Spec { name: string; args: string; state: FujitsuState }
const SPECS: Spec[] = [
  { name: "ARRAH2E cool 24 auto bothSwing", args: "1 1 1 24 0 3 0 0 0 0", state: { model: M.ARRAH2E, power: true, mode: MO.Cool, temp: 24, fan: FA.Auto, swingV: true, swingH: true } },
  { name: "ARRAH2E heat 30 high noSwing", args: "1 1 4 30 1 0 0 0 0 0", state: { model: M.ARRAH2E, power: true, mode: MO.Heat, temp: 30, fan: FA.High, swingV: false, swingH: false } },
  { name: "ARRAH2E dry 18 quiet vert", args: "1 1 2 18 4 1 0 0 0 0", state: { model: M.ARRAH2E, power: true, mode: MO.Dry, temp: 18, fan: FA.Quiet, swingV: true, swingH: false } },
  { name: "ARRAH2E auto 16 low horiz", args: "1 1 0 16 3 2 0 0 0 0", state: { model: M.ARRAH2E, power: true, mode: MO.Auto, temp: 16, fan: FA.Low, swingV: false, swingH: true } },
  { name: "ARREB1E cool 22 med outsideQuiet", args: "3 1 1 22 2 1 0 0 1 0", state: { model: M.ARREB1E, power: true, mode: MO.Cool, temp: 22, fan: FA.Med, swingV: true, swingH: false, outsideQuiet: true } },
  { name: "ARRY4 cool 25 clean+filter", args: "5 1 1 25 0 1 1 1 0 0", state: { model: M.ARRY4, power: true, mode: MO.Cool, temp: 25, fan: FA.Auto, swingV: true, swingH: false, clean: true, filter: true } },
  { name: "ARREW4E heat 26 high", args: "6 1 4 26 1 1 0 0 0 0", state: { model: M.ARREW4E, power: true, mode: MO.Heat, temp: 26, fan: FA.High, swingV: true, swingH: false } },
  { name: "ARREW4E fahrenheit 72", args: "6 1 1 72 2 0 0 0 0 0 0 0", state: { model: M.ARREW4E, power: true, mode: MO.Cool, temp: 72, celsius: false, fan: FA.Med, swingV: false, swingH: false } },
  { name: "ARDB1 long cool 24", args: "2 1 1 24 0 0 0 0 0 0", state: { model: M.ARDB1, power: true, mode: MO.Cool, temp: 24, fan: FA.Auto, swingV: false, swingH: false } },
  { name: "ARJW2 long heat 28 horiz", args: "4 1 4 28 1 2 0 0 0 0", state: { model: M.ARJW2, power: true, mode: MO.Heat, temp: 28, fan: FA.High, swingV: false, swingH: true } },
  { name: "ARRAH2E id 2", args: "1 1 1 24 0 3 0 0 0 0 2", state: { model: M.ARRAH2E, power: true, mode: MO.Cool, temp: 24, fan: FA.Auto, swingV: true, swingH: true, id: 2 } },
  { name: "ARRAH2E 10C heat", args: "1 1 4 16 1 0 0 0 0 0 0 1 1", state: { model: M.ARRAH2E, power: true, mode: MO.Heat, temp: 16, fan: FA.High, swingV: false, swingH: false, tenCHeat: true } },
  { name: "ARRAH2E onTimer 90", args: "1 1 1 24 0 3 0 0 0 0 0 1 0 3 90", state: { model: M.ARRAH2E, power: true, mode: MO.Cool, temp: 24, fan: FA.Auto, swingV: true, swingH: true, timerType: T.On, timerMinutes: 90 } },
  { name: "ARREB1E sleepTimer 120", args: "3 1 1 24 2 1 0 0 0 0 0 1 0 1 120", state: { model: M.ARREB1E, power: true, mode: MO.Cool, temp: 24, fan: FA.Med, swingV: true, swingH: false, timerType: T.Sleep, timerMinutes: 120 } },
  // Short command frames:
  { name: "ARRAH2E turn off", args: "1 0 1 24 0 3 0 0 0 02", state: { model: M.ARRAH2E, power: false, command: C.TurnOff } },
  { name: "ARREB1E econo", args: "3 1 1 24 0 1 0 0 0 09", state: { model: M.ARREB1E, command: C.Econo } },
  { name: "ARREB1E powerful", args: "3 1 1 24 0 1 0 0 0 39", state: { model: M.ARREB1E, command: C.Powerful } },
  { name: "ARRAH2E stepVert", args: "1 1 1 24 0 3 0 0 0 6C", state: { model: M.ARRAH2E, command: C.StepVert } },
  { name: "ARDB1 turn off (6-byte)", args: "2 0 1 24 0 0 0 0 0 02", state: { model: M.ARDB1, command: C.TurnOff } },
];

interface Frame { name: string; hex: string; bytes: Uint8Array; cppTimings: number[]; state: FujitsuState }
let FRAMES: Frame[] = [];
beforeAll(() => {
  FRAMES = SPECS.map(({ name, args, state }) => {
    const hex = cpp(`fujitsuAc ${args}`).split("\n")[0]!;
    return { name, hex, bytes: fromHex(hex), cppTimings: timings(cpp(`sendFujitsuAc ${hex}`)), state };
  });
});

describe("Fujitsu A/C — raw layer", () => {
  it("covers all four frame lengths", () => {
    const lens = new Set(SPECS.map((s) => fromHex(cpp(`fujitsuAc ${s.args}`).split("\n")[0]!).length));
    expect([...lens].sort((a, b) => a - b)).toEqual([6, 7, 15, 16]);
  });

  describe("encodeFujitsuRaw cross-validation vs C++", () => {
    for (let i = 0; i < SPECS.length; i++) {
      it(SPECS[i]!.name, () => {
        const f = FRAMES[i]!;
        expect(encodeFujitsuRaw(f.bytes, 0)).toEqual(f.cppTimings);
      });
    }
  });

  describe("decodeFujitsuRaw roundtrip + C++ decode cross-validation", () => {
    for (let i = 0; i < SPECS.length; i++) {
      it(SPECS[i]!.name, () => {
        const f = FRAMES[i]!;
        // TS encode → TS raw decode.
        expect(toHex(decodeFujitsuRaw(encodeFujitsuRaw(f.bytes))!)).toBe(f.hex);
        // C++ decode of the same timings agrees.
        const cd = cpp(`decode ${f.cppTimings.join(",")}`).split("\n");
        expect(cd[0]).toBe("FUJITSU_AC");
        expect(cd[1]).toBe(f.hex);
        // TS raw decode of C++ timings agrees.
        expect(toHex(decodeFujitsuRaw(f.cppTimings)!)).toBe(f.hex);
      });
    }
  });
});

describe("Fujitsu A/C — semantic layer", () => {
  describe("buildFujitsuRaw cross-validation vs C++ class", () => {
    for (let i = 0; i < SPECS.length; i++) {
      it(SPECS[i]!.name, () => {
        expect(toHex(buildFujitsuRaw(SPECS[i]!.state))).toBe(FRAMES[i]!.hex);
      });
    }
  });

  describe("parse → build roundtrip (state survives a frame)", () => {
    for (let i = 0; i < SPECS.length; i++) {
      it(SPECS[i]!.name, () => {
        const parsed = parseFujitsuState(FRAMES[i]!.bytes);
        expect(parsed).not.toBeNull();
        expect(toHex(buildFujitsuRaw(parsed!))).toBe(FRAMES[i]!.hex);
      });
    }
  });

  it("decodeFujitsu extracts the expected fields (cool/24/auto)", () => {
    const s = decodeFujitsu(sendFujitsu({
      model: M.ARRAH2E, power: true, mode: MO.Cool, temp: 24, fan: FA.Auto, swingV: true, swingH: true,
    }))!;
    expect(s).not.toBeNull();
    expect(s.power).toBe(true);
    expect(s.mode).toBe(MO.Cool);
    expect(s.temp).toBe(24);
    expect(s.fan).toBe(FA.Auto);
    expect(s.swingV).toBe(true);
    expect(s.swingH).toBe(true);
  });

  it("exposes a full temperature sweep that round-trips (ARRAH2E)", () => {
    for (let t = 16; t <= 30; t++) {
      const s = decodeFujitsu(sendFujitsu({ model: M.ARRAH2E, power: true, mode: MO.Cool, temp: t, fan: FA.Auto }))!;
      expect(s.temp).toBe(t);
    }
  });
});

describe("Fujitsu A/C — registry wiring", () => {
  it("decodes via the top-level dispatcher into a FujitsuState", () => {
    const f = FRAMES[0]!;
    const r = decode(f.cppTimings, { protocol: "fujitsu_ac" });
    expect(r).not.toBeNull();
    expect(r!.protocol).toBe("fujitsu_ac");
    const st = (r as { state: FujitsuState }).state;
    expect(st.mode).toBe(MO.Cool);
    expect(st.temp).toBe(24);
  });

  it("encodes via the codec dispatcher", () => {
    const t = encode("fujitsu_ac", { model: M.ARRAH2E, power: true, mode: MO.Heat, temp: 28, fan: FA.High });
    const s = decodeFujitsu(t)!;
    expect(s.mode).toBe(MO.Heat);
    expect(s.temp).toBe(28);
  });

  it("advertises modes/fans/temp/swing in the capability registry", () => {
    const info = getProtocolInfo("fujitsu_ac")!;
    expect(info.brand).toBe("fujitsu");
    expect(info.modes!.map((m) => m.name)).toContain("Cool");
    expect(info.fans!.length).toBe(5);
    expect(info.temp).toEqual({ min: 16, max: 30, step: 1 });
    expect(info.swingV).toBe(true);
    expect(info.swingH).toBe(true);
  });
});

describe("Fujitsu A/C — validation / rejection", () => {
  it("accepts every generated frame", () => {
    for (const f of FRAMES) expect(validFujitsuFrame(f.bytes)).toBe(true);
  });
  it("rejects a wrong header", () => {
    const f = FRAMES[0]!.bytes.slice(); f[0] = 0x15;
    expect(validFujitsuFrame(f)).toBe(false);
  });
  it("rejects a corrupted long-frame checksum", () => {
    const f = FRAMES[0]!.bytes.slice(); f[f.length - 1] ^= 0xff;
    expect(validFujitsuFrame(f)).toBe(false);
  });
  it("rejects a corrupted 7-byte inversion", () => {
    const short = FRAMES.find((x) => x.bytes.length === 7)!.bytes.slice();
    short[6] ^= 0x01;
    expect(validFujitsuFrame(short)).toBe(false);
  });
  it("decode rejects truncated input and noise", () => {
    expect(decodeFujitsu([3324, 1574, 448, 1182])).toBeNull();
    expect(decodeFujitsu(Array.from({ length: 260 }, (_, i) => (i % 2 ? 500 : 9000)))).toBeNull();
  });
  it("knows its valid lengths", () => {
    expect([...FUJITSU_AC_LENGTHS].sort((a, b) => a - b)).toEqual([6, 7, 15, 16]);
  });
});
