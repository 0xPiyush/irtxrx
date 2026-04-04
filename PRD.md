# irtx — Product Requirements Document

## Overview

`irtx` is a TypeScript library that generates raw IR (infrared) remote control frames as arrays of edge timings (in microseconds). These timing arrays can be transmitted to a hardware IR blaster device over the internet, which replays them via an IR LED to control physical appliances such as air conditioners, TVs, and other IR-controlled devices.

The library is **protocol-aware on the server and protocol-agnostic on the hardware** — the hardware device only receives and replays raw timing arrays, with no knowledge of the underlying IR protocol. This means new appliances and protocols can be added server-side without any firmware updates to the hardware.

---

## Goals

- Provide a pure TypeScript implementation of IR frame encoding for all protocols supported by [IRremoteESP8266](https://github.com/crankyoldgit/IRremoteESP8266)
- Produce raw timing arrays that are **bit-for-bit identical** to what IRremoteESP8266 would generate for the same inputs
- Be incrementally extensible — adding support for a new brand or protocol should require touching only one file
- Be publishable as a standalone npm package with zero runtime dependencies
- Make it easy to verify correctness of any ported protocol against the upstream C++ library

---

## Non-Goals

- The library does not handle actual IR transmission — it only generates timing data
- The library does not handle communication with the hardware blaster device
- The library does not decode or receive IR signals, only encode/generate them
- The library does not bundle or ship any C++ code

---

## Reference Implementation

The canonical source of truth for all IR protocol timing and encoding logic is the **IRremoteESP8266** C++ library:

**Repository:** https://github.com/crankyoldgit/IRremoteESP8266

This library is maintained as a git submodule in the `irtx` repository under `vendor/IRremoteESP8266`. It is used exclusively during development and testing — it is never part of the published library. When the upstream library adds new protocols or updates timing constants, those changes are the trigger to update `irtx` accordingly.

---

## Output Format

The library outputs a flat array of unsigned 16-bit integers representing alternating mark (IR LED on) and space (IR LED off) durations in microseconds, identical to the `rawbuf` format produced by IRremoteESP8266. For example:

```
[9000, 4500, 560, 560, 560, 1690, 560, 560, ...]
```

This is the format the hardware blaster device expects to receive and replay.

---

## Protocol Coverage

The library should cover all protocols implemented in IRremoteESP8266, added incrementally in the following priority order:

1. **Core encoding engine validation** — one or two simple protocols such as NEC, implemented purely to confirm that the base encoding engine is correct before building on top of it. Not because these are needed for appliances, but because they are the simplest possible smoke test for the foundation.
2. **AC protocols** — the primary target. Daikin, Mitsubishi AC, Samsung AC, LG AC, Fujitsu, Hitachi, Toshiba, Panasonic AC, and others. These are stateful protocols with setter APIs for temperature, mode, fan speed, swing, and other AC-specific parameters.
3. **Non-AC appliance protocols** — NEC, Samsung, Sony, LG, RC5, RC6, JVC, and others for devices such as TVs and set-top boxes.

---

## Correctness Guarantee

Correctness is the primary quality requirement of this library. A protocol implementation is only considered complete when its output is proven to be **identical to the IRremoteESP8266 C++ output** for the same inputs.

### How Correctness is Verified

Each protocol has a set of defined test cases specifying input parameters (e.g. address, command, temperature, mode). For each test case, both the C++ reference implementation and the TypeScript implementation are run independently, and their outputs are compared. The test passes only if the two outputs are exactly equal — same length, same values, same order.

The C++ runner compiles directly against the vendored IRremoteESP8266 source. The TypeScript runner runs the irtx library. Both runners share the same test case definitions, and the comparison is automated and runs as part of the standard test suite.

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

This process ensures `irtx` stays in sync with the upstream library over time without requiring a full audit on every update.

---

## Distribution

The library is published to npm as a standard ESM/CJS TypeScript package. The published package contains only compiled JavaScript and type declarations. No C++ code, no build tools, no test harness, and no vendor submodule are included in the published artifact.

Runtime dependencies: **none**.
