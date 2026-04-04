/**
 * Shared constants for Daikin AC protocols (used by IRDaikinESP, Daikin152,
 * Daikin160, Daikin176, Daikin216, etc.).
 *
 * Ported from IRremoteESP8266 `ir_Daikin.h`.
 */

// ---------------------------------------------------------------------------
// Operating modes (shared across most Daikin byte-array protocols)
// ---------------------------------------------------------------------------

export const DaikinMode = {
  Auto: 0b000,
  Dry: 0b010,
  Cool: 0b011,
  Heat: 0b100,
  Fan: 0b110,
} as const;

export type DaikinModeValue = (typeof DaikinMode)[keyof typeof DaikinMode];

// ---------------------------------------------------------------------------
// Fan speeds (shared across most Daikin byte-array protocols)
// ---------------------------------------------------------------------------

export const DaikinFan = {
  Auto: 0b1010,   // 0xA
  Quiet: 0b1011,  // 0xB
  Min: 1,
  Med: 3,
  Max: 5,
} as const;

export type DaikinFanValue = (typeof DaikinFan)[keyof typeof DaikinFan] | 1 | 2 | 3 | 4 | 5;

// ---------------------------------------------------------------------------
// Swing
// ---------------------------------------------------------------------------

export const DAIKIN_SWING_ON = 0b1111;
export const DAIKIN_SWING_OFF = 0b0000;

// ---------------------------------------------------------------------------
// Temperature limits
// ---------------------------------------------------------------------------

export const DAIKIN_MIN_TEMP = 10;
export const DAIKIN_MAX_TEMP = 32;
export const DAIKIN2_MIN_COOL_TEMP = 18;
