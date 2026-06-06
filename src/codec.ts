/**
 * Generic encode dispatcher — the symmetric counterpart to {@link decode}.
 *
 * `decode()` turns timings into `{ protocol, state }`; `encode(protocol, state)`
 * turns that pair back into timings, dispatching to the right protocol encoder.
 * This lets a consumer round-trip a decoded (or stored) result without
 * hand-maintaining a protocol→encoder table.
 *
 * The `state` argument is typed per protocol via {@link ProtocolStateMap}, so
 * `encode("daikin152", state)` type-checks `state` as a `Daikin152State`.
 */

import type { ProtocolName } from "./decode.js";

import { sendCoolix } from "./protocols/coolix.js";
import type { CoolixState } from "./protocols/coolix.js";
import { encodeCoolix48 } from "./protocols/coolix48.js";
import { sendGree } from "./protocols/gree.js";
import type { GreeState } from "./protocols/gree.js";
import { sendKelon } from "./protocols/kelon.js";
import type { KelonState } from "./protocols/kelon.js";
import { sendKelon168 } from "./protocols/kelon168.js";
import type { Kelon168State } from "./protocols/kelon168.js";
import { sendTeco } from "./protocols/teco.js";
import type { TecoState } from "./protocols/teco.js";
import { sendMitsubishi } from "./protocols/mitsubishi.js";
import type { MitsubishiState } from "./protocols/mitsubishi.js";
import { sendMitsubishi2 } from "./protocols/mitsubishi2.js";
import type { Mitsubishi2State } from "./protocols/mitsubishi2.js";
import { sendMitsubishiAc } from "./protocols/mitsubishi_ac.js";
import type { MitsubishiAcState } from "./protocols/mitsubishi_ac.js";
import { sendMitsubishi136 } from "./protocols/mitsubishi136.js";
import type { Mitsubishi136State } from "./protocols/mitsubishi136.js";
import { sendMitsubishi112 } from "./protocols/mitsubishi112.js";
import type { Mitsubishi112State } from "./protocols/mitsubishi112.js";
import { sendGodrej } from "./protocols/godrej.js";
import type { GodrejState } from "./protocols/godrej.js";
import { sendDaikin64 } from "./protocols/daikin64.js";
import type { Daikin64State } from "./protocols/daikin64.js";
import { sendDaikin128 } from "./protocols/daikin128.js";
import type { Daikin128State } from "./protocols/daikin128.js";
import { sendDaikin152 } from "./protocols/daikin152.js";
import type { Daikin152State } from "./protocols/daikin152.js";
import { sendDaikin160 } from "./protocols/daikin160.js";
import type { Daikin160State } from "./protocols/daikin160.js";
import { sendDaikin176 } from "./protocols/daikin176.js";
import type { Daikin176State } from "./protocols/daikin176.js";
import { sendDaikin216 } from "./protocols/daikin216.js";
import type { Daikin216State } from "./protocols/daikin216.js";
import { sendDaikinESP } from "./protocols/daikin.js";
import type { DaikinESPState } from "./protocols/daikin.js";
import { sendDaikin2 } from "./protocols/daikin2.js";
import type { Daikin2State } from "./protocols/daikin2.js";
import { sendDaikin312 } from "./protocols/daikin312.js";
import type { Daikin312State } from "./protocols/daikin312.js";
import { sendVoltas } from "./protocols/voltas.js";
import type { VoltasState } from "./protocols/voltas.js";
import { sendHitachiAc } from "./protocols/hitachi.js";
import type { HitachiAcState } from "./protocols/hitachi.js";
import { sendHitachiAc1 } from "./protocols/hitachi1.js";
import type { HitachiAc1State } from "./protocols/hitachi1.js";
import { sendHitachiAc424 } from "./protocols/hitachi424.js";
import type { HitachiAc424State } from "./protocols/hitachi424.js";
import { sendHitachiAc264 } from "./protocols/hitachi264.js";
import type { HitachiAc264State } from "./protocols/hitachi264.js";
import { sendHitachiAc344 } from "./protocols/hitachi344.js";
import type { HitachiAc344State } from "./protocols/hitachi344.js";
import { sendHitachiAc296 } from "./protocols/hitachi296.js";
import type { HitachiAc296State } from "./protocols/hitachi296.js";
import { sendHitachiAc3 } from "./protocols/hitachi3.js";
import { sendTcl112 } from "./protocols/tcl112.js";
import type { Tcl112State } from "./protocols/tcl112.js";
import { sendTeknopoint } from "./protocols/teknopoint.js";
import type { TeknopointState } from "./protocols/teknopoint.js";
import { sendTcl96 } from "./protocols/tcl96.js";
import { sendNEC, encodeNEC } from "./protocols/nec.js";
import { sendPanasonic } from "./protocols/panasonic.js";
import type { PanasonicState } from "./protocols/panasonic.js";
import { sendPanasonicAc32 } from "./protocols/panasonic_ac32.js";
import type { PanasonicAc32State } from "./protocols/panasonic_ac32.js";
import { sendPanasonicAc } from "./protocols/panasonic_ac.js";
import type { PanasonicAcState } from "./protocols/panasonic_ac.js";
import { sendSamsung } from "./protocols/samsung.js";
import type { SamsungState } from "./protocols/samsung.js";
import { sendSamsung36 } from "./protocols/samsung36.js";
import type { Samsung36State } from "./protocols/samsung36.js";
import { sendSamsungAc } from "./protocols/samsung_ac.js";
import type { SamsungAcState } from "./protocols/samsung_ac.js";
import { sendLg } from "./protocols/lg.js";
import type { LgState } from "./protocols/lg.js";
import { sendLgAc } from "./protocols/lg_ac.js";
import type { LgAcState } from "./protocols/lg_ac.js";
import { sendCarrierAc } from "./protocols/carrier_ac.js";
import type { CarrierAcState } from "./protocols/carrier_ac.js";
import { sendCarrierAc40 } from "./protocols/carrier_ac40.js";
import type { CarrierAc40State } from "./protocols/carrier_ac40.js";
import { sendCarrierAc64 } from "./protocols/carrier_ac64.js";
import type { CarrierAc64State } from "./protocols/carrier_ac64.js";
import { sendCarrierAc84 } from "./protocols/carrier_ac84.js";
import { sendCarrierAc128 } from "./protocols/carrier_ac128.js";
import { sendHaierAc } from "./protocols/haier_ac.js";
import type { HaierAcState } from "./protocols/haier_ac.js";
import { sendHaierAcYrw02 } from "./protocols/haier_ac_yrw02.js";
import type { HaierAcYrw02State } from "./protocols/haier_ac_yrw02.js";
import { sendHaierAc160 } from "./protocols/haier_ac160.js";
import type { HaierAc160State } from "./protocols/haier_ac160.js";
import { sendHaierAc176 } from "./protocols/haier_ac176.js";
import type { HaierAc176State } from "./protocols/haier_ac176.js";

