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
  REGISTERED_PROTOCOLS,
  kTolerance,
  kMarkExcess,
} from "./decode.js";
export {
  PROTOCOLS,
  getProtocolInfo,
  getProtocolsForBrand,
  listBrands,
} from "./capabilities.js";
export type { ProtocolInfo, NamedValue, TempRange } from "./capabilities.js";
export { encode, canEncode } from "./codec.js";
export type { ProtocolStateMap } from "./codec.js";
export {
  CAPABILITIES,
  LABELS,
  labelFor,
  toCanonical,
  fromCanonical,
  getCanonicalCapabilities,
} from "./canonical.js";
export type {
  CanonicalState,
  CanonicalMode,
  CanonicalFan,
  CanonicalFanValue,
  CanonicalFeature,
  CanonicalSwingPosition,
  CapabilitySpec,
  SwingValue,
  FeatureValue,
} from "./canonical.js";
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
  encodeCoolix48,
  decodeCoolix48,
  COOLIX48_BITS,
} from "./protocols/coolix48.js";
export {
  buildGreeRaw,
  encodeGreeRaw,
  sendGree,
  decodeGreeRaw,
  decodeGree,
  parseGreeState,
  validGreeChecksum,
  GreeMode,
  GreeFan,
  GreeSwingV,
  GreeSwingH,
  GreeDisplayTemp,
  GREE_STATE_LENGTH,
  GREE_BITS,
} from "./protocols/gree.js";
export type { GreeState, GreeRawResult } from "./protocols/gree.js";
export {
  buildKelonRaw,
  buildKelonBytes,
  encodeKelonRaw,
  sendKelon,
  decodeKelon,
  parseKelonState,
  KelonMode,
  KelonFan,
  KELON_BITS,
} from "./protocols/kelon.js";
export type { KelonState } from "./protocols/kelon.js";
export {
  buildKelon168Raw,
  encodeKelon168Raw,
  sendKelon168,
  decodeKelon168,
  decodeKelon168Raw,
  parseKelon168State,
  validKelon168Checksum,
  Kelon168Mode,
  Kelon168Fan,
  Kelon168Command,
  KELON168_STATE_LENGTH,
  KELON168_BITS,
} from "./protocols/kelon168.js";
export type { Kelon168State, Kelon168RawResult } from "./protocols/kelon168.js";
export {
  buildTecoRaw,
  encodeTecoRaw,
  sendTeco,
  decodeTeco,
  parseTecoState,
  TecoMode,
  TecoFan,
  TECO_BITS,
} from "./protocols/teco.js";
export type { TecoState } from "./protocols/teco.js";
export {
  encodeMitsubishiRaw,
  sendMitsubishi,
  decodeMitsubishi,
  MITSUBISHI_BITS,
} from "./protocols/mitsubishi.js";
export type { MitsubishiState } from "./protocols/mitsubishi.js";
export {
  encodeMitsubishi2Raw,
  sendMitsubishi2,
  decodeMitsubishi2,
  MITSUBISHI2_BITS,
} from "./protocols/mitsubishi2.js";
export type { Mitsubishi2State } from "./protocols/mitsubishi2.js";
export {
  buildMitsubishiAcRaw,
  encodeMitsubishiAcRaw,
  sendMitsubishiAc,
  decodeMitsubishiAc,
  parseMitsubishiAcState,
  validMitsubishiAcChecksum,
  MitsubishiAcMode,
  MitsubishiAcFan,
  MitsubishiAcVane,
  MitsubishiAcWideVane,
  MITSUBISHI_AC_BITS,
} from "./protocols/mitsubishi_ac.js";
export type { MitsubishiAcState } from "./protocols/mitsubishi_ac.js";
export {
  buildMitsubishi136Raw,
  encodeMitsubishi136Raw,
  sendMitsubishi136,
  decodeMitsubishi136,
  parseMitsubishi136State,
  validMitsubishi136Checksum,
  Mitsubishi136Mode,
  Mitsubishi136Fan,
  Mitsubishi136SwingV,
  MITSUBISHI136_BITS,
} from "./protocols/mitsubishi136.js";
export type { Mitsubishi136State } from "./protocols/mitsubishi136.js";
export {
  buildMitsubishi112Raw,
  encodeMitsubishi112Raw,
  sendMitsubishi112,
  decodeMitsubishi112,
  parseMitsubishi112State,
  Mitsubishi112Mode,
  Mitsubishi112Fan,
  Mitsubishi112SwingV,
  Mitsubishi112SwingH,
  MITSUBISHI112_BITS,
} from "./protocols/mitsubishi112.js";
export type { Mitsubishi112State } from "./protocols/mitsubishi112.js";
export {
  buildGodrejRaw,
  encodeGodrejRaw,
  sendGodrej,
  decodeGodrej,
  decodeGodrejRaw,
  parseGodrejState,
  validGodrejChecksum,
  GodrejMode,
  GodrejFan,
  GODREJ_BITS,
} from "./protocols/godrej.js";
export type { GodrejState, GodrejRawResult } from "./protocols/godrej.js";
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
  buildTeknopointRaw,
  encodeTeknopointRaw,
  sendTeknopoint,
  decodeTeknopoint,
  TeknopointMode,
  TeknopointFan,
  TeknopointSwingV,
  TeknopointModel,
} from "./protocols/teknopoint.js";
export type { TeknopointState, TeknopointModeValue, TeknopointFanValue, TeknopointSwingVValue, TeknopointModelValue } from "./protocols/teknopoint.js";
export {
  encodeTcl96Raw,
  sendTcl96,
  decodeTcl96,
} from "./protocols/tcl96.js";
export {
  encodePanasonicData,
  encodePanasonicRaw,
  sendPanasonic,
  decodePanasonic,
  PANASONIC_BITS,
  PANASONIC_MANUFACTURER,
} from "./protocols/panasonic.js";
export type { PanasonicState } from "./protocols/panasonic.js";
export {
  buildPanasonicAc32Raw,
  encodePanasonicAc32Raw,
  sendPanasonicAc32,
  decodePanasonicAc32,
  parsePanasonicAc32,
  PanasonicAc32Mode,
  PanasonicAc32Fan,
  PanasonicAc32SwingV,
  PANASONIC_AC32_BITS,
  PANASONIC_AC32_KNOWN_GOOD,
} from "./protocols/panasonic_ac32.js";
export type { PanasonicAc32State, PanasonicAc32ModeValue, PanasonicAc32FanValue, PanasonicAc32SwingVValue } from "./protocols/panasonic_ac32.js";
export {
  buildPanasonicAcRaw,
  encodePanasonicAcRaw,
  sendPanasonicAc,
  decodePanasonicAc,
  parsePanasonicAcState,
  detectPanasonicAcModel,
  PanasonicAcMode,
  PanasonicAcFan,
  PanasonicAcSwingV,
  PanasonicAcSwingH,
  PanasonicAcModel,
} from "./protocols/panasonic_ac.js";
export type { PanasonicAcState, PanasonicAcModeValue, PanasonicAcFanValue, PanasonicAcSwingVValue, PanasonicAcSwingHValue, PanasonicAcModelValue } from "./protocols/panasonic_ac.js";
export {
  encodeSamsungData,
  encodeSamsungRaw,
  sendSamsung,
  decodeSamsung,
  SAMSUNG_BITS,
} from "./protocols/samsung.js";
export type { SamsungState } from "./protocols/samsung.js";
export {
  encodeSamsung36Raw,
  sendSamsung36,
  decodeSamsung36,
  SAMSUNG36_BITS,
} from "./protocols/samsung36.js";
export type { Samsung36State } from "./protocols/samsung36.js";
export {
  buildSamsungAcRaw,
  encodeSamsungAcRaw,
  sendSamsungAc,
  decodeSamsungAc,
  parseSamsungAcState,
  samsungAcValidChecksum,
  SamsungAcMode,
  SamsungAcFan,
} from "./protocols/samsung_ac.js";
export type { SamsungAcState, SamsungAcModeValue, SamsungAcFanValue } from "./protocols/samsung_ac.js";
export {
  encodeLgData,
  encodeLgRaw,
  sendLg,
  decodeLg,
  LG_BITS,
} from "./protocols/lg.js";
export type { LgState } from "./protocols/lg.js";
export {
  buildLgAcRaw,
  sendLgAc,
  decodeLgAc,
  parseLgAcState,
  lgAcModelIsLg2,
  LgAcMode,
  LgAcFan,
  LgAcModel,
} from "./protocols/lg_ac.js";
export type { LgAcState, LgAcModeValue, LgAcFanValue, LgAcModelValue } from "./protocols/lg_ac.js";
export { encodeCarrierAcRaw, sendCarrierAc, decodeCarrierAc, CARRIER_AC_BITS } from "./protocols/carrier_ac.js";
export type { CarrierAcState } from "./protocols/carrier_ac.js";
export { encodeCarrierAc40Raw, sendCarrierAc40, decodeCarrierAc40, CARRIER_AC40_BITS } from "./protocols/carrier_ac40.js";
export type { CarrierAc40State } from "./protocols/carrier_ac40.js";
export {
  buildCarrierAc64Raw, encodeCarrierAc64Raw, sendCarrierAc64, decodeCarrierAc64,
  parseCarrierAc64State, carrierAc64Checksum, carrierAc64ValidChecksum,
  CarrierAc64Mode, CarrierAc64Fan, CARRIER_AC64_BITS, CARRIER_AC64_KNOWN_GOOD,
} from "./protocols/carrier_ac64.js";
export type { CarrierAc64State, CarrierAc64ModeValue, CarrierAc64FanValue } from "./protocols/carrier_ac64.js";
export { encodeCarrierAc84Raw, sendCarrierAc84, decodeCarrierAc84, CARRIER_AC84_STATE_LENGTH } from "./protocols/carrier_ac84.js";
export { encodeCarrierAc128Raw, sendCarrierAc128, decodeCarrierAc128, CARRIER_AC128_STATE_LENGTH } from "./protocols/carrier_ac128.js";
export {
  buildHaierAcRaw, encodeHaierAcRaw, sendHaierAc, decodeHaierAc, parseHaierAcState,
  HaierAcCommand, HaierAcMode, HaierAcFan, HaierAcSwingV,
} from "./protocols/haier_ac.js";
export type { HaierAcState, HaierAcCommandValue, HaierAcModeValue, HaierAcFanValue, HaierAcSwingVValue } from "./protocols/haier_ac.js";
export {
  buildHaierAc176Raw, encodeHaierAc176Raw, sendHaierAc176, decodeHaierAc176, parseHaierAc176State,
  HaierAcYrw02Mode, HaierAcYrw02Fan, HaierAc176SwingV, HaierAc176SwingH, HaierAc176Model,
} from "./protocols/haier_ac176.js";
export type {
  HaierAc176State, HaierAcYrw02ModeValue, HaierAcYrw02FanValue,
  HaierAc176SwingVValue, HaierAc176SwingHValue, HaierAc176ModelValue,
} from "./protocols/haier_ac176.js";
export {
  buildHaierAcYrw02Raw, encodeHaierAcYrw02Raw, sendHaierAcYrw02, decodeHaierAcYrw02, parseHaierAcYrw02State,
} from "./protocols/haier_ac_yrw02.js";
export type { HaierAcYrw02State } from "./protocols/haier_ac_yrw02.js";
export {
  buildHaierAc160Raw, encodeHaierAc160Raw, sendHaierAc160, decodeHaierAc160, parseHaierAc160State,
  haierAc160LightToggle, HaierAc160SwingV,
} from "./protocols/haier_ac160.js";
export type { HaierAc160State, HaierAc160SwingVValue } from "./protocols/haier_ac160.js";
export {
  buildToshibaAcRaw, encodeToshibaAcRaw, sendToshibaAc, decodeToshibaAc, parseToshibaAcState,
  toshibaAcValidChecksum, ToshibaAcMode, ToshibaAcFan, ToshibaAcModel,
} from "./protocols/toshiba_ac.js";
export type { ToshibaAcState, ToshibaAcModeValue, ToshibaAcFanValue, ToshibaAcModelValue } from "./protocols/toshiba_ac.js";
export { encodeSharpData, encodeSharpRaw, sendSharp, decodeSharp, SHARP_BITS } from "./protocols/sharp.js";
export type { SharpState } from "./protocols/sharp.js";
export {
  buildSharpAcRaw, encodeSharpAcRaw, sendSharpAc, decodeSharpAc, parseSharpAcState,
  sharpAcValidChecksum, SharpAcModel, SharpAcMode, SharpAcFan, SharpAcSwingV,
} from "./protocols/sharp_ac.js";
export type { SharpAcState, SharpAcModelValue, SharpAcModeValue, SharpAcFanValue, SharpAcSwingVValue } from "./protocols/sharp_ac.js";
export {
  encodeSanyoLc7461Data, encodeSanyoLc7461Raw, sendSanyoLc7461, decodeSanyoLc7461, SANYO_LC7461_BITS,
} from "./protocols/sanyo_lc7461.js";
export type { SanyoLc7461State } from "./protocols/sanyo_lc7461.js";
export {
  buildSanyoAcRaw, encodeSanyoAcRaw, sendSanyoAc, decodeSanyoAc, parseSanyoAcState,
  sanyoAcValidChecksum, SanyoAcMode, SanyoAcFan, SanyoAcSwingV,
} from "./protocols/sanyo_ac.js";
export type { SanyoAcState, SanyoAcModeValue, SanyoAcFanValue, SanyoAcSwingVValue } from "./protocols/sanyo_ac.js";
export {
  buildSanyoAc88Raw, encodeSanyoAc88Raw, sendSanyoAc88, decodeSanyoAc88, parseSanyoAc88State,
  SanyoAc88Mode, SanyoAc88Fan, SANYO_AC88_MIN_REPEAT,
} from "./protocols/sanyo_ac88.js";
export type { SanyoAc88State, SanyoAc88ModeValue, SanyoAc88FanValue } from "./protocols/sanyo_ac88.js";
export {
  encodeSanyoAc152Raw, sendSanyoAc152, decodeSanyoAc152, SANYO_AC152_STATE_LENGTH,
} from "./protocols/sanyo_ac152.js";
export {
  buildWhirlpoolAcRaw, encodeWhirlpoolAcRaw, sendWhirlpoolAc, decodeWhirlpoolAc, parseWhirlpoolAcState,
  whirlpoolAcValidChecksum, WhirlpoolAcMode, WhirlpoolAcFan, WhirlpoolAcModel, WhirlpoolAcCommand,
} from "./protocols/whirlpool_ac.js";
export type { WhirlpoolAcState, WhirlpoolAcModeValue, WhirlpoolAcFanValue, WhirlpoolAcModelValue, WhirlpoolAcCommandValue } from "./protocols/whirlpool_ac.js";
export {
  buildMitsubishiHeavy152Raw, encodeMitsubishiHeavy152Raw, sendMitsubishiHeavy152, decodeMitsubishiHeavy152, parseMitsubishiHeavy152State,
  MitsubishiHeavy152Mode, MitsubishiHeavy152Fan, MitsubishiHeavy152SwingV, MitsubishiHeavy152SwingH,
} from "./protocols/mitsubishi_heavy152.js";
export type { MitsubishiHeavy152State, MitsubishiHeavy152ModeValue, MitsubishiHeavy152FanValue, MitsubishiHeavy152SwingVValue, MitsubishiHeavy152SwingHValue } from "./protocols/mitsubishi_heavy152.js";
export {
  buildMitsubishiHeavy88Raw, encodeMitsubishiHeavy88Raw, sendMitsubishiHeavy88, decodeMitsubishiHeavy88, parseMitsubishiHeavy88State,
  MitsubishiHeavy88Mode, MitsubishiHeavy88Fan, MitsubishiHeavy88SwingV, MitsubishiHeavy88SwingH,
} from "./protocols/mitsubishi_heavy88.js";
export type { MitsubishiHeavy88State, MitsubishiHeavy88ModeValue, MitsubishiHeavy88FanValue, MitsubishiHeavy88SwingVValue, MitsubishiHeavy88SwingHValue } from "./protocols/mitsubishi_heavy88.js";
export { encodeBluestarHeavyRaw, sendBluestarHeavy, decodeBluestarHeavy, BLUESTAR_HEAVY_STATE_LENGTH } from "./protocols/bluestar_heavy.js";
