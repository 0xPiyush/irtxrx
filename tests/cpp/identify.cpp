// Identify an unknown IR capture by running it through EVERY protocol decoder
// in IRremoteESP8266 (built with _IR_ENABLE_DEFAULT_=true).
//
// Usage:  ./identify "<csv_edges_usec>"
// Prints the matched protocol name, bit count, and decoded value/state — or
// FAIL if nothing matched. Trailing zeros in the capture are treated as the
// end of data, and a synthetic inter-message gap is appended so a clipped
// capture (one that ends on a mark with no trailing space) can still match a
// protocol footer.

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "IRrecv.h"
#include "IRutils.h"

int main(int argc, char* argv[]) {
  if (argc < 2) {
    fprintf(stderr, "Usage: identify \"<csv_edges_usec>\"\n");
    return 1;
  }

  static uint16_t rawbuf[2048];
  uint16_t n = 0;
  const char* p = argv[1];
  while (*p && n < 2044) {
    char* end;
    long v = strtol(p, &end, 10);
    if (end == p) break;
    if (v <= 0) break;  // trailing zero padding => end of capture
    long ticks = v / kRawTick;
    rawbuf[++n] = static_cast<uint16_t>(ticks > UINT16_MAX ? UINT16_MAX : ticks);
    p = end;
    while (*p == ',' || *p == ' ') p++;
  }

  if (n == 0) {
    printf("FAIL (no edges)\n");
    return 0;
  }

  // Append a large synthetic gap so a clipped final mark still has a footer
  // space to match against (≈100 ms).
  rawbuf[++n] = static_cast<uint16_t>(100000 / kRawTick);

  decode_results results;
  results.rawbuf = rawbuf;
  results.rawlen = n + 1;
  results.overflow = false;
  results.decode_type = UNKNOWN;

  IRrecv irrecv(4);
  // Match irtxrx's decode tolerance. irtxrx widens several families (notably
  // the Hitachi A/C protocols) from the C++ default 25% to 30% because real
  // hardware captures drift well past 25%; without this, identify reports
  // UNKNOWN for signals irtxrx decodes fine (e.g. HITACHI_AC296 / AC3).
  irrecv.setTolerance(30);
  // strictly=false so non-strict decoders (e.g. variable-length) get a chance.
  if (!irrecv.decode(&results)) {
    printf("FAIL (no protocol matched %u edges)\n", static_cast<unsigned>(n - 1));
    return 0;
  }

  printf("protocol: %s\n", typeToString(results.decode_type, false).c_str());
  printf("bits: %u\n", static_cast<unsigned>(results.bits));
  if (hasACState(results.decode_type)) {
    printf("state: ");
    for (uint16_t i = 0; i < results.bits / 8; i++)
      printf("%02X", results.state[i]);
    printf("\n");
  } else {
    printf("value: 0x%llX\n", static_cast<unsigned long long>(results.value));
    printf("address: 0x%llX  command: 0x%llX\n",
           static_cast<unsigned long long>(results.address),
           static_cast<unsigned long long>(results.command));
  }
  return 0;
}
