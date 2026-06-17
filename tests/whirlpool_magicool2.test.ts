import { describe, it, expect } from "bun:test";
import {
  buildWhirlpoolMagicool2Raw, encodeWhirlpoolMagicool2Raw, sendWhirlpoolMagicool2,
  decodeWhirlpoolMagicool2, whirlpoolMagicool2ValidChecksum,
  WhirlpoolMagicool2Mode as M, WhirlpoolMagicool2Fan as F, WhirlpoolMagicool2Swing as S,
  type WhirlpoolMagicool2State,
} from "../src/protocols/whirlpool_magicool2.js";
import { decode } from "../src/decode.js";

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// NEC-style Whirlpool Magicool variant — not in IRremoteESP8266, RE'd from real
// captures (appliance ec8089b9…). No C++ runner; validated against real frames
// + lossless round-trips.

describe("whirlpool_magicool2 encode (known-good bytes from real captures)", () => {
  const cases: { label: string; state: WhirlpoolMagicool2State; want: string }[] = [
    { label: "24 Cool High swing1 on", state: { temp: 24, mode: M.Cool, fan: F.High, swing: S.Pos1, power: true }, want: "56740000210600000000000000001f" },
    { label: "25 Cool High swing1", state: { temp: 25, mode: M.Cool, fan: F.High, swing: S.Pos1 }, want: "567500002106000000000000000020" },
    { label: "Dry (forces Auto fan, Full swing)", state: { temp: 24, mode: M.Dry, fan: F.Auto, swing: S.Full }, want: "56740000301a000000000000000024" },
    { label: "power off", state: { temp: 24, mode: M.Cool, fan: F.High, power: false }, want: "5674000021c0000000000000000025" },
    { label: "Eco on", state: { temp: 24, mode: M.Cool, fan: F.High, swing: S.Full, eco: true }, want: "56740010211a000000000000000025" },
    { label: "Sleep on", state: { temp: 24, mode: M.Cool, fan: F.High, swing: S.Full, sleep: true }, want: "56740000211a08000000000000002c" },
    { label: "Turbo on (forces temp 16)", state: { temp: 16, mode: M.Cool, fan: F.High, swing: S.Full, turbo: true }, want: "566c0000211a000080000000000033" },
    { label: "Silent on (forces Low fan)", state: { temp: 24, mode: M.Cool, fan: F.Low, swing: S.Full, silent: true }, want: "56740001221a000000000000000026" },
    { label: "Dim (display off)", state: { temp: 24, mode: M.Cool, fan: F.High, swing: S.Full, light: false }, want: "56740008211a00000000000000002c" },
    { label: "6th Sense (temp/fan auto)", state: { temp: 15, mode: M.Cool, fan: F.Auto, swing: S.Full, sixthSense: true }, want: "566b0002201b02000000000000002e" },
  ];
  for (const c of cases) {
    it(c.label, () => {
      const raw = buildWhirlpoolMagicool2Raw(c.state);
      expect(toHex(raw)).toBe(c.want);
      expect(whirlpoolMagicool2ValidChecksum(raw)).toBe(true);
    });
  }
});

