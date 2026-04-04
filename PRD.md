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
const timings = sendDaikin2({ power: true, temp: 24, mode: "cool", fan: "auto" });

// Simple protocols: data + parameters → raw timings
const timings = sendNEC(0x807F40BF, 32);
```

---

## Decoding (RX)

### Input Format

The library accepts raw timing arrays in the same mark/space format as the encoding output.

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
  state: { power: true, temp: 24, mode: 3, fan: 10, ... },
  raw: Uint8Array,              // The decoded byte array
  confidence: "checksum_valid"  // or "timing_match"
}
// Returns null if no protocol matched
```

**Confidence levels:**
- `checksum_valid` — the decoded bytes pass the protocol's checksum validation, strongly confirming a correct match
- `timing_match` — the timing pattern matched but no checksum could be validated (e.g. simple protocols without checksums)

### Matching Strategy

Protocol identification uses a cascade of checks:
1. Match the header/leader timing pattern (mark/space durations within tolerance)
2. Verify the frame length matches the expected number of bits/bytes
3. Decode the raw timings into bits/bytes
4. Validate the checksum (if the protocol has one)

Checksum validation is the key differentiator — it makes brute-force across all protocols reliable and fast.

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

### How Correctness is Verified

Each protocol has a set of defined test cases specifying input parameters (e.g. address, command, temperature, mode). For each test case, both the C++ reference implementation and the TypeScript implementation are run independently, and their outputs are compared. The test passes only if the two outputs are exactly equal — same length, same values, same order.

For decoding, the test generates timing arrays via the C++ encoder, feeds them to the TypeScript decoder, and verifies the extracted state matches the original input.

The C++ runner compiles directly against the vendored IRremoteESP8266 source. The TypeScript runner runs the irtxrx library. Both runners share the same test case definitions, and the comparison is automated and runs as part of the standard test suite.

This means:

- There is no manually authored "expected output" — the C++ library is the expected output
- If IRremoteESP8266 fixes a bug or changes a timing constant, updating the submodule and re-running tests will immediately surface any divergence
- A protocol port is not mergeable until its tests pass

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
