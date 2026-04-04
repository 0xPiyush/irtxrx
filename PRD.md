# irtxrx — Product Requirements Document

## Overview

`irtxrx` is a TypeScript library that **encodes and decodes** raw IR (infrared) remote control frames as arrays of edge timings (in microseconds).

**Encoding (TX):** Given an appliance state (e.g. power on, 24°C, cool mode), the library produces raw timing arrays that can be transmitted to a hardware IR blaster device over the internet, which replays them via an IR LED to control physical appliances such as air conditioners, TVs, and other IR-controlled devices.

**Decoding (RX):** Given a raw timing array captured from a physical remote, the library identifies the protocol and extracts the appliance state (temperature, mode, fan speed, etc.). This enables the server to stay in sync with physical remote usage.

The library is **protocol-aware on the server and protocol-agnostic on the hardware** — the hardware device only receives/captures and replays raw timing arrays, with no knowledge of the underlying IR protocol. This means new appliances and protocols can be added server-side without any firmware updates to the hardware.

---

## Goals

- Provide a pure TypeScript implementation of IR frame **encoding and decoding** for all protocols supported by [IRremoteESP8266](https://github.com/crankyoldgit/IRremoteESP8266)
- Produce raw timing arrays that are **bit-for-bit identical** to what IRremoteESP8266 would generate for the same inputs
- Decode raw timing arrays back into structured state objects matching the C++ library's decode output
- Be incrementally extensible — adding support for a new brand or protocol should require touching only one file
- Be publishable as a standalone npm package with zero runtime dependencies
- Make it easy to verify correctness of any ported protocol against the upstream C++ library

---

## Non-Goals

- The library does not handle actual IR transmission or reception — it only generates and parses timing data
- The library does not handle communication with the hardware blaster device
- The library does not bundle or ship any C++ code

---

## Device Learning

The library has no concept of device learning, hardware modes, or persistent state — these are application-level concerns. However, the library's decode API is designed to support learning workflows naturally. When called without a protocol hint (`decode(timings)`), the decoder runs the full identification cascade — header matching, repeat frame scanning, and checksum-based brute force — making it suitable for one-time device identification from a clean capture. When called with a protocol hint (`decode(timings, { protocol: "coolix" })`), the decoder skips header matching entirely and goes straight to data decoding, making it fast and tolerant of partial captures where the header may have been missed. The expectation is that consuming applications use the hintless form once to identify and persist the protocol, then use the hinted form for all subsequent decodes against that device.

---

## Reference Implementation

The canonical source of truth for all IR protocol timing and encoding logic is the **IRremoteESP8266** C++ library:

**Repository:** https://github.com/crankyoldgit/IRremoteESP8266

This library is maintained as a git submodule in the repository under `vendor/IRremoteESP8266`. It is used exclusively during development and testing — it is never part of the published library. When the upstream library adds new protocols or updates timing constants, those changes are the trigger to update `irtxrx` accordingly.

---

## Encoding (TX)

### Output Format

The library outputs a flat array of unsigned 16-bit integers representing alternating mark (IR LED on) and space (IR LED off) durations in microseconds, identical to the `rawbuf` format produced by IRremoteESP8266. For example:

```
[9000, 4500, 560, 560, 560, 1690, 560, 560, ...]
```

This is the format the hardware blaster device expects to receive and replay.

### API Design

All encoding functions are **stateless pure functions**. The caller provides the desired appliance state, and the library returns the raw timing array. The library does not track or manage appliance state — that responsibility belongs to the server.

```typescript
// AC protocols: desired state → raw timings
const timings = sendDaikin2({
  power: true,
  temp: 24,
  mode: DaikinMode.Cool,
  fan: DaikinFan.Auto
});

// Simple protocols: data + parameters → raw timings
const timings = sendNEC(0x807f40bf, 32);
```

Mode and fan values are exported as `const` objects with numeric values (e.g. `DaikinMode.Cool = 3`, `DaikinFan.Auto = 0xA`). Decode returns the same numeric values, so state objects can be passed directly back to encode without any mapping.

---

## Decoding (RX)

### Input Format

The library accepts raw timing arrays in the same mark/space format as the encoding output. In practice, these arrays come from hardware IR receivers (photodiode + MCU capture) and differ from ideal encoder output in two important ways:

1. **Missing headers** — the IR receiver's photodiode is typically in sleep mode and wakes on the first IR pulse. The wake-up time means the header mark and/or space of the first frame are often partially or completely lost. A 200-entry Coolix capture (2 frames) typically arrives as 197 entries — the first frame's header is gone, but the repeat frame's header is intact.

2. **Timing jitter** — real captures have ±5–30% variation on individual mark/space durations. Different protocols tolerate different amounts of jitter. The default matching tolerance is ±25%, but some protocols (Coolix, Daikin2, Daikin64, Daikin312) require ±30% to reliably decode real-world captures.

### API Design

Decoding supports multiple levels of specificity via optional hints:

```typescript
// Specific protocol — try only Daikin2
const result = decode(timings, { protocol: "daikin2" });

// Brand hint — try all Daikin variants
const result = decode(timings, { brand: "daikin" });

// Type hint — try all AC protocols
const result = decode(timings, { type: "ac" });

// Blind — try all known protocols
const result = decode(timings);
```

### Return Format

```typescript
{
  protocol: "daikin2",
  brand: "daikin",
  type: "ac",
  state: { power: true, temp: 24, mode: 3, fan: 10, ... },  // Daikin2State
  confidence: "checksum_valid"  // or "timing_match"
}
// Returns null if no protocol matched
```

The `state` object is the same type used by the encoder (e.g. `Daikin2State`), with mode/fan as numeric constants. The result is a discriminated union on `protocol`, so TypeScript narrows the `state` type automatically.

**Confidence levels:**

- `checksum_valid` — the decoded bytes pass the protocol's checksum validation, strongly confirming a correct match
- `timing_match` — the timing pattern matched but no checksum could be validated (e.g. simple protocols without checksums)

### State Type Symmetry

For a given protocol, the state type returned by decode is the **same type** accepted by encode. This enables lossless roundtrips:

```typescript
const state = decodeDaikin152(timings); // returns Daikin152State
const timings2 = sendDaikin152(state); // accepts Daikin152State
// timings2 produces the same raw bytes as the original frame
```

All state fields are populated on decode (no undefined values for stateful protocols), so the decoded state can be stored in a database and later re-encoded without any information loss.

### Protocol Categories

Protocols fall into two categories that affect how decode works:

**Stateful protocols** (Daikin, etc.) — every frame encodes the complete AC state (mode, temperature, fan speed, swing, timers, etc.). Decode always returns a full state object. The roundtrip guarantee applies to every frame.

**Command-based protocols** (Coolix, etc.) — regular frames encode a subset of AC state (mode, temperature, fan), while toggle features (swing, turbo, sleep, LED, clean) are sent as separate fixed command codes. For these protocols:

- State frames decode to a state object (roundtrip works)
- Command frames decode to a raw code that can be matched against exported command constants (e.g. `CoolixCommand.Off`, `CoolixCommand.Swing`)
- The protocol-specific `decodeFoo()` returns `null` for command frames; use `decodeFooRaw()` to get the raw code

### Matching Strategy — 3-Tier Decode

Because hardware captures often arrive with missing headers, the decode function uses a tiered strategy that balances speed with robustness:

**Tier 1 — Header match at offset 0.** Try each candidate protocol's decoder at the start of the timing array with headers required. This is the fastest path and handles captures where the full frame (including header) is intact. Most repeat frames and captures from hardware that doesn't sleep will match here.

**Tier 2 — Find repeat frame.** Scan the timing array for an inter-frame gap (a space significantly longer than any data space, typically >3000µs). After each gap, try each candidate protocol with headers required. This handles the common case where the first frame's header was lost during hardware wake-up but the repeat frame is complete.

**Tier 3 — Brute force, header optional.** Try each candidate protocol at offset 0 with headers optional, relying solely on the protocol's integrity checks (checksums, byte-inversion parity, command/address inversion) to confirm the match. This handles single-frame captures where the header was lost and no repeat frame exists.

The integrity checks are strong enough to make Tier 3 reliable:

- Coolix: 3-byte inversion parity (1 in 16M false positive rate)
- Daikin protocols: per-section byte-sum checksums
- NEC: command byte inversion check

Each tier is progressively more expensive but handles more edge cases. The decoder stops at the first successful match.

---

## Protocol Coverage

The library should cover all protocols implemented in IRremoteESP8266, added incrementally in the following priority order:

1. **Core engine validation** — one or two simple protocols such as NEC, implemented purely to confirm that the base encoding/decoding engine is correct before building on top of it.
2. **AC protocols** — the primary target. Daikin, Mitsubishi AC, Samsung AC, LG AC, Fujitsu, Hitachi, Toshiba, Panasonic AC, and others. These are stateful protocols with setter APIs for temperature, mode, fan speed, swing, and other AC-specific parameters.
3. **Non-AC appliance protocols** — NEC, Samsung, Sony, LG, RC5, RC6, JVC, and others for devices such as TVs and set-top boxes.

---

## Correctness Guarantee

Correctness is the primary quality requirement of this library. A protocol implementation is only considered complete when:

- **Encoding:** its output is proven to be **identical to the IRremoteESP8266 C++ output** for the same inputs
- **Decoding:** given a C++ encoded timing array, the TypeScript decoder extracts the same state values as the C++ decoder
- **Roundtrip:** `decode(encode(state))` produces a state that, when re-encoded, generates the same raw bytes as the original

### How Correctness is Verified

Each protocol has a set of defined test cases specifying input parameters (e.g. address, command, temperature, mode). For each test case, both the C++ reference implementation and the TypeScript implementation are run independently, and their outputs are compared. The test passes only if the two outputs are exactly equal — same length, same values, same order.

For decoding, the test generates timing arrays via the C++ encoder, feeds them to the TypeScript decoder, and verifies the extracted state matches the original input.

The C++ runner compiles directly against the vendored IRremoteESP8266 source. The TypeScript runner runs the irtxrx library. Both runners share the same test case definitions, and the comparison is automated and runs as part of the standard test suite.

This means:

- There is no manually authored "expected output" — the C++ library is the expected output
- If IRremoteESP8266 fixes a bug or changes a timing constant, updating the submodule and re-running tests will immediately surface any divergence
- A protocol port is not mergeable until its tests pass

### Porting Checklist

When porting a new protocol from IRremoteESP8266, the following must be verified:

1. **Timing constants** — all mark/space/gap durations from `ir_Foo.h` must match exactly
2. **Decode tolerance** — check for `ExtraTolerance`, `ToleranceDelta`, or similar constants in the C++ header/source. Many protocols use >25% tolerance for real-world decode reliability. The TypeScript decoder must use the same total tolerance.
3. **Checksum algorithm** — verify the checksum matches (byte sum, nibble sum, XOR, CRC, etc.)
4. **Bit/byte order** — confirm MSB-first vs LSB-first for data encoding
5. **State field mapping** — verify every bit/byte position against the C++ getters/setters
6. **Mode-dependent logic** — some protocols adjust fields based on mode (e.g. Coolix converts Auto↔Auto0 fan depending on mode, Daikin sets special temp codes for Fan/Dry modes)
7. **Leader/preamble** — identify any leader sequences and make them optional in the decoder
8. **Special commands** — for command-based protocols, identify fixed command codes and export them as constants

---

## Keeping Up With Upstream

When IRremoteESP8266 releases updates, the process is:

1. Update the vendored submodule to the new release
2. Review the diff for new `ir_*.cpp` files (new protocols) and changes to existing ones
3. For new protocols: implement in TypeScript, add test cases, verify against C++ output
4. For changed protocols: re-run existing tests — if they fail, update the TypeScript implementation to match

This process ensures `irtxrx` stays in sync with the upstream library over time without requiring a full audit on every update.

---

## Distribution

The library is published to npm as a standard ESM/CJS TypeScript package. The published package contains only compiled JavaScript and type declarations. No C++ code, no build tools, no test harness, and no vendor submodule are included in the published artifact.

Runtime dependencies: **none**.
