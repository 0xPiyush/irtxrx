import { describe, expect, it, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import {
  buildElectraAcRaw,
  encodeElectraAcRaw,
  sendElectraAc,
  decodeElectraAc,
  electraAcValidChecksum,
  ElectraAcMode,
  ElectraAcFan,
} from "../src/protocols/electra_ac";
import type { ElectraAcState } from "../src/protocols/electra_ac";
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
  state: ElectraAcState;
  // power temp mode fan swingV swingH clean lightToggle turbo quiet iFeel sensorUpdate sensorTemp
  cppArgs: string;
}

const cases: TestCase[] = [
  { label: "cool 24 auto", state: { power: true, temp: 24, mode: ElectraAcMode.Cool, fan: ElectraAcFan.Auto }, cppArgs: "1 24 1 5 0 0 0 0 0 0 0 0 0" },
  { label: "auto 25", state: { power: true, temp: 25, mode: ElectraAcMode.Auto, fan: ElectraAcFan.Auto }, cppArgs: "1 25 0 5 0 0 0 0 0 0 0 0 0" },
  { label: "heat 32 high", state: { power: true, temp: 32, mode: ElectraAcMode.Heat, fan: ElectraAcFan.High }, cppArgs: "1 32 4 1 0 0 0 0 0 0 0 0 0" },
  { label: "dry 16 low", state: { power: true, temp: 16, mode: ElectraAcMode.Dry, fan: ElectraAcFan.Low }, cppArgs: "1 16 2 3 0 0 0 0 0 0 0 0 0" },
  { label: "fan mode med", state: { power: true, temp: 22, mode: ElectraAcMode.Fan, fan: ElectraAcFan.Med }, cppArgs: "1 22 6 2 0 0 0 0 0 0 0 0 0" },
  { label: "cool swingV", state: { power: true, temp: 23, mode: ElectraAcMode.Cool, fan: ElectraAcFan.Auto, swingV: true }, cppArgs: "1 23 1 5 1 0 0 0 0 0 0 0 0" },
  { label: "cool swingH", state: { power: true, temp: 23, mode: ElectraAcMode.Cool, fan: ElectraAcFan.High, swingH: true }, cppArgs: "1 23 1 1 0 1 0 0 0 0 0 0 0" },
  { label: "cool swing both", state: { power: true, temp: 21, mode: ElectraAcMode.Cool, fan: ElectraAcFan.Auto, swingV: true, swingH: true }, cppArgs: "1 21 1 5 1 1 0 0 0 0 0 0 0" },
  { label: "turbo", state: { power: true, temp: 20, mode: ElectraAcMode.Cool, fan: ElectraAcFan.High, turbo: true }, cppArgs: "1 20 1 1 0 0 0 0 1 0 0 0 0" },
  { label: "quiet", state: { power: true, temp: 26, mode: ElectraAcMode.Cool, fan: ElectraAcFan.Low, quiet: true }, cppArgs: "1 26 1 3 0 0 0 0 0 1 0 0 0" },
  { label: "clean", state: { power: true, temp: 24, mode: ElectraAcMode.Cool, fan: ElectraAcFan.Auto, clean: true }, cppArgs: "1 24 1 5 0 0 1 0 0 0 0 0 0" },
  { label: "light toggle", state: { power: true, temp: 24, mode: ElectraAcMode.Cool, fan: ElectraAcFan.Auto, lightToggle: true }, cppArgs: "1 24 1 5 0 0 0 1 0 0 0 0 0" },
  { label: "off", state: { power: false, temp: 27, mode: ElectraAcMode.Heat, fan: ElectraAcFan.Auto }, cppArgs: "0 27 4 5 0 0 0 0 0 0 0 0 0" },
  { label: "iFeel sensor 25C", state: { power: true, temp: 24, mode: ElectraAcMode.Cool, fan: ElectraAcFan.Auto, iFeel: true, sensorTemp: 25 }, cppArgs: "1 24 1 5 0 0 0 0 0 0 1 0 25" },
  { label: "iFeel sensor 0C", state: { power: true, temp: 24, mode: ElectraAcMode.Cool, fan: ElectraAcFan.Auto, iFeel: true, sensorTemp: 0 }, cppArgs: "1 24 1 5 0 0 0 0 0 0 1 0 0" },
  { label: "sensor update 30C", state: { power: true, temp: 24, mode: ElectraAcMode.Cool, fan: ElectraAcFan.Auto, sensorUpdate: true, sensorTemp: 30 }, cppArgs: "1 24 1 5 0 0 0 0 0 0 0 1 30" },
];

