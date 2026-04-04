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

The decoded `state` is the same type accepted by the encoder, so roundtrips are lossless:

```typescript
const state = decode(timings, { protocol: "daikin152" })!.state;
const timings2 = sendDaikin152(state);
// timings2 produces identical raw bytes
```

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

## Supported protocols

| Protocol | Bits | Brand | Type | Features |
|----------|------|-------|------|----------|
| NEC | 32 | NEC | Simple | Address + command, repeat detection |
| Coolix | 24 | Coolix | AC | Temp, mode, fan, zone follow, toggle commands |
| Daikin64 | 64 | Daikin | AC | Temp, mode, fan, swing, sleep, timers |
| Daikin128 | 128 | Daikin | AC | BCD temps, nibble checksums, timers |
| Daikin152 | 152 | Daikin | AC | Quiet, powerful, econo, comfort, sensor |
| Daikin160 | 160 | Daikin | AC | 5 discrete swing positions |
| Daikin176 | 176 | Daikin | AC | Unique mode values, horizontal swing |
| Daikin216 | 216 | Daikin | AC | Vertical + horizontal swing, powerful |
| DaikinESP | 280 | Daikin | AC | Most features: 0.5°C, timers, mold, comfort |
| Daikin2 | 312 | Daikin | AC | Eye, purify, fresh air, light, beep |
| Daikin312 | 312 | Daikin | AC | 0.5°C, eye auto, purify |

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
