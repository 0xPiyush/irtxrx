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
#include "ir_Coolix.h"
#include "ir_Voltas.h"
#include "ir_Hitachi.h"
#include "ir_Tcl.h"
#include "IRrecv.h"
#include "IRutils.h"

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

    // ----- DaikinESP via class setters -----

    if (strcmp(fn, "daikin") == 0) {
        // Args: power temp mode fan swingV swingH quiet powerful econo mold comfort sensor
        if (argc < 14) {
            fprintf(stderr, "Usage: runner daikin <power> <temp> <mode> <fan> "
                "<swingV> <swingH> <quiet> <powerful> <econo> <mold> <comfort> <sensor>\n");
            return 1;
        }
        IRDaikinESP ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<float>(atof(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(atoi(argv[6]) != 0);
        ac.setSwingHorizontal(atoi(argv[7]) != 0);
        ac.setPower(atoi(argv[2]) != 0);
        ac.setQuiet(atoi(argv[8]) != 0);
        ac.setPowerful(atoi(argv[9]) != 0);
        ac.setEcono(atoi(argv[10]) != 0);
        ac.setMold(atoi(argv[11]) != 0);
        ac.setComfort(atoi(argv[12]) != 0);
        ac.setSensor(atoi(argv[13]) != 0);

        uint8_t* raw = ac.getRaw();
        ac.send();
        for (int i = 0; i < kDaikinStateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Daikin128 via class setters -----

    if (strcmp(fn, "daikin128") == 0) {
        // Args: power temp mode fan swingV sleep econo clock
        if (argc < 10) {
            fprintf(stderr, "Usage: runner daikin128 <power> <temp> <mode> <fan> "
                "<swingV> <sleep> <econo> <clock>\n");
            return 1;
        }
        IRDaikin128 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(atoi(argv[6]) != 0);
        ac.setSleep(atoi(argv[7]) != 0);
        ac.setEcono(atoi(argv[8]) != 0);
        ac.setClock(static_cast<uint16_t>(atoi(argv[9])));
        ac.setPowerToggle(atoi(argv[2]) != 0);

        uint8_t* raw = ac.getRaw();
        ac.send();
        for (int i = 0; i < kDaikin128StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Daikin2 via class setters -----

    if (strcmp(fn, "daikin2") == 0) {
        // Args: power temp mode fan swingV swingH quiet powerful econo
        if (argc < 11) {
            fprintf(stderr, "Usage: runner daikin2 <power> <temp> <mode> <fan> "
                "<swingV> <swingH> <quiet> <powerful> <econo>\n");
            return 1;
        }
        IRDaikin2 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwingHorizontal(static_cast<uint8_t>(atoi(argv[7])));
        ac.setPower(atoi(argv[2]) != 0);
        ac.setQuiet(atoi(argv[8]) != 0);
        ac.setPowerful(atoi(argv[9]) != 0);
        ac.setEcono(atoi(argv[10]) != 0);

        uint8_t* raw = ac.getRaw();
        ac.send();
        for (int i = 0; i < kDaikin2StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Daikin312 via class setters -----

    if (strcmp(fn, "daikin312") == 0) {
        if (argc < 11) {
            fprintf(stderr, "Usage: runner daikin312 <power> <temp> <mode> <fan> "
                "<swingV> <swingH> <quiet> <powerful> <econo>\n");
            return 1;
        }
        IRDaikin312 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<float>(atof(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwingHorizontal(static_cast<uint8_t>(atoi(argv[7])));
        ac.setPower(atoi(argv[2]) != 0);
        ac.setQuiet(atoi(argv[8]) != 0);
        ac.setPowerful(atoi(argv[9]) != 0);
        ac.setEcono(atoi(argv[10]) != 0);

        uint8_t* raw = ac.getRaw();
        ac.send();
        for (int i = 0; i < kDaikin312StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Coolix raw send -----

    if (strcmp(fn, "sendCoolix") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendCoolix <data_hex> [repeat]\n");
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 1;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendCOOLIX(data, kCoolixBits, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Coolix via class setters -----

    if (strcmp(fn, "coolix") == 0) {
        // Args: temp mode fan [sensorTemp]
        if (argc < 5) {
            fprintf(stderr, "Usage: runner coolix <temp> <mode> <fan> [sensorTemp]\n");
            return 1;
        }
        uint8_t temp  = static_cast<uint8_t>(atoi(argv[2]));
        uint8_t mode  = static_cast<uint8_t>(atoi(argv[3]));
        uint8_t fan   = static_cast<uint8_t>(atoi(argv[4]));

        IRCoolixAC ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(mode);
        if (mode != kCoolixFan) ac.setTemp(temp);
        ac.setFan(fan);
        if (argc > 5) {
            uint8_t sensorTemp = static_cast<uint8_t>(atoi(argv[5]));
            ac.setSensorTemp(sensorTemp);
        }

        uint32_t raw = ac.getRaw();
        ac.send();

        printf("%06X\n", raw);
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Voltas raw send -----

    if (strcmp(fn, "sendVoltas") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendVoltas <data_hex_20> [repeat]\n");
            return 1;
        }
        // Hex string of 20 chars (10 bytes)
        const char* hex = argv[2];
        if (strlen(hex) != 20) {
            fprintf(stderr, "sendVoltas: data must be exactly 20 hex chars\n");
            return 1;
        }
        uint8_t data[kVoltasStateLength];
        for (int i = 0; i < kVoltasStateLength; i++) {
            char buf[3] = { hex[i*2], hex[i*2+1], 0 };
            data[i] = static_cast<uint8_t>(strtoul(buf, nullptr, 16));
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendVoltas(data, kVoltasStateLength, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Voltas via class setters -----

    if (strcmp(fn, "voltas") == 0) {
        // Args: power temp mode fan swingV swingH turbo econo sleep light wifi onTime offTime model
        if (argc < 16) {
            fprintf(stderr, "Usage: runner voltas <power> <temp> <mode> <fan> <swingV> "
                "<swingH> <turbo> <econo> <sleep> <light> <wifi> <onTime> <offTime> <model>\n");
            return 1;
        }
        IRVoltas ac(4);
        ac.begin();
        ac.stateReset();
        ac.setModel(static_cast<voltas_ac_remote_model_t>(atoi(argv[15])));
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setPower(atoi(argv[2]) != 0);
        ac.setSwingV(atoi(argv[6]) != 0);
        ac.setSwingH(atoi(argv[7]) != 0);
        ac.setTurbo(atoi(argv[8]) != 0);
        ac.setEcono(atoi(argv[9]) != 0);
        ac.setSleep(atoi(argv[10]) != 0);
        ac.setLight(atoi(argv[11]) != 0);
        ac.setWifi(atoi(argv[12]) != 0);
        ac.setOnTime(static_cast<uint16_t>(atoi(argv[13])));
        ac.setOffTime(static_cast<uint16_t>(atoi(argv[14])));

        uint8_t* raw = ac.getRaw();
        ac.send();
        for (int i = 0; i < kVoltasStateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Hitachi AC (224-bit base) raw send -----

    if (strcmp(fn, "sendHitachiAc") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendHitachiAc <hex_bytes> [repeat]\n");
            return 1;
        }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) {
            unsigned int byte;
            sscanf(hex + i * 2, "%2x", &byte);
            data[i] = static_cast<uint8_t>(byte);
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendHitachiAC(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Hitachi AC (224-bit base) via class setters -----

    if (strcmp(fn, "hitachiAc") == 0) {
        // Args: power temp mode fan swingV swingH
        if (argc < 8) {
            fprintf(stderr, "Usage: runner hitachiAc <power> <temp> <mode> <fan> "
                "<swingV> <swingH>\n");
            return 1;
        }
        IRHitachiAc ac(4);
        ac.begin();
        ac.stateReset();
        uint8_t mode = static_cast<uint8_t>(atoi(argv[4]));
        ac.setMode(mode);
        if (mode != kHitachiAcFan) ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(atoi(argv[6]) != 0);
        ac.setSwingHorizontal(atoi(argv[7]) != 0);
        ac.setPower(atoi(argv[2]) != 0);

        uint8_t* raw = ac.getRaw();
        ac.send();
        for (int i = 0; i < kHitachiAcStateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Hitachi AC1 (104-bit) raw send -----

    if (strcmp(fn, "sendHitachiAc1") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendHitachiAc1 <hex_bytes> [repeat]\n");
            return 1;
        }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) {
            unsigned int byte;
            sscanf(hex + i * 2, "%2x", &byte);
            data[i] = static_cast<uint8_t>(byte);
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendHitachiAC1(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Hitachi AC1 (104-bit) via class setters -----

    if (strcmp(fn, "hitachiAc1") == 0) {
        // Args: power temp mode fan swingV swingH swingToggle sleep onTimer
        //       offTimer powerToggle model
        if (argc < 14) {
            fprintf(stderr, "Usage: runner hitachiAc1 <power> <temp> <mode> <fan> "
                "<swingV> <swingH> <swingToggle> <sleep> <onTimer> <offTimer> "
                "<powerToggle> <model>\n");
            return 1;
        }
        IRHitachiAc1 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setModel(static_cast<hitachi_ac1_remote_model_t>(atoi(argv[13])));
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingV(atoi(argv[6]) != 0);
        ac.setSwingH(atoi(argv[7]) != 0);
        ac.setSwingToggle(atoi(argv[8]) != 0);
        ac.setSleep(static_cast<uint8_t>(atoi(argv[9])));
        ac.setOffTimer(static_cast<uint16_t>(atoi(argv[11])));
        ac.setOnTimer(static_cast<uint16_t>(atoi(argv[10])));
        ac.setPower(atoi(argv[2]) != 0);
        ac.setPowerToggle(atoi(argv[12]) != 0);

        // Print raw BEFORE send(): send() clears the toggle bits afterwards.
        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kHitachiAc1StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        ac.send();
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Hitachi AC2 (424-bit) raw send -----

    if (strcmp(fn, "sendHitachiAc2") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendHitachiAc2 <hex_bytes> [repeat]\n");
            return 1;
        }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) {
            unsigned int byte;
            sscanf(hex + i * 2, "%2x", &byte);
            data[i] = static_cast<uint8_t>(byte);
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendHitachiAC2(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Hitachi AC424 (424-bit, leader) raw send -----

    if (strcmp(fn, "sendHitachiAc424") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendHitachiAc424 <hex_bytes> [repeat]\n");
            return 1;
        }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) {
            unsigned int byte;
            sscanf(hex + i * 2, "%2x", &byte);
            data[i] = static_cast<uint8_t>(byte);
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendHitachiAc424(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Hitachi AC424 via class setters -----

    if (strcmp(fn, "hitachiAc424") == 0) {
        // Args: power temp mode fan swingVToggle
        if (argc < 7) {
            fprintf(stderr, "Usage: runner hitachiAc424 <power> <temp> <mode> <fan> "
                "<swingVToggle>\n");
            return 1;
        }
        IRHitachiAc424 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setPower(atoi(argv[2]) != 0);
        ac.setSwingVToggle(atoi(argv[6]) != 0);

        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kHitachiAc424StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        ac.send();
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Hitachi AC264 via class setters -----

    if (strcmp(fn, "hitachiAc264") == 0) {
        // Args: power temp mode fan swingVToggle
        if (argc < 7) {
            fprintf(stderr, "Usage: runner hitachiAc264 <power> <temp> <mode> <fan> "
                "<swingVToggle>\n");
            return 1;
        }
        IRHitachiAc264 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setPower(atoi(argv[2]) != 0);
        ac.setSwingVToggle(atoi(argv[6]) != 0);

        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kHitachiAc264StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        ac.send();
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Hitachi AC344 via class setters -----

    if (strcmp(fn, "hitachiAc344") == 0) {
        // Args: power temp mode fan swingV swingH
        if (argc < 8) {
            fprintf(stderr, "Usage: runner hitachiAc344 <power> <temp> <mode> <fan> "
                "<swingV> <swingH>\n");
            return 1;
        }
        IRHitachiAc344 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingV(atoi(argv[6]) != 0);
        ac.setSwingH(static_cast<uint8_t>(atoi(argv[7])));
        ac.setPower(atoi(argv[2]) != 0);

        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kHitachiAc344StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        ac.send();
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Hitachi AC296 via class setters -----

    if (strcmp(fn, "hitachiAc296") == 0) {
        // Args: power temp mode fan
        if (argc < 6) {
            fprintf(stderr, "Usage: runner hitachiAc296 <power> <temp> <mode> <fan>\n");
            return 1;
        }
        IRHitachiAc296 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setPower(atoi(argv[2]) != 0);

        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kHitachiAc296StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        ac.send();
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Hitachi AC3 (variable length) raw send -----

    if (strcmp(fn, "sendHitachiAc3") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendHitachiAc3 <hex_bytes> [repeat]\n");
            return 1;
        }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) {
            unsigned int byte;
            sscanf(hex + i * 2, "%2x", &byte);
            data[i] = static_cast<uint8_t>(byte);
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendHitachiAc3(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- TCL112AC raw send -----

    if (strcmp(fn, "sendTcl112Ac") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendTcl112Ac <hex_bytes> [repeat]\n");
            return 1;
        }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) {
            unsigned int byte;
            sscanf(hex + i * 2, "%2x", &byte);
            data[i] = static_cast<uint8_t>(byte);
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendTcl112Ac(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- TCL112AC via class setters -----

    if (strcmp(fn, "tcl112") == 0) {
        // Args: power temp mode fan swingV swingH econo health light turbo
        //       onTimer offTimer model
        if (argc < 15) {
            fprintf(stderr, "Usage: runner tcl112 <power> <temp> <mode> <fan> "
                "<swingV> <swingH> <econo> <health> <light> <turbo> "
                "<onTimer> <offTimer> <model>\n");
            return 1;
        }
        IRTcl112Ac ac(4);
        ac.begin();
        ac.stateReset();
        ac.setModel(static_cast<tcl_ac_remote_model_t>(atoi(argv[14])));
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<float>(atof(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwingHorizontal(atoi(argv[7]) != 0);
        ac.setEcono(atoi(argv[8]) != 0);
        ac.setHealth(atoi(argv[9]) != 0);
        ac.setLight(atoi(argv[10]) != 0);
        ac.setTurbo(atoi(argv[11]) != 0);
        ac.setOnTimer(static_cast<uint16_t>(atoi(argv[12])));
        ac.setOffTimer(static_cast<uint16_t>(atoi(argv[13])));
        ac.setPower(atoi(argv[2]) != 0);

        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kTcl112AcStateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        ac.send();
        printTimings(ac._irsend);
        return 0;
    }

    // ----- TCL96AC raw send -----

    if (strcmp(fn, "sendTcl96Ac") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendTcl96Ac <hex_bytes> [repeat]\n");
            return 1;
        }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) {
            unsigned int byte;
            sscanf(hex + i * 2, "%2x", &byte);
            data[i] = static_cast<uint8_t>(byte);
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendTcl96Ac(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Generic decode: feed raw timings into IRrecv::decode -----
    // Prints "<PROTOCOL_NAME>\n<state_hex>" or "FAIL".

    if (strcmp(fn, "decode") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner decode <csv_timings_usec>\n");
            return 1;
        }
        static uint16_t rawbuf[1024];
        uint16_t n = 0;
        const char* p = argv[2];
        while (*p && n < 1022) {
            char* end;
            long v = strtol(p, &end, 10);
            if (end == p) break;
            long ticks = v / kRawTick;
            rawbuf[++n] = static_cast<uint16_t>(ticks > UINT16_MAX ? UINT16_MAX : ticks);
            p = end;
            while (*p == ',' || *p == ' ') p++;
        }

        decode_results results;
        results.rawbuf = rawbuf;
        results.rawlen = n + 1;
        results.overflow = false;
        results.decode_type = UNKNOWN;

        IRrecv irrecv(4);
        if (irrecv.decode(&results)) {
            printf("%s\n", typeToString(results.decode_type, false).c_str());
            for (uint16_t i = 0; i < results.bits / 8; i++)
                printf("%02X", results.state[i]);
            printf("\n");
        } else {
            printf("FAIL\n");
        }
        return 0;
    }

    fprintf(stderr, "Unknown function: %s\n", fn);
    return 1;
}
