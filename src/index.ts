/**
 * irtxrx — Raw IR remote control frame encoder and decoder
 *
 * TX: state → flat arrays of alternating mark/space durations in microseconds.
 * RX: raw timings → protocol identification + state extraction.
 */

export {
  reverseBits,
  encodeData,
  sendGeneric,
  sendGenericBytes,
  bcdToUint8,
  uint8ToBcd,
  sumBytes,
  sumNibbles64,
} from "./encode.js";
export type { SendGenericOptions, SendGenericBytesOptions } from "./encode.js";
export {
  matchTiming,
  matchMark,
  matchSpace,
  matchAtLeast,
  matchData,
  matchGeneric,
  matchGenericBytes,
  kTolerance,
  kMarkExcess,
} from "./decode.js";
export type {
  MatchDataResult,
  MatchGenericResult,
  MatchGenericBytesResult,
} from "./decode.js";
export { encodeNEC, sendNEC, decodeNEC } from "./protocols/nec.js";
export type { NECDecodeResult } from "./protocols/nec.js";
export {
  sendDaikin64,
  encodeDaikin64Raw,
  buildDaikin64Raw,
  decodeDaikin64,
  Daikin64Mode,
  Daikin64Fan,
} from "./protocols/daikin64.js";
export type { Daikin64State } from "./protocols/daikin64.js";
export {
  sendDaikin152,
  encodeDaikin152Raw,
  buildDaikin152Raw,
  decodeDaikin152,
  DaikinMode,
  DaikinFan,
} from "./protocols/daikin152.js";
export type { Daikin152State } from "./protocols/daikin152.js";
export type { DaikinModeValue, DaikinFanValue } from "./protocols/daikin_common.js";
export {
  sendDaikin160,
  encodeDaikin160Raw,
  buildDaikin160Raw,
  decodeDaikin160,
  Daikin160SwingV,
} from "./protocols/daikin160.js";
export type { Daikin160State } from "./protocols/daikin160.js";
export {
  sendDaikin176,
  encodeDaikin176Raw,
  buildDaikin176Raw,
  decodeDaikin176,
  Daikin176Mode,
  Daikin176SwingH,
} from "./protocols/daikin176.js";
export type { Daikin176State } from "./protocols/daikin176.js";
export {
  sendDaikin216,
  encodeDaikin216Raw,
  buildDaikin216Raw,
  decodeDaikin216,
} from "./protocols/daikin216.js";
export type { Daikin216State } from "./protocols/daikin216.js";
export {
  sendDaikinESP,
  encodeDaikinESPRaw,
  buildDaikinESPRaw,
  decodeDaikinESP,
} from "./protocols/daikin.js";
export type { DaikinESPState } from "./protocols/daikin.js";
export {
  sendDaikin128,
  encodeDaikin128Raw,
  buildDaikin128Raw,
  decodeDaikin128,
  Daikin128Mode,
  Daikin128Fan,
} from "./protocols/daikin128.js";
export type { Daikin128State } from "./protocols/daikin128.js";
export {
  sendDaikin2,
  encodeDaikin2Raw,
  buildDaikin2Raw,
  decodeDaikin2,
} from "./protocols/daikin2.js";
export type { Daikin2State } from "./protocols/daikin2.js";
export {
  sendDaikin312,
  encodeDaikin312Raw,
  buildDaikin312Raw,
  decodeDaikin312,
} from "./protocols/daikin312.js";
export type { Daikin312State } from "./protocols/daikin312.js";
export {
  buildCoolixRaw,
  encodeCoolixRaw,
  sendCoolix,
  decodeCoolixRaw,
  decodeCoolix,
  parseCoolixState,
  CoolixMode,
  CoolixFan,
  CoolixCommand,
} from "./protocols/coolix.js";
export type { CoolixState, CoolixRawResult } from "./protocols/coolix.js";
