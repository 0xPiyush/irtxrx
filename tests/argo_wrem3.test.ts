import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildArgoWrem3Raw, encodeArgoWrem3Raw, sendArgoWrem3, decodeArgoWrem3, argoWrem3ValidChecksum,
  ArgoWrem3Mode, ArgoWrem3Fan, ArgoWrem3Flap, ArgoWrem3TimerType,
} from "../src/protocols/argo_wrem3";
import type { ArgoWrem3State } from "../src/protocols/argo_wrem3";
import { decode } from "../src/decode";

const RUNNER = `${import.meta.dir}/cpp/runner`;
function ensureRunner() { if (!existsSync(RUNNER)) execSync("make", { cwd: `${import.meta.dir}/cpp` }); }
function cpp(a: string): string { return execSync(`${RUNNER} ${a}`, { encoding: "utf-8" }).trim(); }
function t(o: string): number[] { return o.split(",").map(Number); }
function toHex(a: Uint8Array): string { return Array.from(a).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(""); }
beforeAll(() => { ensureRunner(); });

interface C { label: string; state: ArgoWrem3State; cppCmd: string; }
const cases: C[] = [
  { label: "ac cool 24", state: { messageType: "ac_control", power: true, temp: 24, mode: ArgoWrem3Mode.Cool, fan: ArgoWrem3Fan.High, flap: ArgoWrem3Flap.Auto, roomTemp: 25 }, cppCmd: "argo3ac 1 24 1 5 0 25 0 0 0 0 0 0 0" },
  { label: "ac heat all-toggles ch2", state: { messageType: "ac_control", power: true, temp: 22, mode: ArgoWrem3Mode.Heat, fan: ArgoWrem3Fan.Medium, flap: ArgoWrem3Flap.Pos3, roomTemp: 24, night: true, eco: true, max: true, filter: true, light: true, iFeel: true, channel: 2 }, cppCmd: "argo3ac 1 22 3 4 3 24 1 1 1 1 1 1 2" },
  { label: "ac auto fan-lower", state: { messageType: "ac_control", power: true, temp: 30, mode: ArgoWrem3Mode.Auto, fan: ArgoWrem3Fan.Lower, flap: ArgoWrem3Flap.Full, roomTemp: 20 }, cppCmd: "argo3ac 1 30 5 2 7 20 0 0 0 0 0 0 0" },
  { label: "ac off dry", state: { messageType: "ac_control", power: false, temp: 18, mode: ArgoWrem3Mode.Dry, fan: ArgoWrem3Fan.Lowest, flap: ArgoWrem3Flap.Pos1, roomTemp: 24 }, cppCmd: "argo3ac 0 18 2 1 1 24 0 0 0 0 0 0 0" },
  { label: "ifeel 22", state: { messageType: "ifeel", sensorTemp: 22 }, cppCmd: "argo3ifeel 22 0" },
  { label: "ifeel 30 ch1", state: { messageType: "ifeel", sensorTemp: 30, channel: 1 }, cppCmd: "argo3ifeel 30 1" },
  { label: "config 5/200", state: { messageType: "config", configKey: 5, configValue: 200, channel: 1 }, cppCmd: "argo3config 5 200 1" },
  { label: "config 0/0", state: { messageType: "config", configKey: 0, configValue: 0 }, cppCmd: "argo3config 0 0 0" },
  { label: "timer delay", state: { messageType: "timer", timerOn: true, timerType: ArgoWrem3TimerType.Delay, currentTime: 810, currentDay: 3, delayMinutes: 120 }, cppCmd: "argo3timer 1 1 810 3 120 0 0 0 0" },
  { label: "timer schedule", state: { messageType: "timer", timerOn: true, timerType: ArgoWrem3TimerType.Schedule1, currentTime: 600, currentDay: 1, scheduleStart: 480, scheduleStop: 1320, activeDays: 0b0111110 }, cppCmd: "argo3timer 1 2 600 1 0 480 1320 62 0" },
];

describe("Argo WREM3 build + encode cross-validation", () => {
  for (const tc of cases) {
    it(`raw matches C++ for ${tc.label}`, () => {
      const lines = cpp(tc.cppCmd).split("\n");
      expect(toHex(buildArgoWrem3Raw(tc.state))).toBe(lines[0]!);
      expect(encodeArgoWrem3Raw(buildArgoWrem3Raw(tc.state), 0)).toEqual(t(lines[1]!));
    });
  }
  it("matches C++ timings with repeat", () => {
    const raw = buildArgoWrem3Raw(cases[0]!.state);
    expect(encodeArgoWrem3Raw(raw, 1)).toEqual(t(cpp(`sendArgoWREM3 ${toHex(raw)} 6 1`)));
  });
});

describe("Argo WREM3 decode", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildArgoWrem3Raw(tc.state);
      const d = decodeArgoWrem3(sendArgoWrem3(tc.state));
      expect(d).not.toBeNull();
      expect(toHex(buildArgoWrem3Raw(d!))).toBe(toHex(raw));
    });
    it(`C++ decode agrees for ${tc.label}`, () => {
      const out = cpp(`decode ${encodeArgoWrem3Raw(buildArgoWrem3Raw(tc.state)).join(",")}`).split("\n");
      expect(out[0]).toBe("ARGO");
      expect(out[1]).toBe(toHex(buildArgoWrem3Raw(tc.state)));
    });
  }
  it("dispatch picks each message type + rejection", () => {
    expect(decode(sendArgoWrem3(cases[0]!.state))?.protocol).toBe("argo_wrem3");
    expect((decode(sendArgoWrem3(cases[4]!.state))?.state as ArgoWrem3State).messageType).toBe("ifeel");
    expect((decode(sendArgoWrem3(cases[6]!.state))?.state as ArgoWrem3State).messageType).toBe("config");
    expect((decode(sendArgoWrem3(cases[8]!.state))?.state as ArgoWrem3State).messageType).toBe("timer");
    expect(decodeArgoWrem3([])).toBeNull();
    const bad = buildArgoWrem3Raw(cases[0]!.state); bad[2] ^= 0x01;
    expect(decodeArgoWrem3(encodeArgoWrem3Raw(bad))).toBeNull();
    expect(argoWrem3ValidChecksum(buildArgoWrem3Raw(cases[8]!.state))).toBe(true);
  });
});
