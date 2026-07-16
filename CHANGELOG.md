# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
semantic versioning (pre-1.0: minor versions may include breaking changes).

## [0.21.0]

### Added

- **Blue Star A/C (`bluestar`).** New protocol reverse-engineered from labelled
  hardware captures (no IRremoteESP8266 reference). A 10-byte (80-bit) MSB-first
  main frame followed by an inter-section gap and an 11-bit trailer in its own
  modulation. Carries a one's-complement checksum (all 10 bytes sum to `0xFF`).
  The trailer is a command/button code preserved verbatim as `commandCode` for
  a lossless roundtrip. Decoding requires the trailer, since the base modulation
  and 10-byte layout are shared with Voltas.
- **Panasonic Window A/C (`panasonic_ac168`).** New 21-byte (168-bit)
  two-section Panasonic variant reverse-engineered from labelled captures (no
  IRremoteESP8266 reference). Shares Panasonic's timing and `02 20 E0 04`
  section signatures with `panasonic_ac`, but section 2 is 13 bytes with a
  distinct field layout, so the 27-byte decoder rejects it. Section-2 checksum
  is the sum of bytes 8–19.
- **Panasonic A/C short (128-bit) command frame.** Some remotes emit a 16-byte
  (8+8) command frame (e.g. sleep/powerful/convertible) instead of the full
  27-byte state. `decodePanasonicAcShort` now decodes it, surfaced as a raw
  `panasonic_ac` result; the full 27-byte decode still takes precedence.

## [0.20.3]

### Fixed

- **Decode tolerates a truncated Samsung A/C leading header mark.** Receivers
  frequently shorten the first mark of a frame (observed `366µs` vs the nominal
  `690µs`), so the message header failed to match and decode returned `null`.
  The header is now identified by its unmistakable ~17.8 ms space, requiring
  only that the preceding value be a short mark.

## [0.20.2]

### Fixed

- **Decode recognises clipped Samsung A/C extended (3-section) captures.**
  `decodeSamsungAc` identifies the final 7-byte section by the long
  inter-message gap. Real captures often end right after the last footer mark
  (zero-padded / buffer end) with no gap, so the last section matched as
  "non-last" and decode returned `null` despite all 21 bytes being valid. A
  section is now treated as the last when no real pulses remain after it.

## [0.20.1]

### Fixed

- **Decode tolerates trailing zero padding.** `matchGeneric` / `matchGenericBytes`
  rejected an otherwise-valid frame whenever the footer-space slot held a `0` —
  which happens whenever a capture buffer is zero-padded after the footer mark
  (a `0µs` pulse is never real). A trailing `0` is now treated as end-of-data.
  General fix for all byte- and value-based protocols; surfaced via
  `whirlpool_magicool2` captures that arrived padded to a fixed length.

## [0.20.0]

### Added

- **Two Whirlpool Magicool A/C protocols**, both reverse-engineered from real
  remote captures (neither exists in IRremoteESP8266; "Magicool" is a remote
  line that spans multiple, unrelated wire protocols). Also seen on Marq and
  rebadged Kelvinator remotes.
  - **`whirlpool_magicool`** — 14-byte / 112-bit frame, ~3346/1350 header, `WLP`
    (`0x57 0x4C 0x50`) signature, byte-sum checksum. Power, mode
    (cool/dry/fan/6th-sense), temp, fan (incl. sleep), 5-step + full swing,
    turbo, eco, silent, display/dim.
  - **`whirlpool_magicool2`** — a different remote model with a wholly separate
    NEC-style format: 15-byte / 120-bit frame, 8514/4241 header, `0x56`
    signature, nibble-sum checksum. Power, mode (cool/dry/fan), temp, fan,
    5-step + full swing, 6th-sense, turbo, eco, silent, sleep, dim.
  - Both are wired through the decode registry, codec, capabilities and the
    canonical capability model, and validated against the real captures plus
    lossless round-trips (there is no C++ reference to cross-check against).

### Notes

- The **timer** function is not yet mapped on either Magicool protocol; frames
  with a timer set are not decoded.

## [0.19.0]

### Added

