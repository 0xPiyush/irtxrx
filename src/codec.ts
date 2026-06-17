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
import { sendKelvinator } from "./protocols/kelvinator.js";
import type { KelvinatorState } from "./protocols/kelvinator.js";
import { sendMidea } from "./protocols/midea.js";
import type { MideaState } from "./protocols/midea.js";
import { encodeMidea24 } from "./protocols/midea24.js";
import { sendElectraAc } from "./protocols/electra_ac.js";
import type { ElectraAcState } from "./protocols/electra_ac.js";
import { sendVestelAc } from "./protocols/vestel_ac.js";
import type { VestelAcState } from "./protocols/vestel_ac.js";
import { sendTrotec, sendTrotec3550 } from "./protocols/trotec.js";
import type { TrotecState, Trotec3550State } from "./protocols/trotec.js";
import { sendNeoclima } from "./protocols/neoclima.js";
import type { NeoclimaState } from "./protocols/neoclima.js";
import { sendAirton } from "./protocols/airton.js";
import type { AirtonState } from "./protocols/airton.js";
import { sendDelonghiAc } from "./protocols/delonghi_ac.js";
import type { DelonghiAcState } from "./protocols/delonghi_ac.js";
import { encodeGorenje } from "./protocols/gorenje.js";
import { encodeWhynter } from "./protocols/whynter.js";
import { sendTruma } from "./protocols/truma.js";
import type { TrumaState } from "./protocols/truma.js";
import { sendAmcor } from "./protocols/amcor.js";
import type { AmcorState } from "./protocols/amcor.js";
import { sendRhoss } from "./protocols/rhoss.js";
import type { RhossState } from "./protocols/rhoss.js";
import { sendTechnibelAc } from "./protocols/technibel_ac.js";
import type { TechnibelAcState } from "./protocols/technibel_ac.js";
import { sendEcoclim } from "./protocols/ecoclim.js";
import type { EcoclimState } from "./protocols/ecoclim.js";
import { sendCoronaAc } from "./protocols/corona_ac.js";
import type { CoronaAcState } from "./protocols/corona_ac.js";
import { sendAirwell } from "./protocols/airwell.js";
import type { AirwellState } from "./protocols/airwell.js";
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
import { sendToshibaAc } from "./protocols/toshiba_ac.js";
import type { ToshibaAcState } from "./protocols/toshiba_ac.js";
import { sendSharp } from "./protocols/sharp.js";
import type { SharpState } from "./protocols/sharp.js";
import { sendSharpAc } from "./protocols/sharp_ac.js";
import type { SharpAcState } from "./protocols/sharp_ac.js";
import { sendSanyoLc7461 } from "./protocols/sanyo_lc7461.js";
import type { SanyoLc7461State } from "./protocols/sanyo_lc7461.js";
import { sendSanyoAc } from "./protocols/sanyo_ac.js";
import type { SanyoAcState } from "./protocols/sanyo_ac.js";
import { sendSanyoAc88 } from "./protocols/sanyo_ac88.js";
import type { SanyoAc88State } from "./protocols/sanyo_ac88.js";
import { sendSanyoAc152 } from "./protocols/sanyo_ac152.js";
import { sendWhirlpoolAc } from "./protocols/whirlpool_ac.js";
import type { WhirlpoolAcState } from "./protocols/whirlpool_ac.js";
import { sendMitsubishiHeavy152 } from "./protocols/mitsubishi_heavy152.js";
import type { MitsubishiHeavy152State } from "./protocols/mitsubishi_heavy152.js";
import { sendMitsubishiHeavy88 } from "./protocols/mitsubishi_heavy88.js";
import type { MitsubishiHeavy88State } from "./protocols/mitsubishi_heavy88.js";
import { sendBluestarHeavy } from "./protocols/bluestar_heavy.js";
import { sendGoodweather } from "./protocols/goodweather.js";
import type { GoodweatherState } from "./protocols/goodweather.js";
import { sendTranscold } from "./protocols/transcold.js";
import type { TranscoldState } from "./protocols/transcold.js";
import { sendLloyd } from "./protocols/lloyd.js";
import type { LloydState } from "./protocols/lloyd.js";
import { sendFujitsu } from "./protocols/fujitsu.js";
import type { FujitsuState } from "./protocols/fujitsu.js";

