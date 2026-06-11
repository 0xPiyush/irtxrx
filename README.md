# irtxrx

TypeScript library for encoding and decoding raw IR remote control frames. Converts between appliance state (temperature, mode, fan speed) and raw timing arrays that IR blaster hardware can transmit.

Zero runtime dependencies. Dual ESM/CJS. Correctness verified against the [IRremoteESP8266](https://github.com/crankyoldgit/IRremoteESP8266) C++ library.

## Install

```
npm install irtxrx
```

## Encode (TX)

Build raw IR timing arrays from appliance state:

```typescript
import { sendDaikin152, DaikinMode, DaikinFan } from "irtxrx";

const timings = sendDaikin152({
  power: true,
  temp: 24,
  mode: DaikinMode.Cool,
  fan: DaikinFan.Auto,
  swingVertical: true,
});
// → [3492, 1718, 433, 1529, 433, 433, ...] (mark/space durations in µs)
```

```typescript
import { sendCoolix, CoolixMode, CoolixFan } from "irtxrx";

const timings = sendCoolix({ temp: 22, mode: CoolixMode.Heat, fan: CoolixFan.Max });
```

```typescript
import { sendNEC, encodeNEC } from "irtxrx";

const timings = sendNEC(encodeNEC(0x01, 0x02));
```

Every `send*` takes an optional trailing `repeat` count (`sendDaikin152(state, repeat)`); omit it to use the protocol's own default.

When the protocol is only known at runtime (e.g. re-encoding a decoded or stored result), use the generic `encode(protocol, state)` instead of dispatching to `send*` yourself:

```typescript
import { encode } from "irtxrx";

const timings = encode("daikin152", { power: true, temp: 24, mode: 3, fan: 10 });
// `state` is type-checked against the named protocol (Daikin152State here).
```

`encode()` is the inverse of `decode()` — see [Typical workflow](#typical-workflow).

## Decode (RX)

Identify the protocol and extract state from raw timings captured by hardware:

```typescript
import { decode } from "irtxrx";

// Blind decode — identifies the protocol automatically
const result = decode(timings);
// → { protocol: "daikin152", brand: "daikin", type: "ac",
//    state: { power: true, temp: 24, mode: 3, fan: 10, ... },
//    confidence: "checksum_valid" }

// With protocol hint — faster, tolerates missing headers
const result = decode(timings, { protocol: "coolix" });

// Filter by brand or type
const result = decode(timings, { brand: "daikin" });
const result = decode(timings, { type: "ac" });
```

`state.mode` and `state.fan` are **protocol-specific integers** (e.g. `mode: 3` is Cool for Daikin). Use the `PROTOCOLS` registry — see [Discovering protocols at runtime](#discovering-protocols-at-runtime) — to map those values to names/labels and to validate them, or normalize the whole state to a brand-agnostic vocabulary with the [canonical capability model](#canonical-capability-model).

The decoded `state` is the same type the encoder accepts, so roundtrips are lossless:

```typescript
const result = decode(timings, { protocol: "daikin152" });
if (result?.protocol === "daikin152") {
  const timings2 = encode("daikin152", result.state); // identical raw bytes
}
```

See [Typical workflow](#typical-workflow) for re-encoding when the protocol is only known at runtime.

### Handling hardware captures

Real IR captures from photodiode hardware often arrive with the first frame's header missing (the sensor wakes from sleep on the initial pulse). The decoder handles this automatically:

- **Blind decode** uses a 3-tier strategy: header match, repeat frame scan, then headerless brute force with checksum validation
- **Protocol-hinted decode** skips straight to headerless decoding since the checksum/parity check is sufficient

### Command-based protocols

Some protocols (Coolix) use fixed codes for toggle features like swing, turbo, and power off. These decode as `state: null` with a `raw` code:

```typescript
import { decode, CoolixCommand } from "irtxrx";

const result = decode(timings, { protocol: "coolix" });
if (result?.state === null) {
  // It's a command frame
  if (result.raw === CoolixCommand.Off) { /* power off */ }
  if (result.raw === CoolixCommand.Swing) { /* toggle swing */ }
}
```

## Typical workflow

A gateway or app usually does: **capture → `decode` to state → persist/modify → `encode` → transmit.**

```typescript
import { decode, encode, canEncode, getProtocolInfo } from "irtxrx";

// 1. Decode a capture.
const result = decode(capturedTimings);
if (!result || result.state == null) return;   // unknown, or a command-only frame

// 2. Persist { protocol, state }. mode/fan are protocol-specific integers —
//    use getProtocolInfo(result.protocol) to label/validate them in a UI.

// 3a. Re-encode in memory (type-safe — narrowing correlates protocol & state):
if (result.protocol === "daikin152") {
  blaster.transmit(encode("daikin152", result.state));
}

// 3b. Re-encode from loosely-typed storage (protocol is a runtime string):
const { protocol, state } = loadFromStorage();  // { protocol: string; state: object }
if (canEncode(protocol)) {
  blaster.transmit(encode(protocol, state as never));
}
```

> **Note:** TypeScript can't correlate `result.protocol` with `result.state` across the decode union, so re-encoding a *generic* result needs either a `switch`/`if` on `protocol` (which narrows both — fully typed, 3a) or a cast for loosely-typed data (3b). Encoding with a **literal** protocol is always fully type-checked.

## Supported protocols

The protocols below span 26 brands. See [CHANGELOG.md](CHANGELOG.md) for release history.

| Protocol | Bits | Brand | Type | Features |
|----------|------|-------|------|----------|
| NEC | 32 | NEC | Simple | Address + command, repeat detection |
| Coolix | 24 | Coolix | AC | Temp, mode, fan, zone follow, toggle commands |
| Coolix48 | 48 | Coolix | AC | Raw 48-bit code (no checksum, timing match only) |
| Daikin64 | 64 | Daikin | AC | Temp, mode, fan, swing, sleep, timers |
| Daikin128 | 128 | Daikin | AC | BCD temps, nibble checksums, timers |
| Daikin152 | 152 | Daikin | AC | Quiet, powerful, econo, comfort, sensor |
| Daikin160 | 160 | Daikin | AC | 5 discrete swing positions |
| Daikin176 | 176 | Daikin | AC | Unique mode values, horizontal swing |
| Daikin216 | 216 | Daikin | AC | Vertical + horizontal swing, powerful |
| DaikinESP | 280 | Daikin | AC | Most features: 0.5°C, timers, mold, comfort |
| Daikin2 | 312 | Daikin | AC | Eye, purify, fresh air, light, beep |
| Daikin312 | 312 | Daikin | AC | 0.5°C, eye auto, purify |
| Gree | 64 | Gree | AC | Temp, mode, fan, swing V/H, turbo, sleep, xfan, econo, iFeel, wifi, light, timer; two-block frame + Kelvinator checksum |
| Kelon | 48 | Kelon | AC | Mode, temp, fan (inverted), dry grade, sleep, power/swing toggles, timer; fixed preamble, no checksum (timing match) |
| Kelon168 | 168 | Kelon | AC | Mode, temp, fan, swing, light, clock, on/off timers, command byte; 3-section frame + dual XOR checksums |
| Teco | 35 | Teco | AC | Mode, temp, fan, swing, sleep, light, humid, save, timer; value-based, fixed constant bits (no checksum, timing match) |
| Mitsubishi | 16 | Mitsubishi | Simple | TV command value (headerless, timing match) |
| Mitsubishi2 | 16 | Mitsubishi | Simple | HC3000 projector command value (two 8-bit halves) |
| MitsubishiAC | 144 | Mitsubishi | AC | Mode, temp (0.5°), fan, vane V/H, iSee, clock, timers, ecocool; 5-byte signature + byte-sum |
| Mitsubishi136 | 136 | Mitsubishi | AC | Mode, temp, fan, swing V; complement-pair checksum |
| Mitsubishi112 | 112 | Mitsubishi | AC | Mode, temp (inverted), fan, swing V/H; shares timings with TCL112 (longer header) |
| Godrej | 96 | Godrej | AC | Mode, temp, fan, swing, turbo, sleep, display, convert (5-in-1), i-Sense, timer; reverse-engineered, nibble-sum checksum |
| Voltas | 80 | Voltas | AC | Mode, temp, fan, swing V/H, turbo, sleep, econo, light, wifi, on/off timers |
| HitachiAc | 224 | Hitachi | AC | Temp, mode, fan, swing V/H, byte-sum checksum |
| HitachiAc1 | 104 | Hitachi | AC | Model A/B, sleep, on/off timers, toggle bits, nibble checksum |
| HitachiAc2 | 424 | Hitachi | AC | Raw 53-byte frame (no integrity check; not auto-detected) |
| HitachiAc3 | 120–216 | Hitachi | AC | Variable-length raw frame, byte-pair inversion |
| HitachiAc264 | 264 | Hitachi | AC | Temp, mode, fan, byte-pair inversion |
| HitachiAc296 | 296 | Hitachi | AC | Temp, mode, fan (incl. dehumidify), byte-pair inversion |
| HitachiAc344 | 344 | Hitachi | AC | Temp, mode, fan, swing V + 6-position swing H |
| HitachiAc424 | 424 | Hitachi | AC | Leader pulse, temp, mode, fan, swing V toggle, byte-pair inversion |
| TCL112AC | 112 | TCL | AC | 0.5°C temp, mode, fan, swing V/H, econo, health, light, turbo, timers, model |
| TCL96AC | 96 | TCL | AC | 2-bits-per-symbol raw frame (no integrity check; timing-match only) |
| Teknopoint | 112 | Teknopoint | AC | Mode, temp, fan, swing V; shares the TCL112 layout (GZ055BE1), wider tolerance |
| Panasonic | 48 | Panasonic | Simple | Kaseikyo 48-bit value (manufacturer + device + command) |
| PanasonicAC | 216 | Panasonic | AC | Temp, mode, fan, swing V/H, quiet, powerful, ion, clock, on/off timers; 2-section, model auto-detect |
| PanasonicAC32 | 32 | Panasonic | AC | Mode/temp/fan/swing toggles; multi-section, no checksum |
| Samsung | 32 | Samsung | Simple | Address + command value |
| Samsung36 | 36 | Samsung | Simple | 36-bit value, two sections |
| SamsungAC | 112/168 | Samsung | AC | Temp, mode, fan, swing, quiet, purify; per-section checksums |
| LG | 28 | LG | Simple | 28-bit value + nibble checksum; LG/LG2 header auto-detect |
| LgAc | 28 | LG | AC | Temp, mode, fan, swing; LG/LG2 wire + nibble checksum |
| CarrierAC | 32 | Carrier | AC | 32-bit value, normal + inverted halves |
| CarrierAC40 | 40 | Carrier | AC | 40-bit value, normal + inverted (min-repeat 2) |
| CarrierAC64 | 64 | Carrier | AC | Temp, mode, fan, swing, sleep; 64-bit |
| CarrierAC84 | 84 | Carrier | AC | Const-bit-time encoding, leading nibble + byte pairs |
| CarrierAC128 | 128 | Carrier | AC | 16-byte, 2-section frame |
| HaierAC | 72 | Haier | AC | 9-byte command-based (mode, temp, fan, swing, health, timers) |
| HaierAcYrw02 | 112 | Haier | AC | Temp, mode, fan, swing V/H, health, sleep, turbo, quiet; YR-W02 remote, checksum |
| HaierAC160 | 160 | Haier | AC | Temp, mode, fan, swing, health, sleep, self-clean, lock |
| HaierAC176 | 176 | Haier | AC | Superset of YR-W02 with extra swing positions/features |
| ToshibaAC | 72–80 | Toshiba | AC | Variable 9/10-byte; mode, temp, fan, turbo/econo; byte-pair inversion + XOR |
| Sharp | 15 | Sharp | Simple | 15-bit remote (address + command), inverted second block |
| SharpAC | 104 | Sharp | AC | Temp, mode, fan, swing V, ion; models A907/A705/A903, folded-XOR checksum |
| SanyoLC7461 | 42 | Sanyo | Simple | 42-bit NEC variant (address + command, inverted halves) |
| SanyoAC | 72 | Sanyo | AC | Temp, mode, fan, swing V, sleep, beep, sensor; nibble-sum checksum |
| SanyoAC88 | 88 | Sanyo | AC | Temp, mode (incl. feel), fan, swing, filter, turbo, clock; fixed prefix (no checksum) |
| SanyoAC152 | 152 | Sanyo | AC | 19-byte raw payload (no checksum, timing match) |
| WhirlpoolAC | 168 | Whirlpool | AC | Temp, mode, fan, swing, light, super, sleep, timers; 3-section, dual XOR, power toggle |
| MitsubishiHeavy152 | 152 | Mitsubishi Heavy | AC | Temp, mode, fan, swing V/H, 3D, night, silent, filter, clean; signature + inverted byte pairs |
| MitsubishiHeavy88 | 88 | Mitsubishi Heavy | AC | Temp, mode, fan, swing V/H (bit-split), clean; signature + inverted byte pairs |
| BluestarHeavy | 104 | Blue Star | AC | 13-byte raw payload (no checksum, timing match) |
| Goodweather | 48 | Goodweather | AC | 48-bit value, normal + inverted bytes (inverted bit-timing) |
| Transcold | 24 | Transcold | AC | 24-bit value, normal + inverted bytes (Coolix-style) |
| Lloyd | 120 | Lloyd | AC | Power, mode, fan, temp, turbo, sleep, eco, swing V (positional) / H, display; reverse-engineered, one's-complement checksum. **Partial — timer/clock not yet mapped.** |

### Discovering protocols at runtime

The `PROTOCOLS` registry is the single source of truth for what's supported — names, brands, the integer values each protocol's modes/fans use, temperature range, and swing support. Read it instead of hard-coding protocol tables:

```ts
import { PROTOCOLS, getProtocolInfo, getProtocolsForBrand } from "irtxrx";

PROTOCOLS.map((p) => p.protocol);          // every supported protocol name
getProtocolsForBrand("daikin");            // all Daikin variants

const tcl = getProtocolInfo("tcl112")!;
tcl.modes;   // [{ name: "Heat", value: 1 }, { name: "Cool", value: 3 }, …]
tcl.fans;    // [{ name: "Auto", value: 0 }, …]
tcl.temp;    // { min: 16, max: 31, step: 0.5 }
tcl.swingV;  // true
```

`REGISTERED_PROTOCOLS` is a lightweight name-only list (the protocols `decode()` auto-detects). Note `HitachiAc2` is encodable but absent from both — it has no integrity check, so it's decoded only on request via `decodeHitachiAc2`.

`PROTOCOLS` exposes each protocol's *own* mode/fan names and raw values, and only the basics (modes, fans, temp, swing). For a brand-agnostic surface that covers **every** capability — turbo, sleep, econo, timers, clock, sensors, and so on — and that translates values across protocols, use the [canonical capability model](#canonical-capability-model) below.

### Brands

A **brand** is the protocol's originating manufacturer — the true creator of the protocol family. Each protocol belongs to exactly one brand (every Coolix protocol → `coolix`, all nine Daikin protocols → `daikin`), and a decoded frame reports that creator brand. Rebadges/OEM resellers aren't modelled: a captured frame can't be attributed to a specific reseller.

```ts
import { decode, getProtocolsForBrand, listBrands } from "irtxrx";

listBrands();                          // → ["coolix", "gree", "kelon", "teco", "mitsubishi", "godrej", "daikin", "voltas", "hitachi", "tcl", "teknopoint", "nec", "samsung", "panasonic", "lg", "carrier", "haier", "toshiba", "sharp", "sanyo", "whirlpool", "goodweather", "transcold", "mitsubishi_heavy", "bluestar"]
getProtocolsForBrand("coolix");        // → Coolix protocol variants (coolix, coolix48)
decode(timings, { brand: "daikin" });  // → narrow the search to Daikin protocols
```

## Canonical capability model

`PROTOCOLS` reports each protocol's *raw* values verbatim — `mode: 1` means Cool on Gree but Cool is `0` on Coolix, and the dozens of extra fields each protocol's state carries (turbo, sleep, econo, light, timers, clock, sensors, model, …) aren't surfaced at all.

The **canonical model** adds a brand-agnostic layer on top, in three parts:

1. **Vocabulary** — fixed tokens shared across every protocol: `CanonicalMode` (`"cool"`, `"heat"`, …), `CanonicalFan` (`"auto"`, `"low"`, `"max"`, …), `CanonicalSwingPosition`, and `CanonicalFeature` (`"turbo"`, `"sleep"`, `"econo"`, `"timer_on"`, …).
2. **Mapping** — `CAPABILITIES`, a per-protocol bidirectional translation between those tokens and the protocol's raw state fields/values.
3. **Labels** — `LABELS` / `labelFor(token)`, a shared token → display-string table (`"econo"` → `"Economy"`).

`toCanonical` / `fromCanonical` move a state between its protocol-specific form and the canonical form, so you can decode, edit in protocol-agnostic terms, and re-encode:

```ts
import { decode, encode, toCanonical, fromCanonical } from "irtxrx";

const result = decode(capturedTimings)!;            // e.g. { protocol: "gree", state: {...} }
const canon = toCanonical(result.protocol, result.state);
// → {
//     power: { kind: "stateful", on: true },
//     mode: "cool", temp: 22, fan: "medium",
//     swingV: { kind: "position", position: "last" },
//     features: { turbo: true, light: true, econo: false, timer: { minutes: 0 }, ... },
//   }

canon.temp = 25;
canon.features = { ...canon.features, turbo: false, econo: true };

const timings = encode("gree", fromCanonical("gree", canon));  // back to Gree wire bytes
```

Field shapes:

- **Power** is a discriminated union: `{ kind: "stateful", on }` for absolute on/off, or `{ kind: "toggle", toggle }` for remotes (Kelon, …) that only carry a "power button pressed" bit.
- **Swing** is `{ kind: "bool" | "toggle" | "position" | "numeric", … }` depending on how the protocol models it.
- **Features** are `boolean` (flags), `{ level }` (e.g. light/beep level, dry grade), `{ minutes }` (timers/clock, always normalized to minutes), or `{ token }` (enums like `display_temp`, `model`).
- **Temperature** is always °C; resolution is on the spec's `temp.step`.

Discover what a protocol supports — and render it — without touching its raw fields:

```ts
import { getCanonicalCapabilities, labelFor } from "irtxrx";

const caps = getCanonicalCapabilities("gree")!;
caps.features.map((f) => `${f.canonical} → ${labelFor(f.canonical)}`);
// → ["turbo → Turbo", "sleep → Sleep", "econo → Economy", "timer → Timer", ...]
```

Synonyms are consolidated where the function is identical (`powerful`/`super` → `turbo`, `mold` → `xfan`, `sensor`/`iSense` → `ifeel`, `save`/`ecocool` → `econo`) but kept distinct where they aren't (presence-detection `isee` stays separate from follow-me `ifeel`). Raw/opaque protocols (Coolix48, HitachiAc3, TCL96, NEC, Mitsubishi, Mitsubishi2) carry no structured state and are absent from `CAPABILITIES`; `toCanonical` / `fromCanonical` / `getCanonicalCapabilities` return `undefined` or throw for them.

Feature keys are typed `keyof ProtocolStateMap[P]`, so the mapping can't drift from the protocol state types — a renamed field fails the type-check.

## Development

Requires [Bun](https://bun.sh) and a C++ compiler (for cross-validation tests).

```bash
bun install
bun test        # Run tests (compiles C++ runner on first run)
bun run build   # Build ESM + CJS to dist/
```

The vendored IRremoteESP8266 submodule is used only for testing:

```bash
git submodule update --init
```

## License

MIT