- **20 new A/C protocols**, each a full port of the corresponding
  IRremoteESP8266 class (every send/decode path, setter, and message variant),
  cross-validated byte-for-byte against the vendored C++ and wired through the
  decode registry, codec, capabilities, and canonical capability model:
  - **Kelvinator**, **Midea** (+ **Midea24**), **Electra**, **Vestel**,
    **Trotec** (+ **Trotec 3550**), **Neoclima**, **Airton**, **Delonghi**,
    **Gorenje**, **Whynter**, **Truma**, **Amcor**, **Rhoss**, **Technibel**,
    **Ecoclim**, **Corona**, **Airwell**.
  - **Argo** — both the **WREM-2** (`argo`) and **WREM-3** (`argo_wrem3`)
    remote families, including iFeel/sensor, config, and timer message types.

### Fixed

- **Trotec** — the byte-5 Timer bit is now derived from the (clamped) Hours
  field that decode reads back, so every reachable frame re-encodes
  byte-for-byte.
- **Corona** — `buildCoronaAcRaw` writes each timer section exactly as given
  instead of mutually clearing On/Off, so a decoded frame carrying both timers
  round-trips losslessly (single-timer states are unchanged).

## [0.6.0]

### Added

- **Canonical capability model** (`src/canonical.ts`) — a brand-agnostic layer
  over the protocol registry that exposes **every** capability the encoders
  accept, not just modes/fans/temp/swing. Three parts:
  - **Vocabulary** — shared tokens across all protocols: `CanonicalMode`,
    `CanonicalFan`, `CanonicalSwingPosition`, and `CanonicalFeature` (turbo,
    quiet, econo, sleep, light, xfan, clean, comfort, ifeel, isee, timers,
    clock, sensors, model, and more).
  - **Mapping** — `CAPABILITIES`, a per-protocol bidirectional translation
    between canonical tokens and each protocol's raw state fields/values.
    Feature keys are typed `keyof ProtocolStateMap[P]`, so the mapping can't
    drift from the state types.
  - **Labels** — `LABELS` / `labelFor()`, a shared token → display-string table.
- `toCanonical(protocol, state)` / `fromCanonical(protocol, canonical)` —
  normalize a decoded state into canonical form, edit it in protocol-agnostic
  terms, and feed it straight back through `encode()`. Power is modelled as
  stateful vs toggle; swing as bool/toggle/position/numeric; features as
  flag/level/minutes/enum-token. Raw/opaque protocols (Coolix48, HitachiAc3,
  TCL96, NEC, Mitsubishi, Mitsubishi2) carry no structured state and throw.
- `getCanonicalCapabilities(protocol)` — read a protocol's full canonical
  capability spec at runtime.

### Notes

- Purely additive — the existing `PROTOCOLS` / `getProtocolInfo` registry and
  its behaviour are unchanged. Synonyms are consolidated where the function is
  identical (`powerful`/`super` → `turbo`, `mold` → `xfan`, `sensor`/`iSense` →
  `ifeel`, `save`/`ecocool` → `econo`) and kept distinct where they aren't
  (presence-detection `isee` vs follow-me `ifeel`). A test verifies a lossless
  decode → canonical → encode wire round-trip for every protocol.

## [0.5.0]

### Added

- **Godrej** (`godrej`, new brand) — a 96-bit (12-byte) A/C protocol
  **reverse-engineered from hardware captures** (not present in
  IRremoteESP8266). Supports power, temp (16–31 °C), mode (Auto/Cool/Dry/Fan/
  Heat), fan (Auto/Low/Med/High), V-swing, turbo, sleep, display, "5-in-1
  Convert" capacity level, i-Sense (with reported room temperature), and a
  timer (30-minute steps to 24 h). MSB-first framing with a `0x14 0x27`
  preamble and a nibble-sum checksum over bytes 2–10.

### Notes

- Godrej timing constants are averages derived from real captures, so they may
  benefit from a bench test against the unit. The codec is validated against the
  original captures as test fixtures (decode → fields → re-encode → exact bytes).

## [0.4.1]

