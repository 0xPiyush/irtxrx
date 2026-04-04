/**
 * irtx — Raw IR remote control frame generator
 *
 * Output format: flat arrays of alternating mark/space durations in microseconds.
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
export { encodeNEC, sendNEC } from "./protocols/nec.js";
export {
  sendDaikin64,
  encodeDaikin64Raw,
  buildDaikin64Raw,
  Daikin64Mode,
  Daikin64Fan,
} from "./protocols/daikin64.js";
export type { Daikin64State } from "./protocols/daikin64.js";
export {
  sendDaikin152,
  encodeDaikin152Raw,
  buildDaikin152Raw,
  DaikinMode,
  DaikinFan,
} from "./protocols/daikin152.js";
export type { Daikin152State } from "./protocols/daikin152.js";
export type { DaikinModeValue, DaikinFanValue } from "./protocols/daikin_common.js";
export {
  sendDaikin160,
  encodeDaikin160Raw,
  buildDaikin160Raw,
  Daikin160SwingV,
} from "./protocols/daikin160.js";
export type { Daikin160State } from "./protocols/daikin160.js";
export {
  sendDaikin176,
  encodeDaikin176Raw,
  buildDaikin176Raw,
  Daikin176Mode,
  Daikin176SwingH,
} from "./protocols/daikin176.js";
export type { Daikin176State } from "./protocols/daikin176.js";
export {
  sendDaikin216,
  encodeDaikin216Raw,
  buildDaikin216Raw,
} from "./protocols/daikin216.js";
export type { Daikin216State } from "./protocols/daikin216.js";
export {
  sendDaikinESP,
  encodeDaikinESPRaw,
  buildDaikinESPRaw,
} from "./protocols/daikin.js";
export type { DaikinESPState } from "./protocols/daikin.js";
export {
  sendDaikin128,
  encodeDaikin128Raw,
  buildDaikin128Raw,
  Daikin128Mode,
  Daikin128Fan,
} from "./protocols/daikin128.js";
export type { Daikin128State } from "./protocols/daikin128.js";
export {
  sendDaikin2,
  encodeDaikin2Raw,
  buildDaikin2Raw,
} from "./protocols/daikin2.js";
export type { Daikin2State } from "./protocols/daikin2.js";
export {
  sendDaikin312,
  encodeDaikin312Raw,
  buildDaikin312Raw,
} from "./protocols/daikin312.js";
export type { Daikin312State } from "./protocols/daikin312.js";