/** The state shape each protocol's encoder accepts, keyed by protocol name. */
export interface ProtocolStateMap {
  coolix: CoolixState;
  /** Raw 48-bit Coolix48 code. */
  coolix48: bigint;
  gree: GreeState;
  kelvinator: KelvinatorState;
  midea: MideaState;
  /** Raw 24-bit Midea24 code. */
  midea24: bigint;
  electra_ac: ElectraAcState;
  vestel_ac: VestelAcState;
  trotec: TrotecState;
  trotec_3550: Trotec3550State;
  neoclima: NeoclimaState;
  airton: AirtonState;
  delonghi_ac: DelonghiAcState;
  /** Raw 8-bit Gorenje code. */
  gorenje: bigint;
  /** Raw 32-bit Whynter code. */
  whynter: bigint;
  truma: TrumaState;
  amcor: AmcorState;
  rhoss: RhossState;
  technibel_ac: TechnibelAcState;
  ecoclim: EcoclimState;
  corona_ac: CoronaAcState;
  airwell: AirwellState;
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
  toshiba_ac: ToshibaAcState;
  sharp: SharpState;
  sharp_ac: SharpAcState;
  sanyo_lc7461: SanyoLc7461State;
  sanyo_ac: SanyoAcState;
  sanyo_ac88: SanyoAc88State;
  /** Raw 19-byte payload. */
  sanyo_ac152: Uint8Array;
  whirlpool_ac: WhirlpoolAcState;
  mitsubishi_heavy152: MitsubishiHeavy152State;
  mitsubishi_heavy88: MitsubishiHeavy88State;
  /** Raw 13-byte payload. */
  bluestar_heavy: Uint8Array;
  goodweather: GoodweatherState;
  transcold: TranscoldState;
  lloyd: LloydState;
  fujitsu_ac: FujitsuState;
}

type EncoderMap = {
  [P in ProtocolName]: (state: ProtocolStateMap[P], repeat?: number) => number[];
};

const ENCODERS: EncoderMap = {
  coolix: (s, r) => sendCoolix(s, r),
  coolix48: (s, r) => encodeCoolix48(s, r),
  gree: (s, r) => sendGree(s, r),
  kelvinator: (s, r) => sendKelvinator(s, r),
  midea: (s, r) => sendMidea(s, r),
  midea24: (s, r) => encodeMidea24(s, r),
  electra_ac: (s, r) => sendElectraAc(s, r),
  vestel_ac: (s, r) => sendVestelAc(s, r),
  trotec: (s, r) => sendTrotec(s, r),
  trotec_3550: (s, r) => sendTrotec3550(s, r),
  neoclima: (s, r) => sendNeoclima(s, r),
  airton: (s, r) => sendAirton(s, r),
  delonghi_ac: (s, r) => sendDelonghiAc(s, r),
  gorenje: (s, r) => encodeGorenje(s, r),
  whynter: (s, r) => encodeWhynter(s, r),
  truma: (s, r) => sendTruma(s, r),
  amcor: (s, r) => sendAmcor(s, r),
  rhoss: (s, r) => sendRhoss(s, r),
  technibel_ac: (s, r) => sendTechnibelAc(s, r),
  ecoclim: (s, r) => sendEcoclim(s, r),
  corona_ac: (s, r) => sendCoronaAc(s, r),
  // Airwell's natural send repeats twice; the codec emits a single (decodable)
  // message unless an explicit repeat is requested.
  airwell: (s, r) => sendAirwell(s, r ?? 0),
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
  toshiba_ac: (s, r) => sendToshibaAc(s, r),
  sharp: (s, r) => sendSharp(s, r),
  sharp_ac: (s, r) => sendSharpAc(s, r),
  sanyo_lc7461: (s, r) => sendSanyoLc7461(s, r),
  sanyo_ac: (s, r) => sendSanyoAc(s, r),
  sanyo_ac88: (s, r) => sendSanyoAc88(s, r),
  sanyo_ac152: (s, r) => sendSanyoAc152(s, r),
  whirlpool_ac: (s, r) => sendWhirlpoolAc(s, r),
  mitsubishi_heavy152: (s, r) => sendMitsubishiHeavy152(s, r),
  mitsubishi_heavy88: (s, r) => sendMitsubishiHeavy88(s, r),
  bluestar_heavy: (s, r) => sendBluestarHeavy(s, r),
  goodweather: (s, r) => sendGoodweather(s, r),
  transcold: (s, r) => sendTranscold(s, r),
  lloyd: (s, r) => sendLloyd(s, r),
  fujitsu_ac: (s, r) => sendFujitsu(s, r),
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
