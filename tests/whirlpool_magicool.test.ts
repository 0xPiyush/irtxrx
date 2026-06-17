import { describe, it, expect } from "bun:test";
import {
  buildWhirlpoolMagicoolRaw, encodeWhirlpoolMagicoolRaw, sendWhirlpoolMagicool,
  decodeWhirlpoolMagicool, whirlpoolMagicoolValidChecksum,
  WhirlpoolMagicoolMode as M, WhirlpoolMagicoolFan as F, WhirlpoolMagicoolSwing as S,
  type WhirlpoolMagicoolState,
} from "../src/protocols/whirlpool_magicool.js";
import { decode } from "../src/decode.js";

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// Whirlpool Magicool is NOT in IRremoteESP8266 (RE'd from real remote captures),
// so there is no C++ runner to cross-validate against — we validate against the
// real captures (appliance ec8089b9…) and via lossless round-trips.

describe("whirlpool_magicool encode (known-good bytes, nonce 0)", () => {
  // bytes 0..12 extracted from real captures; checksum recomputed by build.
  const cases: { label: string; state: WhirlpoolMagicoolState; bytes0to12: string }[] = [
    { label: "25C Cool Auto full-swing on", state: { temp: 25, mode: M.Cool, fan: F.Auto, swing: S.Full, power: true }, bytes0to12: "574c500000242306380000 0c00".replace(/\s/g, "") },
    { label: "28C", state: { temp: 28, mode: M.Cool, fan: F.Auto, swing: S.Full, power: true }, bytes0to12: "574c5000002423033800000c00" },
    { label: "Dry forces Low fan", state: { temp: 25, mode: M.Dry, fan: F.Low, swing: S.Full, power: true }, bytes0to12: "574c5000002422063a00000c00" },
    { label: "Fan-mode Med", state: { temp: 25, mode: M.Fan, fan: F.Med, swing: S.Full, power: true }, bytes0to12: "574c5000002427063b00000c00" },
    { label: "High fan", state: { temp: 25, mode: M.Cool, fan: F.High, swing: S.Full, power: true }, bytes0to12: "574c5000002423063d00000c00" },
    { label: "swing off", state: { temp: 25, mode: M.Cool, fan: F.High, swing: S.Off, power: true }, bytes0to12: "574c50000024230 60500000c00".replace(/\s/g, "") },
    { label: "power off", state: { temp: 25, mode: M.Cool, fan: F.High, swing: S.Full, power: false }, bytes0to12: "574c5000002023063d00000c00" },
  ];
  for (const c of cases) {
    it(c.label, () => {
      const raw = buildWhirlpoolMagicoolRaw(c.state);
      expect(toHex(raw).slice(0, 26)).toBe(c.bytes0to12); // bytes 0..12
      expect(whirlpoolMagicoolValidChecksum(raw)).toBe(true);
    });
  }
});

