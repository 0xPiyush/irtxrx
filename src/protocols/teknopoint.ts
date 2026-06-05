/**
 * Teknopoint A/C protocol encoder and decoder. (TEKNOPOINT)
 *
 * Ported from IRremoteESP8266 `ir_Teknopoint.cpp`.
 * Models: Teknopoint Allegro SSA-09H, GZ-055B-E1 / GZ01-BEJ0-000 remotes.
 *
 * Teknopoint reuses the TCL112AC message *byte-for-byte* — same 14-byte layout,
 * fixed 0x23CB26 prefix, byte-sum checksum, and field encoding — and is in fact
 * driven by IRremoteESP8266's `IRTcl112Ac` class (model `GZ055BE1`). The only
 * differences are the wire timings and a wider decode tolerance, so this module
 * reuses TCL112's state shape and bit-packing logic and supplies only the
 * Teknopoint framing.
 *
 * Wire format: 3600/1600 header + 14 bytes (LSB-first) + footer.
 *
 * @see https://github.com/crankyoldgit/IRremoteESP8266/issues/1486
 */

import { sendGenericBytes } from "../encode.js";
import { matchGenericBytes, matchMark, matchSpace } from "../decode.js";
import {
  buildTcl112Raw,
  interpretTcl112Bytes,
  Tcl112Model,
} from "./tcl112.js";
import type { Tcl112State } from "./tcl112.js";

// ---------------------------------------------------------------------------
// Timing constants — must match ir_Teknopoint.cpp exactly
// ---------------------------------------------------------------------------

const HDR_MARK = 3600;
const HDR_SPACE = 1600;
const BIT_MARK = 477;
const ONE_SPACE = 1200;
const ZERO_SPACE = 530;
const GAP = 100000; // kDefaultMessageGap
/** Data tolerance — `_tolerance` (25%) + `kTeknopointExtraTol` (10%). */
const DATA_TOLERANCE = 35;

const STATE_LENGTH = 14;

// ---------------------------------------------------------------------------
// State / enums — identical to TCL112AC, re-exported under Teknopoint names
// ---------------------------------------------------------------------------

export {
  Tcl112Mode as TeknopointMode,
  Tcl112Fan as TeknopointFan,
  Tcl112SwingV as TeknopointSwingV,
  Tcl112Model as TeknopointModel,
} from "./tcl112.js";
export type {
  Tcl112State as TeknopointState,
  Tcl112ModeValue as TeknopointModeValue,
  Tcl112FanValue as TeknopointFanValue,
  Tcl112SwingVValue as TeknopointSwingVValue,
  Tcl112ModelValue as TeknopointModelValue,
} from "./tcl112.js";

// ---------------------------------------------------------------------------
// Build raw byte array
// ---------------------------------------------------------------------------

/**
 * Build the raw 14-byte Teknopoint state from a state object.
 *
 * Delegates to the shared TCL112AC bit-packing, defaulting the model to
 * `GZ055BE1` — the Teknopoint remote — rather than TCL's `TAC09CHSD`.
 */
export function buildTeknopointRaw(state: Tcl112State): Uint8Array {
  return buildTcl112Raw({ ...state, model: state.model ?? Tcl112Model.GZ055BE1 });
}

// ---------------------------------------------------------------------------
// Public encode API
// ---------------------------------------------------------------------------

/**
 * Encode a raw 14-byte Teknopoint state into IR timings.
 *
 * Matches IRremoteESP8266 `IRsend::sendTeknopoint` (LSB-first).
 */
export function encodeTeknopointRaw(data: Uint8Array, repeat: number = 0): number[] {
  return sendGenericBytes({
    headerMark: HDR_MARK,
    headerSpace: HDR_SPACE,
    oneMark: BIT_MARK,
    oneSpace: ONE_SPACE,
    zeroMark: BIT_MARK,
    zeroSpace: ZERO_SPACE,
    footerMark: BIT_MARK,
    gap: GAP,
    data,
    msbFirst: false,
    repeat,
  });
}

/** Encode a Teknopoint state into raw IR timings. */
export function sendTeknopoint(state: Tcl112State, repeat: number = 0): number[] {
  return encodeTeknopointRaw(buildTeknopointRaw(state), repeat);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode raw IR timings as a Teknopoint message.
 *
 * Validates the fixed 0x23CB26 prefix and the byte-sum checksum (shared with
 * TCL112AC). The 530µs zero-space distinguishes Teknopoint from the otherwise
 * similar TCL112AC frame (325µs zero-space).
 *
 * @returns Decoded state (same shape as encode input), or null on mismatch.
 */
export function decodeTeknopoint(
  timings: number[],
  offset: number = 0,
  headerOptional: boolean = false,
): Tcl112State | null {
  let pos = offset;

  let hasHeader = false;
  if (pos + 1 < timings.length &&
      matchMark(timings[pos]!, HDR_MARK, DATA_TOLERANCE) &&
      matchSpace(timings[pos + 1]!, HDR_SPACE, DATA_TOLERANCE)) {
    pos += 2;
    hasHeader = true;
  }
  if (!hasHeader && !headerOptional) return null;

  // Data + footer (header already consumed / intentionally skipped).
  const frame = matchGenericBytes(
    timings, pos, timings.length - pos, STATE_LENGTH,
    0, 0,
    BIT_MARK, ONE_SPACE, BIT_MARK, ZERO_SPACE,
    BIT_MARK, GAP,
    true, DATA_TOLERANCE, undefined, false,
    false,
  );
  if (!frame) return null;

  return interpretTcl112Bytes(frame.data);
}
