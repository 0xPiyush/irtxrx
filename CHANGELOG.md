# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
semantic versioning (pre-1.0: minor versions may include breaking changes).

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
