/**
 * Cross-validation runner for irtx.
 *
 * Compiles against the vendored IRremoteESP8266 and outputs raw IR timings
 * so the TypeScript test suite can compare them to irtx output.
 *
 * Usage:
 *   runner sendNEC <data_hex> <nbits> [repeat]
 *   runner encodeNEC <address_dec> <command_dec>
 *   runner sendDaikin64 <data_hex> [repeat]
 *   runner daikin64 <power> <temp> <mode> <fan> <swingV> <sleep> <clock>
 *
 * Output (send*):     comma-separated uint32 timings on stdout
 * Output (encode*):   single uint32 on stdout
 * Output (daikin64):  raw_hex,timing1,timing2,...  (hex state + timings)
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cinttypes>
#include "IRsend_test.h"
#include "ir_Daikin.h"

/// Print the output[] array as comma-separated values.
static void printTimings(IRsendTest& irsend) {
    for (uint16_t i = 0; i <= irsend.last; i++) {
        if (i > 0) printf(",");
        printf("%" PRIu32, irsend.output[i]);
    }
    printf("\n");
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: runner <function> [args...]\n");
        return 1;
    }

    const char* fn = argv[1];

    // ----- NEC -----

    if (strcmp(fn, "sendNEC") == 0) {
        if (argc < 4) {
            fprintf(stderr, "Usage: runner sendNEC <data_hex> <nbits> [repeat]\n");
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t nbits = static_cast<uint16_t>(atoi(argv[3]));
        uint16_t repeat = argc > 4 ? static_cast<uint16_t>(atoi(argv[4])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendNEC(data, nbits, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "encodeNEC") == 0) {
        if (argc < 4) {
            fprintf(stderr, "Usage: runner encodeNEC <address_dec> <command_dec>\n");
            return 1;
        }
        uint16_t address = static_cast<uint16_t>(atoi(argv[2]));
        uint16_t command = static_cast<uint16_t>(atoi(argv[3]));

        IRsendTest irsend(4);
        irsend.begin();
        uint32_t result = irsend.encodeNEC(address, command);
        printf("%" PRIu32 "\n", result);
        return 0;
    }

    // ----- Daikin64 raw send -----

    if (strcmp(fn, "sendDaikin64") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendDaikin64 <data_hex> [repeat]\n");
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendDaikin64(data, kDaikin64Bits, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Daikin64 via class setters -----

    if (strcmp(fn, "daikin64") == 0) {
        // Args: power temp mode fan swingV sleep clock
        if (argc < 9) {
            fprintf(stderr,
                "Usage: runner daikin64 <power> <temp> <mode> <fan> "
                "<swingV> <sleep> <clock>\n");
            return 1;
        }
        bool power    = atoi(argv[2]) != 0;
        uint8_t temp  = static_cast<uint8_t>(atoi(argv[3]));
        uint8_t mode  = static_cast<uint8_t>(atoi(argv[4]));
        uint8_t fan   = static_cast<uint8_t>(atoi(argv[5]));
        bool swingV   = atoi(argv[6]) != 0;
        bool sleep    = atoi(argv[7]) != 0;
        uint16_t clock = static_cast<uint16_t>(atoi(argv[8]));

        IRDaikin64 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setPowerToggle(power);
        ac.setTemp(temp);
        ac.setMode(mode);
        ac.setFan(fan);
        ac.setSwingVertical(swingV);
        ac.setSleep(sleep);
        ac.setClock(clock);

        uint64_t raw = ac.getRaw();
        ac.send();

        // Output: raw_hex then timings
        printf("%016" PRIX64 "\n", raw);
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Daikin152 via class setters -----

    if (strcmp(fn, "daikin152") == 0) {
        // Args: power temp mode fan swingV quiet powerful econo sensor comfort
        if (argc < 12) {
            fprintf(stderr,
                "Usage: runner daikin152 <power> <temp> <mode> <fan> "
                "<swingV> <quiet> <powerful> <econo> <sensor> <comfort>\n");
            return 1;
        }
        bool power    = atoi(argv[2]) != 0;
        uint8_t temp  = static_cast<uint8_t>(atoi(argv[3]));
        uint8_t mode  = static_cast<uint8_t>(atoi(argv[4]));
        uint8_t fan   = static_cast<uint8_t>(atoi(argv[5]));
        bool swingV   = atoi(argv[6]) != 0;
        bool quiet    = atoi(argv[7]) != 0;
        bool powerful = atoi(argv[8]) != 0;
        bool econo    = atoi(argv[9]) != 0;
        bool sensor   = atoi(argv[10]) != 0;
        bool comfort  = atoi(argv[11]) != 0;

        IRDaikin152 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(mode);
        ac.setTemp(temp);
        ac.setFan(fan);
        ac.setSwingV(swingV);
        ac.setPower(power);
        ac.setQuiet(quiet);
        ac.setPowerful(powerful);
        ac.setEcono(econo);
        ac.setSensor(sensor);
        ac.setComfort(comfort);

        uint8_t* raw = ac.getRaw();
        ac.send();

        // Output: raw bytes as hex, then timings
        for (int i = 0; i < kDaikin152StateLength; i++)
            printf("%02X", raw[i]);
        printf("\n");
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Daikin152 raw send -----

    if (strcmp(fn, "sendDaikin152") == 0) {
        // Args: hex-encoded bytes (e.g. "11DA2700...")
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendDaikin152 <hex_bytes>\n");
            return 1;
        }
        const char* hex = argv[2];
        size_t hexlen = strlen(hex);
        uint16_t nbytes = static_cast<uint16_t>(hexlen / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) {
            unsigned int byte;
            sscanf(hex + i * 2, "%2x", &byte);
            data[i] = static_cast<uint8_t>(byte);
        }

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendDaikin152(data, nbytes, 0);
        printTimings(irsend);
        return 0;
    }

    // ----- Daikin216 via class setters -----

    if (strcmp(fn, "daikin216") == 0) {
        if (argc < 9) {
            fprintf(stderr, "Usage: runner daikin216 <power> <temp> <mode> <fan> <swingV> <swingH> <powerful>\n");
            return 1;
        }
        IRDaikin216 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(atoi(argv[6]) != 0);
        ac.setSwingHorizontal(atoi(argv[7]) != 0);
        ac.setPowerful(atoi(argv[8]) != 0);
        ac.setPower(atoi(argv[2]) != 0);

        uint8_t* raw = ac.getRaw();
        ac.send();
        for (int i = 0; i < kDaikin216StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Daikin160 via class setters -----

    if (strcmp(fn, "daikin160") == 0) {
        if (argc < 7) {
            fprintf(stderr, "Usage: runner daikin160 <power> <temp> <mode> <fan> <swingV>\n");
            return 1;
        }
        IRDaikin160 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(static_cast<uint8_t>(atoi(argv[6])));
        ac.setPower(atoi(argv[2]) != 0);

        uint8_t* raw = ac.getRaw();
        ac.send();
        for (int i = 0; i < kDaikin160StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Daikin176 via class setters -----

    if (strcmp(fn, "daikin176") == 0) {
        if (argc < 8) {
            fprintf(stderr, "Usage: runner daikin176 <power> <temp> <mode> <fan> <swingH> <id>\n");
            return 1;
        }
        IRDaikin176 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingHorizontal(static_cast<uint8_t>(atoi(argv[6])));
        ac.setPower(atoi(argv[2]) != 0);
        ac.setId(static_cast<uint8_t>(atoi(argv[7])));

        uint8_t* raw = ac.getRaw();
        ac.send();
        for (int i = 0; i < kDaikin176StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        printTimings(ac._irsend);
        return 0;
    }

    fprintf(stderr, "Unknown function: %s\n", fn);
    return 1;
}