/** The state shape each protocol's encoder accepts, keyed by protocol name. */
export interface ProtocolStateMap {
  coolix: CoolixState;
  /** Raw 48-bit Coolix48 code. */
  coolix48: bigint;
  gree: GreeState;
  kelon: KelonState;
  kelon168: Kelon168State;
  teco: TecoState;
  mitsubishi: MitsubishiState;
  mitsubishi2: Mitsubishi2State;
  mitsubishi_ac: MitsubishiAcState;
  mitsubishi136: Mitsubishi136State;
  mitsubishi112: Mitsubishi112State;
  godrej: GodrejState;
  daikin64: Daikin64State;
  daikin128: Daikin128State;
  daikin152: Daikin152State;
  daikin160: Daikin160State;
  daikin176: Daikin176State;
  daikin216: Daikin216State;
  daikin: DaikinESPState;
  daikin2: Daikin2State;
  daikin312: Daikin312State;
  voltas: VoltasState;
  hitachi_ac: HitachiAcState;
  hitachi_ac1: HitachiAc1State;
  hitachi_ac424: HitachiAc424State;
  hitachi_ac264: HitachiAc264State;
  hitachi_ac344: HitachiAc344State;
  hitachi_ac296: HitachiAc296State;
  /** Raw 15/17/21/23/27-byte payload. */
  hitachi_ac3: Uint8Array;
  tcl112: Tcl112State;
  teknopoint: TeknopointState;
  /** Raw 12-byte payload. */
  tcl96: Uint8Array;
  /** NEC re-encodes from the decoded address + command. */
  nec: { address: number; command: number };
  panasonic: PanasonicState;
  panasonic_ac: PanasonicAcState;
  panasonic_ac32: PanasonicAc32State;
  samsung: SamsungState;
  samsung36: Samsung36State;
  samsung_ac: SamsungAcState;
  lg: LgState;
  lg_ac: LgAcState;
  carrier_ac: CarrierAcState;
  carrier_ac40: CarrierAc40State;
  carrier_ac64: CarrierAc64State;
  /** Raw 11-byte payload. */
  carrier_ac84: Uint8Array;
  /** Raw 16-byte payload. */
  carrier_ac128: Uint8Array;
  haier_ac: HaierAcState;
  haier_ac_yrw02: HaierAcYrw02State;
  haier_ac160: HaierAc160State;
  haier_ac176: HaierAc176State;
}

