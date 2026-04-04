# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun test                        # Run all tests
bun test tests/coolix.test.ts   # Run a single protocol's tests
bun run build                   # Build ESM + CJS to dist/
bun run lint                    # Type-check without emitting (tsc --noEmit)
```

The C++ cross-validation runner compiles automatically on first test run. To rebuild it after changing `tests/cpp/runner.cpp` or the Makefile:

```bash
cd tests/cpp && make clean && make
```

## Architecture

**Core engine** — two files that all protocols build on:

- `src/encode.ts` — `encodeData()` encodes bits as mark/space pairs, `sendGeneric()` / `sendGenericBytes()` wrap data with header + footer framing. Also provides checksum utilities (`sumBytes`, `sumNibbles64`).
- `src/decode.ts` — `matchData()` / `matchGeneric()` / `matchGenericBytes()` are the inverses. Also contains the unified `decode()` dispatcher with the 3-tier matching strategy (header match → repeat frame scan → headerless brute force). All protocol decoders are registered in `PROTOCOL_REGISTRY` at the bottom of this file.

**Protocol files** (`src/protocols/*.ts`) — one file per protocol, containing both encode and decode. Each follows a layered pattern:

1. `buildFooRaw(state)` — state object → raw protocol data (byte array or integer)
2. `encodeFooRaw(raw, repeat?)` — raw data → timing array (mark/space µs durations)
3. `sendFoo(state, repeat?)` — convenience: build + encode
4. `decodeFoo(timings, offset?, headerOptional?)` — timing array → state object (inverse of send)

The state type is **the same for encode and decode** — `decodeFoo()` returns `FooState`, `sendFoo()` accepts `FooState`. This guarantees lossless decode → store → encode roundtrips.

**Cross-validation** — `tests/cpp/runner.cpp` compiles against the vendored IRremoteESP8266 C++ library (git submodule at `vendor/IRremoteESP8266`). Each protocol's test file calls the C++ runner via `execSync`, then compares its output byte-for-byte against the TypeScript implementation.

## Adding a new protocol

1. Read `ir_Foo.h` and `ir_Foo.cpp` from the vendor submodule
2. Create `src/protocols/foo.ts` with timing constants, state interface, encode + decode functions
3. Check for `ExtraTolerance` / `ToleranceDelta` in the C++ — many protocols use >25% decode tolerance
4. Add `SEND_FOO=true` and `ir_Foo.cpp` to `tests/cpp/Makefile`
5. Add commands to `tests/cpp/runner.cpp`
6. Create `tests/foo.test.ts` with encode cross-validation, decode roundtrip, C++ decode cross-validation, and rejection tests
7. Export from `src/index.ts`
8. Register in `PROTOCOL_REGISTRY` in `src/decode.ts`

## Key conventions

- All encode/decode functions are **stateless pure functions** — no classes, no side effects
- Timing arrays are flat `number[]` of alternating mark (IR on) / space (IR off) durations in microseconds
- Daikin protocols are LSB-first (`msbFirst: false`), NEC and Coolix are MSB-first
- Headers/leaders are **optional** in decoders — hardware captures often miss them due to photodiode wake-up latency
- `exactOptionalPropertyTypes` is enabled in tsconfig — be precise with optional fields
