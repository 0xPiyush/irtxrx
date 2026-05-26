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
  decode,
  kTolerance,
  kMarkExcess,
} from "./decode.js";
export type {
  MatchDataResult,
  MatchGenericResult,
  MatchGenericBytesResult,
  DecodeResult,
  DecodeOptions,
  ProtocolName,
  BrandName,
  ProtocolType,
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
export {
  buildVoltasRaw,
  encodeVoltasRaw,
  sendVoltas,
  decodeVoltas,
  parseVoltasState,
  VoltasMode,
  VoltasFan,
  VoltasModel,
} from "./protocols/voltas.js";
export type { VoltasState, VoltasModeValue, VoltasFanValue, VoltasModelValue } from "./protocols/voltas.js";
export {
  buildHitachiAcRaw,
  encodeHitachiAcRaw,
  sendHitachiAc,
  decodeHitachiAc,
  HitachiAcMode,
  HitachiAcFan,
} from "./protocols/hitachi.js";
export type { HitachiAcState, HitachiAcModeValue, HitachiAcFanValue } from "./protocols/hitachi.js";
export {
  buildHitachiAc1Raw,
  encodeHitachiAc1Raw,
  sendHitachiAc1,
  decodeHitachiAc1,
  HitachiAc1Mode,
  HitachiAc1Fan,
  HitachiAc1Model,
} from "./protocols/hitachi1.js";
export type { HitachiAc1State, HitachiAc1ModeValue, HitachiAc1FanValue, HitachiAc1ModelValue } from "./protocols/hitachi1.js";
export {
  encodeHitachiAc2Raw,
  sendHitachiAc2,
  decodeHitachiAc2,
} from "./protocols/hitachi2.js";
export {
  buildHitachiAc424Raw,
  encodeHitachiAc424Raw,
  sendHitachiAc424,
  decodeHitachiAc424,
  HitachiAc424Mode,
  HitachiAc424Fan,
  HitachiAc424Button,
} from "./protocols/hitachi424.js";
export type { HitachiAc424State, HitachiAc424ModeValue, HitachiAc424FanValue } from "./protocols/hitachi424.js";
export {
  buildHitachiAc264Raw,
  encodeHitachiAc264Raw,
  sendHitachiAc264,
  decodeHitachiAc264,
  HitachiAc264Mode,
  HitachiAc264Fan,
} from "./protocols/hitachi264.js";
export type { HitachiAc264State, HitachiAc264ModeValue, HitachiAc264FanValue } from "./protocols/hitachi264.js";
export {
  buildHitachiAc344Raw,
  encodeHitachiAc344Raw,
  sendHitachiAc344,
  decodeHitachiAc344,
  HitachiAc344Mode,
  HitachiAc344Fan,
  HitachiAc344SwingH,
} from "./protocols/hitachi344.js";
export type { HitachiAc344State, HitachiAc344ModeValue, HitachiAc344FanValue, HitachiAc344SwingHValue } from "./protocols/hitachi344.js";
export {
  buildHitachiAc296Raw,
  encodeHitachiAc296Raw,
  sendHitachiAc296,
  decodeHitachiAc296,
  HitachiAc296Mode,
  HitachiAc296Fan,
} from "./protocols/hitachi296.js";
export type { HitachiAc296State, HitachiAc296ModeValue, HitachiAc296FanValue } from "./protocols/hitachi296.js";
export {
  encodeHitachiAc3Raw,
  sendHitachiAc3,
  decodeHitachiAc3,
  applyHitachiAc3Parity,
  HITACHI_AC3_LENGTHS,
} from "./protocols/hitachi3.js";
export {
  buildTcl112Raw,
  encodeTcl112Raw,
  sendTcl112,
  decodeTcl112,
  Tcl112Mode,
  Tcl112Fan,
  Tcl112SwingV,
  Tcl112Model,
} from "./protocols/tcl112.js";
export type { Tcl112State, Tcl112ModeValue, Tcl112FanValue, Tcl112SwingVValue, Tcl112ModelValue } from "./protocols/tcl112.js";
export {
  encodeTcl96Raw,
  sendTcl96,
  decodeTcl96,
} from "./protocols/tcl96.js";
