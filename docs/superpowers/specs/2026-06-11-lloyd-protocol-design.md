# Lloyd A/C IR protocol — design

**Status: PARTIAL / INCOMPLETE.** Reverse-engineered from ~30 real hardware
captures off a Lloyd remote. The core operating fields are fully decoded and
checksum-validated; timer/clock and a few reserved bits are **not yet mapped**
(see "Incomplete" below). Build it now with what we know; extend later.

## Origin

Lloyd is not present in the vendored IRremoteESP8266 library — `tests/cpp/identify`
returns `UNKNOWN` (121 bits) for every capture. So this is a brand-new protocol
with **no C++ cross-validation** available; validation is against real captures
+ encode↔decode roundtrips instead.

## Wire format

- **Modulation:** constant-mark pulse-distance, **no header / leader**.
  - `BIT_MARK ≈ 1020 µs` (constant; observed 1007–1068)
  - `ZERO_SPACE ≈ 580 µs` (bit 0; observed 549–610)
  - `ONE_SPACE ≈ 2540 µs` (bit 1; observed 2532–2563)
  - footer = one `BIT_MARK`, then message gap (`100000 µs`).
- **Layout:** 120 bits = **15 bytes, MSB-first**.
- **Decode tolerance:** generous (~35%) to absorb the observed hardware spread;
  header is optional per repo convention (it has none anyway).

## Byte / field map

```
B0  = 0x36                                   constant signature
B1  = 0x0F                                   constant signature
B2  = FAN(0xE0) | MODE(0x1F)
        FAN  : Auto=0xE0, Low=0x80, Med=0x40, High=0x20
        MODE : one-hot — Auto=0x10, Cool=0x08, Dry=0x04, Heat=0x02, Fan=0x01
B3  = POWER(0x80) | SLEEP(0x40) | TURBO(0x20) | SWING_V(0x0F)   [bit4 0x10 unused]
        SWING_V: 0=off, 1..5 increasing angle, 7=full swing (6 unconfirmed)
B4  = temp << 1                              16–30 °C; bit0 (0.5°) unconfirmed → 0
B5–B8 = 0x00                                 UNMAPPED (timer / clock?)
B9  = DISPLAY(0x08) | HSWING(0x02) | FAN_MODE_FLAG(0x80)        base 0x00
        FAN_MODE_FLAG is a pure function of mode (set iff mode == Fan); derived,
        not stored.
B10 = 0x80 (base) | ECO(0x03)
B11–B13 = 0x00                               UNMAPPED
B14 = ~(Σ B0..B13) & 0xFF                    checksum (one's-complement byte sum)
```

## State interface

```ts
interface LloydState {
  power: boolean;        // B3 0x80
  mode: LloydModeValue;  // Auto|Cool|Dry|Heat|Fan (one-hot, B2 & 0x1F)
  fan: LloydFanValue;    // Auto|Low|Med|High      (B2 & 0xE0)
  temp: number;          // °C, B4 = temp<<1, clamped 16–30 on encode
  turbo: boolean;        // B3 0x20
  sleep: boolean;        // B3 0x40
  eco: boolean;          // B10 0x03
  swingV: number;        // 0–7 raw nibble (B3 & 0x0F)
  swingH: boolean;       // B9 0x02
  display: boolean;      // B9 0x08
}
```

## Design decisions (confirmed with user)

1. **Semantic state** (Approach A), fully wired into `canonical.ts` /
   `capabilities.ts`. Protocol key & brand: `lloyd`.
2. **Fan-mode flag (B9 bit7)** — derived (`mode === Fan`), not a stored field.
   Lossless because it is a pure function of mode.
3. **Turbo↔fan coupling** — NOT replicated. `turbo` is the standalone B3 0x20
   bit; the remote's "turbo forces fan High" is UI behaviour. Encoder writes the
   `fan` it is given.
4. **Temp** — whole °C only; `B4` bit0 (suspected 0.5°) always 0. Clamp 16–30.
5. **swingV** — stored as the raw 0–7 nibble (faithful). Exposed as a **numeric**
   canonical swing (0–7) rather than named positions, because the exact
   angle↔code labels are not yet confirmed. `capabilities.swingV = true`.

## Checksum

`B14 = (~(sum of B0..B13)) & 0xFF`. Verified on all collected captures
(Auto/Cool/Dry/Heat/Fan; temp 23–28; fan Low/Med/High/Auto; power on/off;
turbo, eco, sleep, V-swing 1–5/7, H-swing on/off, display on/off).

## Testing (adapted — no C++ runner)

1. **Real-capture decode** — decode each captured frame, assert the decoded
   `LloydState` matches the labelled remote setting.
2. **Roundtrip** — `decode(send(state)) == state` across the state space
   (modes × fans × temps × toggles × swing).
3. **Checksum & rejection** — corrupted checksum / wrong signature / truncated
   frames return `null`.
4. Drift tests (`capabilities.test.ts`, `canonical.test.ts`) stay green.

## Registry wiring

`index.ts` export · `PROTOCOL_REGISTRY` + `ProtocolName`/`BrandName` unions +
`DecodeResult` union (decode.ts) · `ENCODERS` + `ProtocolStateMap` (codec.ts) ·
`PROTOCOLS` (capabilities.ts) · `CAPABILITIES` (canonical.ts). The C++
Makefile/runner steps are **skipped** (protocol absent from the vendor lib).

## Incomplete — to finish later

- **Timer / clock** (bytes B5–B8, still all-zero) — needs timer-on at ≥2
  durations, timer-off, and clock-set captures.
- **Half-degree** (B4 bit0).
- **B3 bit4 (0x10)** — unobserved.
- **swingV** exact position↔code semantics (and code 6).
- Any **other remote buttons** not yet captured.

Decode preserves only the mapped fields; nonzero values in unmapped bytes would
be silently dropped on re-encode. Acceptable while INCOMPLETE; revisit when
timer/clock is mapped.