describe("whirlpool_magicool2 decode (real captures)", () => {
  const caps: { label: string; exp: Partial<WhirlpoolMagicool2State>; e: number[] }[] = [
    { label: "Eco on", exp: { eco: true, mode: M.Cool, fan: F.High, swing: S.Full, temp: 24, power: true, sleep: false, turbo: false }, e: [8514,4241,549,518,549,1678,549,1647,549,518,549,1678,518,549,549,1647,549,518,549,549,518,549,549,1647,549,518,549,1678,549,1647,549,1647,549,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,1647,549,518,549,549,518,549,549,1647,549,549,518,549,549,518,549,518,549,1678,518,549,549,518,549,518,549,1678,549,518,549,1647,549,1678,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,549,518,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,549,518,549,518,549,518,549,549,549,518,549,518,549,518,549,518,579,518,549,518,549,518,549,549,549,1647,549,518,549,1678,518,549,549,518,549,1647,549,549,518,549,549] },
    { label: "6th Sense", exp: { sixthSense: true, temp: 15, fan: F.Auto, swing: S.Full, mode: M.Cool, power: true }, e: [8514,4241,549,518,549,1647,549,1678,518,549,549,1647,549,518,549,1678,549,518,549,1647,549,1647,549,549,549,1647,549,518,549,1678,518,1678,549,518,549,518,549,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,1678,579,488,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,549,518,549,1647,549,549,518,549,549,1647,549,1647,549,549,549,1647,549,1647,549,549,518,549,549,518,549,518,549,1678,549,518,549,518,549,518,549,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,518,549,549,518,549,549,518,549,549,518,549,518,549,549,549,518,549,518,549,518,549,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,549,518,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,518,549,549,518,549,518,549,549,549,518,549,518,549,1647,549,1678,549,1647,549,518,549,1678,518,549,549,518,549] },
    { label: "Silent on", exp: { silent: true, fan: F.Low, mode: M.Cool, power: true, eco: false }, e: [8575,4180,610,518,549,1617,610,1586,610,488,579,1617,579,488,610,1586,610,488,579,488,610,488,579,1617,579,488,579,1617,610,1586,610,1617,579,488,610,488,579,488,579,518,549,518,579,488,579,488,579,518,549,518,579,1586,610,488,579,518,549,518,579,488,579,518,549,518,549,518,640,427,579,1617,579,488,579,518,579,488,579,1617,579,488,610,488,579,488,579,1617,579,488,610,1586,610,1617,579,488,579,518,579,488,579,518,549,518,579,488,579,488,579,518,549,518,579,488,579,488,579,518,549,518,579,488,579,488,579,518,549,518,579,488,579,488,579,518,549,518,579,488,579,488,579,518,549,518,579,488,579,488,579,518,549,518,579,488,579,518,549,518,549,518,579,488,579,518,549,518,579,488,579,488,579,518,549,518,549,518,579,488,579,518,549,518,549,518,579,488,579,518,549,518,549,518,579,488,579,518,549,518,579,488,579,488,579,518,549,518,549,518,579,488,579,518,549,518,549,518,579,488,579,518,549,518,579,488,579,488,579,518,549,518,549,1617,610,1586,610,488,579,518,549,1617,610,457,610,518,549] },
  ];
  for (const c of caps) {
    it(c.label, () => {
      const t = c.e.filter((x) => x > 0);
      expect(t.length).toBe(243); // 2 header + 120×2 bits + 1 trailer — guards transcription slips
      const d = decodeWhirlpoolMagicool2(t);
      expect(d).not.toBeNull();
      expect(d).toMatchObject(c.exp);
    });
  }
});

describe("whirlpool_magicool2 round-trip", () => {
  it("round-trips the wire across the full state matrix", () => {
    for (const mode of Object.values(M))
      for (const fan of Object.values(F))
        for (const swing of Object.values(S))
          for (const temp of [16, 24, 30])
            for (const power of [true, false])
              for (const feat of [{}, { turbo: true }, { eco: true }, { sleep: true }, { light: false }, { sixthSense: true }]) {
                const s: WhirlpoolMagicool2State = { power, mode, temp, fan, swing, ...feat };
                const wire = sendWhirlpoolMagicool2(s);
                const decoded = decodeWhirlpoolMagicool2(wire);
                expect(decoded).not.toBeNull();
                // Wire-lossless: re-encoding the decoded state reproduces the frame.
                expect(sendWhirlpoolMagicool2(decoded!)).toEqual(wire);
              }
  });

  it("preserves full state through decode when powered on", () => {
    const s: WhirlpoolMagicool2State = {
      power: true, mode: M.Dry, temp: 22, fan: F.Med, swing: S.Pos3,
      turbo: true, eco: true, silent: true, sleep: true, light: false, sixthSense: false,
    };
    expect(decodeWhirlpoolMagicool2(sendWhirlpoolMagicool2(s))).toEqual(s);
  });

  it("decodes without a header", () => {
    const full = sendWhirlpoolMagicool2({ mode: M.Cool, temp: 22, fan: F.Med, swing: S.Pos2 });
    expect(decodeWhirlpoolMagicool2(full.slice(2), 0, true)).toMatchObject({ mode: M.Cool, temp: 22, fan: F.Med, swing: S.Pos2 });
  });
});

describe("whirlpool_magicool2 dispatch + rejection", () => {
  it("is identified by the unified decoder", () => {
    const r = decode(sendWhirlpoolMagicool2({ mode: M.Cool, temp: 24 }));
    expect(r?.protocol).toBe("whirlpool_magicool2");
    expect(r?.brand).toBe("whirlpool");
  });

  it("does not collide with the other Magicool protocol", () => {
    // A 14-byte WLP-signature frame must never decode as magicool2 and vice-versa.
    const r = decode(sendWhirlpoolMagicool2({ mode: M.Cool, temp: 24 }));
    expect(r?.protocol).not.toBe("whirlpool_magicool");
  });

  it("rejects empty / corrupt frames", () => {
    expect(decodeWhirlpoolMagicool2([])).toBeNull();
    const bad = buildWhirlpoolMagicool2Raw({ mode: M.Cool, temp: 24 });
    bad[1] ^= 0x01; // break checksum
    expect(decodeWhirlpoolMagicool2(encodeWhirlpoolMagicool2Raw(bad))).toBeNull();
  });
});