type EncoderMap = {
  [P in ProtocolName]: (state: ProtocolStateMap[P], repeat?: number) => number[];
};

const ENCODERS: EncoderMap = {
  coolix: (s, r) => sendCoolix(s, r),
  coolix48: (s, r) => encodeCoolix48(s, r),
  gree: (s, r) => sendGree(s, r),
  kelon: (s, r) => sendKelon(s, r),
  kelon168: (s, r) => sendKelon168(s, r),
  teco: (s, r) => sendTeco(s, r),
  mitsubishi: (s, r) => sendMitsubishi(s, r),
  mitsubishi2: (s, r) => sendMitsubishi2(s, r),
  mitsubishi_ac: (s, r) => sendMitsubishiAc(s, r),
  mitsubishi136: (s, r) => sendMitsubishi136(s, r),
  mitsubishi112: (s, r) => sendMitsubishi112(s, r),
  godrej: (s, r) => sendGodrej(s, r),
  daikin64: (s, r) => sendDaikin64(s, r),
  daikin128: (s, r) => sendDaikin128(s, r),
  daikin152: (s, r) => sendDaikin152(s, r),
  daikin160: (s, r) => sendDaikin160(s, r),
  daikin176: (s, r) => sendDaikin176(s, r),
  daikin216: (s, r) => sendDaikin216(s, r),
  daikin: (s, r) => sendDaikinESP(s, r),
  daikin2: (s, r) => sendDaikin2(s, r),
  daikin312: (s, r) => sendDaikin312(s, r),
  voltas: (s, r) => sendVoltas(s, r),
  hitachi_ac: (s, r) => sendHitachiAc(s, r),
  hitachi_ac1: (s, r) => sendHitachiAc1(s, r),
  hitachi_ac424: (s, r) => sendHitachiAc424(s, r),
  hitachi_ac264: (s, r) => sendHitachiAc264(s, r),
  hitachi_ac344: (s, r) => sendHitachiAc344(s, r),
  hitachi_ac296: (s, r) => sendHitachiAc296(s, r),
  hitachi_ac3: (s, r) => sendHitachiAc3(s, r),
  tcl112: (s, r) => sendTcl112(s, r),
  teknopoint: (s, r) => sendTeknopoint(s, r),
  tcl96: (s, r) => sendTcl96(s, r),
  nec: (s, r) => sendNEC(encodeNEC(s.address, s.command), undefined, r),
  panasonic: (s, r) => sendPanasonic(s, r),
  panasonic_ac: (s, r) => sendPanasonicAc(s, r),
  panasonic_ac32: (s, r) => sendPanasonicAc32(s, r),
  samsung: (s, r) => sendSamsung(s, r),
  samsung36: (s, r) => sendSamsung36(s, r),
  samsung_ac: (s, r) => sendSamsungAc(s, r),
  lg: (s, r) => sendLg(s, r),
  lg_ac: (s, r) => sendLgAc(s, r),
  carrier_ac: (s, r) => sendCarrierAc(s, r),
  carrier_ac40: (s, r) => sendCarrierAc40(s, r),
  carrier_ac64: (s, r) => sendCarrierAc64(s, r),
  carrier_ac84: (s, r) => sendCarrierAc84(s, r),
  carrier_ac128: (s, r) => sendCarrierAc128(s, r),
  haier_ac: (s, r) => sendHaierAc(s, r),
  haier_ac_yrw02: (s, r) => sendHaierAcYrw02(s, r),
  haier_ac160: (s, r) => sendHaierAc160(s, r),
  haier_ac176: (s, r) => sendHaierAc176(s, r),
};

/**
 * Encode an appliance state into raw IR timings for the given protocol.
 *
 * The inverse of {@link decode}: feed a decoded result's `protocol` and `state`
 * straight back in to reproduce the timings.
 *
 * @param protocol The protocol name (as returned by `decode`).
 * @param state    The protocol's state object (see {@link ProtocolStateMap}).
 * @param repeat   Extra repeats; omit to use the protocol's own default.
 * @returns Flat mark/space timing array in microseconds.
 * @throws If `protocol` is not a known encodable protocol.
 */
export function encode<P extends ProtocolName>(
  protocol: P,
  state: ProtocolStateMap[P],
  repeat?: number,
): number[] {
  const encoder = (ENCODERS as Record<string, (s: unknown, r?: number) => number[]>)[protocol];
  if (!encoder) throw new Error(`irtxrx: cannot encode unknown protocol "${protocol}"`);
  return encoder(state, repeat);
}

/** Whether a protocol name can be encoded by {@link encode}. */
export function canEncode(protocol: string): protocol is ProtocolName {
  return protocol in ENCODERS;
}