Aligns several new-protocol state fields with the library's naming convention
(state field names match the capability registry's `swingV` / `swingH` / `power`),
so registry-driven consumers can control them generically.

### Changed

- **BREAKING (0.4.0 protocols only):** renamed state fields for consistency —
  - `mitsubishi_ac`: `vane` → `swingV`, `wideVane` → `swingH`.
  - `teco`: `swing` → `swingV`.
  - `kelon168`: `swing` → `swingV`; `on` → `power` (the actual on/off state); the
    former `power` "command-present" flag is now `powerFlag`.

  Value sets are unchanged (e.g. `MitsubishiAcVane` / `MitsubishiAcWideVane`
  remain the option enums for `swingV` / `swingH`).

## [0.4.0]

Adds the Gree, Kelon, Teco, and Mitsubishi protocol families plus the second
Coolix variant — 9 new protocols and 4 new brands — and simplifies the brand
model. All new protocols are cross-validated byte-for-byte against the vendored
IRremoteESP8266 C++ library.

### Added

- **Coolix48** (`coolix48`) — the 48-bit raw Coolix variant (no checksum, timing
  match). Exposes `encodeCoolix48` / `decodeCoolix48`.
- **Gree** (`gree`, new brand) — 64-bit A/C: mode, temp, fan, swing V/H, turbo,
  sleep, xfan, econo, iFeel, wifi, light, timer. Two-block frame with a 3-bit
  mid-message footer and a Kelvinator-style block checksum.
- **Kelon** family (new `kelon` brand):
  - **Kelon** (`kelon`) — 48-bit value protocol: mode, temp, fan (inverted on the
    wire), dry grade, sleep, power/swing toggles, timer. Fixed `0x83 0x06`
    preamble, no checksum (timing match).
  - **Kelon168** (`kelon168`) — 21-byte, 3-section frame with dual XOR checksums:
    mode, temp, fan, swing, light, clock, on/off timers, and a command byte.
- **Teco** (`teco`, new brand) — 35-bit value protocol: mode, temp, fan, swing,
  sleep, light, humid, save, timer. Fixed constant bits validated on decode.
- **Mitsubishi** family (new `mitsubishi` brand):
  - **Mitsubishi** (`mitsubishi`) — 16-bit TV command value (headerless).
  - **Mitsubishi2** (`mitsubishi2`) — 16-bit HC3000 projector value (two halves).
  - **MitsubishiAC** (`mitsubishi_ac`) — 144-bit A/C: mode, temp (0.5°), fan,
    vertical/horizontal vanes, iSee, clock, timers, ecocool; 5-byte signature +
    byte-sum checksum.
  - **Mitsubishi136** (`mitsubishi136`) — 136-bit A/C with a complement-pair
    checksum.
  - **Mitsubishi112** (`mitsubishi112`) — 112-bit A/C; shares wire timings with
    TCL112 and is told apart by its longer header mark.
- `coolix` is now a first-class entry in `listBrands()`.

### Changed

- A **brand** is now strictly the protocol's originating manufacturer (e.g. every
  Coolix protocol → `coolix`, all Daikin protocols → `daikin`). `BrandName` gains
  `coolix`, `gree`, `kelon`, `teco`, and `mitsubishi`.
- `getProtocolsForBrand(brand)` now takes a plain `string` and matches the brand
  exactly (returns `[]` for an unknown brand).

### Removed

- **BREAKING:** the rebadge-alias mechanism — `BRAND_ALIASES`, `resolveBrand`,
  and the `BrandHint` type. Decoding/looking up by a reseller name (e.g.
  `croma`, `godrej`) is no longer supported; use the protocol's creator brand,
  or hint by `protocol` instead. This removes the ambiguity of attributing a
  captured frame to a specific rebadge.

## [0.3.1]

- Fix protocol-hinted decode losing short-gap repeat captures.

## [0.3.0]

- Add the runtime capability registry (`PROTOCOLS`, `getProtocolInfo`,
  `getProtocolsForBrand`, `listBrands`) and the generic `encode()` dispatcher.

## [0.2.0]

- Add the Voltas, Hitachi, and TCL protocol families.

## [0.1.x]

- Initial releases: core encode/decode engine with NEC, Daikin, and Coolix.