describe("buildElectraAcRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ raw for ${tc.label}`, () => {
      expect(toHex(buildElectraAcRaw(tc.state))).toBe(cpp(`electraAc ${tc.cppArgs}`).split("\n")[0]!);
    });
  }
});

describe("encodeElectraAcRaw cross-validation", () => {
  for (const tc of cases) {
    it(`matches C++ timings for ${tc.label}`, () => {
      const lines = cpp(`electraAc ${tc.cppArgs}`).split("\n");
      expect(encodeElectraAcRaw(buildElectraAcRaw(tc.state), 0)).toEqual(parseCppTimings(lines[1]!));
    });
  }

  it("matches C++ timings with repeat", () => {
    const raw = buildElectraAcRaw(cases[0]!.state);
    expect(encodeElectraAcRaw(raw, 1)).toEqual(parseCppTimings(cpp(`sendElectraAC ${toHex(raw)} 1`)));
  });
});

describe("decodeElectraAc roundtrip", () => {
  for (const tc of cases) {
    it(`roundtrips ${tc.label}`, () => {
      const raw = buildElectraAcRaw(tc.state);
      const decoded = decodeElectraAc(sendElectraAc(tc.state));
      expect(decoded).not.toBeNull();
      expect(toHex(buildElectraAcRaw(decoded!))).toBe(toHex(raw));
    });
  }

  it("decodes without a header", () => {
    const state = cases[0]!.state;
    const decoded = decodeElectraAc(sendElectraAc(state).slice(2), 0, true);
    expect(decoded).not.toBeNull();
    expect(toHex(buildElectraAcRaw(decoded!))).toBe(toHex(buildElectraAcRaw(state)));
  });

  it("reads the expected fields", () => {
    const s = decodeElectraAc(sendElectraAc(cases[13]!.state))!;
    expect(s).toMatchObject({ power: true, mode: ElectraAcMode.Cool, temp: 24, iFeel: true, sensorTemp: 25 });
  });
});

describe("decodeElectraAc C++ cross-validation", () => {
  for (const tc of cases) {
    it(`C++ decode agrees for ${tc.label}`, () => {
      const raw = buildElectraAcRaw(tc.state);
      const out = cpp(`decode ${encodeElectraAcRaw(raw).join(",")}`).split("\n");
      expect(out[0]).toBe("ELECTRA_AC");
      expect(out[1]).toBe(toHex(raw));
    });
  }
});

describe("decode() dispatch", () => {
  it("identifies an Electra frame", () => {
    const r = decode(sendElectraAc(cases[0]!.state));
    expect(r?.protocol).toBe("electra_ac");
    expect(r?.brand).toBe("electra");
    expect(r?.confidence).toBe("checksum_valid");
  });
});

describe("decodeElectraAc rejection", () => {
  it("rejects empty/garbage", () => {
    expect(decodeElectraAc([])).toBeNull();
    expect(decodeElectraAc([1, 2, 3, 4])).toBeNull();
  });
  it("rejects a corrupted checksum", () => {
    const raw = buildElectraAcRaw(cases[0]!.state);
    raw[1] = (raw[1]! ^ 0xff) & 0xff; // corrupt temp/swing without fixing the sum
    expect(decodeElectraAc(encodeElectraAcRaw(raw, 0))).toBeNull();
  });
  it("validChecksum agrees with a freshly built state", () => {
    expect(electraAcValidChecksum(buildElectraAcRaw(cases[2]!.state))).toBe(true);
  });
});
