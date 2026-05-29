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
import { sendTcl96 } from "./protocols/tcl96.js";
import { sendNEC, encodeNEC } from "./protocols/nec.js";

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
  /** Raw 12-byte payload. */
  tcl96: Uint8Array;
  /** NEC re-encodes from the decoded address + command. */
  nec: { address: number; command: number };
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
  tcl96: (s, r) => sendTcl96(s, r),
  nec: (s, r) => sendNEC(encodeNEC(s.address, s.command), undefined, r),
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