describe("whirlpool_magicool decode (real captures)", () => {
  const caps: { label: string; exp: Partial<WhirlpoolMagicoolState>; e: number[] }[] = [
    { label: "fan High", exp: { mode: M.Cool, temp: 25, fan: F.High, swing: S.Full, power: true }, e: [3326,1342,579,1068,579,1068,610,1068,579,335,549,1068,579,335,549,1068,579,335,549,335,549,305,579,1068,579,1068,579,335,549,335,549,1068,610,305,549,335,549,335,549,305,579,305,579,1068,579,305,579,1068,579,335,549,305,579,305,579,305,549,335,549,335,549,335,549,305,579,305,579,305,579,305,549,335,549,335,549,305,579,305,579,305,579,305,549,335,549,335,549,1068,579,335,549,335,549,1068,579,335,549,335,549,1068,579,1068,610,305,549,335,549,305,579,1068,579,335,549,305,579,305,579,1068,579,1068,579,335,549,305,579,305,579,305,579,305,549,1068,610,305,579,1037,610,1068,579,1068,579,1068,610,305,549,335,549,335,549,335,549,305,579,305,549,335,549,335,549,335,549,305,579,305,579,305,549,335,549,335,549,335,549,305,579,305,579,305,549,335,549,335,549,1068,579,1068,610,305,549,335,549,335,549,335,549,1068,579,1068,579,1068,610,305,579,1068,579,305,579,305,549,335,549,335,549,305,579,305,579,305,579,305,549,1068,610,305,579,1037,610,0,0,0,0,0,0,0] },
    { label: "swing Step3", exp: { mode: M.Cool, temp: 25, fan: F.High, swing: S.Pos3, power: true }, e: [3326,1342,579,1068,579,1098,579,1068,579,305,579,1068,579,305,579,1068,579,305,579,305,579,305,579,1068,579,1068,579,305,579,305,579,1068,579,305,579,305,579,305,579,274,579,305,579,1098,579,274,610,1068,579,274,610,274,610,274,579,305,579,305,579,305,579,274,610,274,610,274,579,305,579,305,579,305,579,305,579,274,610,274,579,305,579,305,579,305,579,305,579,1068,579,305,579,274,610,1068,579,305,579,274,610,1068,579,1068,579,305,579,305,579,274,610,1068,579,274,610,274,610,274,579,1068,610,1068,579,274,610,274,610,274,579,305,579,305,579,1068,579,305,579,1068,579,1068,610,1068,579,305,579,274,610,274,579,305,579,305,579,305,579,305,579,274,610,274,579,305,579,305,579,305,579,274,610,274,610,274,579,305,579,305,579,305,579,274,610,274,610,274,579,1068,610,1068,579,274,610,274,610,274,579,305,579,1068,579,1068,610,274,610,1037,610,1068,579,305,579,274,610,274,579,305,579,305,579,1068,579,305,579,305,579,305,579,274,610,1068,579,0,0,0,0,0,0,0] },
    { label: "power off", exp: { mode: M.Cool, temp: 25, fan: F.High, swing: S.Full, power: false }, e: [3326,1373,549,1098,579,1098,549,1068,640,305,518,1068,640,274,549,1068,640,305,549,305,549,335,549,1068,579,1068,640,305,549,305,549,1098,579,305,579,305,549,335,549,335,549,335,549,1068,579,335,549,1068,579,335,549,335,549,305,579,305,579,305,579,305,549,335,549,335,549,335,549,305,579,305,579,305,549,335,549,335,549,335,549,305,579,305,579,305,549,335,549,335,549,305,579,305,579,1068,579,305,579,305,579,1068,579,1068,640,274,549,305,579,305,579,1068,579,305,579,305,579,305,549,1068,610,1068,579,305,579,305,579,305,579,305,549,335,549,1068,579,335,549,1068,579,1098,579,1068,579,1068,579,335,549,335,549,305,579,305,579,305,549,335,549,335,549,305,579,305,579,305,579,305,549,335,549,335,549,305,579,305,579,305,549,335,549,335,549,335,549,305,579,1068,579,1068,579,335,549,335,549,305,579,305,579,1068,549,1098,579,305,579,305,579,305,579,1037,610,305,579,305,549,335,549,335,549,305,579,1068,579,335,549,1068,579,335,549,1068,579,0,0,0,0,0,0,0] },
  ];
  for (const c of caps) {
    it(c.label, () => {
      const t = c.e.filter((x) => x > 0);
      expect(t.length).toBe(227); // 2 header + 112×2 bits + 1 trailer mark — guards against transcription slips
      const d = decodeWhirlpoolMagicool(t);
      expect(d).not.toBeNull();
      expect(d).toMatchObject(c.exp);
    });
  }
});

describe("whirlpool_magicool round-trip", () => {
  it("is lossless across the full state matrix", () => {
    for (const mode of Object.values(M))
      for (const fan of Object.values(F))
        for (const swing of Object.values(S))
          for (const temp of [16, 20, 25, 30])
            for (const power of [true, false])
              for (const remoteState of [0, 0x0f, 0x17]) {
                const s: WhirlpoolMagicoolState = { mode, fan, swing, temp, power, remoteState };
                const d = decodeWhirlpoolMagicool(sendWhirlpoolMagicool(s));
                expect(d).toEqual(s);
              }
  });

  it("decodes without a header", () => {
    const full = sendWhirlpoolMagicool({ mode: M.Cool, temp: 22, fan: F.Med, swing: S.Pos2 });
    const d = decodeWhirlpoolMagicool(full.slice(2), 0, true);
    expect(d).toMatchObject({ mode: M.Cool, temp: 22, fan: F.Med, swing: S.Pos2 });
  });
});

describe("whirlpool_magicool dispatch + rejection", () => {
  it("is identified by the unified decoder", () => {
    const r = decode(sendWhirlpoolMagicool({ mode: M.Cool, temp: 24 }));
    expect(r?.protocol).toBe("whirlpool_magicool");
    expect(r?.brand).toBe("whirlpool");
  });

  it("rejects empty / corrupt frames", () => {
    expect(decodeWhirlpoolMagicool([])).toBeNull();
    const bad = buildWhirlpoolMagicoolRaw({ mode: M.Cool, temp: 24 });
    bad[7] ^= 0x01; // break checksum without touching the signature
    expect(decodeWhirlpoolMagicool(encodeWhirlpoolMagicoolRaw(bad))).toBeNull();
  });

  it("rejects a wrong signature", () => {
    const bad = buildWhirlpoolMagicoolRaw({ mode: M.Cool, temp: 24 });
    bad[0] = 0x58; // not 'W'
    bad[13] = bad.slice(0, 13).reduce((a, x) => a + x, 0) & 0xff; // fix checksum so only the signature is wrong
    expect(decodeWhirlpoolMagicool(encodeWhirlpoolMagicoolRaw(bad))).toBeNull();
  });
});
