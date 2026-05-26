import { describe, expect, it } from "bun:test";
import { encode, canEncode } from "../src/codec";
import { decode } from "../src/decode";
import { sendDaikin152, buildDaikin152Raw, DaikinMode, DaikinFan } from "../src/protocols/daikin152";
import { sendCoolix, CoolixMode } from "../src/protocols/coolix";
import { sendHitachiAc, HitachiAcMode } from "../src/protocols/hitachi";
import { sendTcl112, Tcl112Mode } from "../src/protocols/tcl112";
import { sendTcl96 } from "../src/protocols/tcl96";
import { sendNEC, encodeNEC } from "../src/protocols/nec";

describe("encode() generic dispatcher", () => {
  it("matches the per-protocol send function", () => {
    const d = { power: true, temp: 24, mode: DaikinMode.Cool, fan: DaikinFan.Auto };
    expect(encode("daikin152", d)).toEqual(sendDaikin152(d));

    const h = { power: true, temp: 23, mode: HitachiAcMode.Cool };
    expect(encode("hitachi_ac", h)).toEqual(sendHitachiAc(h));

    const t = { power: true, temp: 24, mode: Tcl112Mode.Cool };
    expect(encode("tcl112", t)).toEqual(sendTcl112(t));
  });

  it("handles raw byte-array protocols", () => {
    const bytes = new Uint8Array(12);
    bytes[0] = 0x23; bytes[1] = 0x06; bytes[11] = 0x0a;
    expect(encode("tcl96", bytes)).toEqual(sendTcl96(bytes));
  });

  it("re-encodes NEC from address + command", () => {
    expect(encode("nec", { address: 0x01, command: 0x02 }))
      .toEqual(sendNEC(encodeNEC(0x01, 0x02)));
  });

  it("respects each protocol's default repeat, and an explicit repeat", () => {
    const c = { temp: 22, mode: CoolixMode.Cool };
    expect(encode("coolix", c)).toEqual(sendCoolix(c));      // default repeat (1)
    expect(encode("coolix", c, 0)).toEqual(sendCoolix(c, 0)); // explicit 0
    expect(encode("coolix", c, 3)).toEqual(sendCoolix(c, 3));
  });

  it("round-trips a decoded result back to identical timings", () => {
    const state = { power: true, temp: 26, mode: DaikinMode.Heat, fan: 3 as const };
    const timings = sendDaikin152(state);
    const decoded = decode(timings);
    expect(decoded).not.toBeNull();
    // Narrowing on `protocol` lets the strongly-typed encode() accept the state.
    if (decoded!.protocol === "daikin152") {
      const reEncoded = encode(decoded.protocol, decoded.state);
      expect(reEncoded).toEqual(timings);
      // …and the bytes match.
      expect(Array.from(buildDaikin152Raw(decoded.state)))
        .toEqual(Array.from(buildDaikin152Raw(state)));
    } else {
      throw new Error(`expected daikin152, got ${decoded!.protocol}`);
    }
  });

  it("canEncode reflects support", () => {
    expect(canEncode("daikin152")).toBe(true);
    expect(canEncode("tcl112")).toBe(true);
    expect(canEncode("nec")).toBe(true);
    expect(canEncode("hitachi_ac2")).toBe(false); // encodable only via its own fn
    expect(canEncode("nonsense")).toBe(false);
  });

  it("throws on an unknown protocol", () => {
    // @ts-expect-error — exercising the runtime guard with an invalid name.
    expect(() => encode("nonsense", {})).toThrow(/unknown protocol/i);
  });
});
