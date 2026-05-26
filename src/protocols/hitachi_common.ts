/**
 * Shared timing constants and integrity helpers for the Hitachi A/C family.
 *
 * Ported from IRremoteESP8266 `ir_Hitachi.cpp` / `ir_Hitachi.h`. The family
 * spans eight variants that share framing primitives but differ in state size,
 * bit order, header timings, and integrity scheme:
 *
 *   - HITACHI_AC   (224-bit, MSB) — subtractive byte-sum checksum
 *   - HITACHI_AC1  (104-bit, MSB) — nibble-sum checksum
 *   - HITACHI_AC2  (424-bit, MSB) — no integrity check (generic frame)
 *   - HITACHI_AC424(424-bit, LSB) — leader + byte-pair inversion
 *   - HITACHI_AC3  (variable, LSB) — byte-pair inversion
 *   - HITACHI_AC264(264-bit, LSB) — byte-pair inversion
 *   - HITACHI_AC296(296-bit, LSB) — byte-pair inversion + humidity
 *   - HITACHI_AC344(344-bit, LSB) — byte-pair inversion + horizontal swing
 */

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Hitachi.cpp exactly
// ---------------------------------------------------------------------------

// Base family (HITACHI_AC, AC2, AC264, AC296, AC344)
export const HITACHI_HDR_MARK = 3300;
export const HITACHI_HDR_SPACE = 1700;
export const HITACHI_BIT_MARK = 400;
export const HITACHI_ONE_SPACE = 1250;
export const HITACHI_ZERO_SPACE = 500;
/** kHitachiAcMinGap = kDefaultMessageGap. */
export const HITACHI_MIN_GAP = 100000;

// HITACHI_AC1 — only the header differs from the base family.
export const HITACHI_AC1_HDR_MARK = 3400;
export const HITACHI_AC1_HDR_SPACE = 3400;

// HITACHI_AC424
export const HITACHI_AC424_LDR_MARK = 29784;
export const HITACHI_AC424_LDR_SPACE = 49290;
export const HITACHI_AC424_HDR_MARK = 3416;
export const HITACHI_AC424_HDR_SPACE = 1604;
export const HITACHI_AC424_BIT_MARK = 463;
export const HITACHI_AC424_ONE_SPACE = 1208;
export const HITACHI_AC424_ZERO_SPACE = 372;

// HITACHI_AC3
export const HITACHI_AC3_HDR_MARK = 3400;
export const HITACHI_AC3_HDR_SPACE = 1660;
export const HITACHI_AC3_BIT_MARK = 460;
export const HITACHI_AC3_ONE_SPACE = 1250;
export const HITACHI_AC3_ZERO_SPACE = 410;

/**
 * Decode tolerance for the base family. `decodeHitachiAC` uses `_tolerance + 5`
 * (i.e. 30%); AC424/AC3/AC296 decode with the default 25%.
 */
export const HITACHI_BASE_TOLERANCE = 30;

// ---------------------------------------------------------------------------
// Byte-pair inversion integrity (AC424, AC3, AC264, AC296, AC344)
// ---------------------------------------------------------------------------

/**
 * Set every second byte of a pair to the bitwise inverse of the byte before
 * it, in place, over the range [start, start + length).
 *
 * Matches IRremoteESP8266 `irutils::invertBytePairs`.
 */
export function invertBytePairs(raw: Uint8Array, start: number, length: number): void {
  for (let i = 1; i < length; i += 2) {
    raw[start + i] = (~raw[start + i - 1]!) & 0xFF;
  }
}

/**
 * Check that every second byte of a pair is the bitwise inverse of the byte
 * before it, over the range [start, start + length).
 *
 * Matches IRremoteESP8266 `irutils::checkInvertedBytePairs`.
 */
export function checkInvertedBytePairs(raw: Uint8Array, start: number, length: number): boolean {
  for (let i = 1; i < length; i += 2) {
    const inv = (~raw[start + i - 1]!) & 0xFF;
    if (raw[start + i] !== inv) return false;
  }
  return true;
}
