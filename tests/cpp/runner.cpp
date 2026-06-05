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
#include "ir_Gree.h"
#include "ir_Kelon.h"
#include "ir_Teco.h"
#include "ir_Voltas.h"
#include "ir_Hitachi.h"
#include "ir_Tcl.h"
#include "ir_Mitsubishi.h"
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

    // ----- Coolix48 raw send -----

    if (strcmp(fn, "sendCoolix48") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendCoolix48 <data_hex> [repeat]\n");
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 1;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendCoolix48(data, kCoolix48Bits, repeat);
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

    // ----- Gree raw send -----

    if (strcmp(fn, "sendGree") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendGree <data_hex_16> [repeat]\n");
            return 1;
        }
        const char* hex = argv[2];
        if (strlen(hex) != 16) {
            fprintf(stderr, "sendGree: data must be exactly 16 hex chars\n");
            return 1;
        }
        uint8_t data[kGreeStateLength];
        for (int i = 0; i < kGreeStateLength; i++) {
            char buf[3] = { hex[i*2], hex[i*2+1], 0 };
            data[i] = static_cast<uint8_t>(strtoul(buf, nullptr, 16));
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendGree(data, kGreeStateLength, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Gree via class setters -----

    if (strcmp(fn, "gree") == 0) {
        // Args: power temp mode fan swingVauto swingVpos swingH turbo light
        //       sleep xfan econo ifeel wifi displayTemp timerMins
        if (argc < 18) {
            fprintf(stderr, "Usage: runner gree <power> <temp> <mode> <fan> "
                "<swingVauto> <swingVpos> <swingH> <turbo> <light> <sleep> "
                "<xfan> <econo> <ifeel> <wifi> <displayTemp> <timerMins>\n");
            return 1;
        }
        IRGreeAC ac(4);
        ac.begin();
        ac.stateReset();
        // YBOFB keeps the ModelA bit clear regardless of power/econo.
        ac.setModel(gree_ac_remote_model_t::YBOFB);
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(atoi(argv[6]) != 0, static_cast<uint8_t>(atoi(argv[7])));
        ac.setSwingHorizontal(static_cast<uint8_t>(atoi(argv[8])));
        ac.setTurbo(atoi(argv[9]) != 0);
        ac.setLight(atoi(argv[10]) != 0);
        ac.setSleep(atoi(argv[11]) != 0);
        ac.setXFan(atoi(argv[12]) != 0);
        ac.setEcono(atoi(argv[13]) != 0);
        ac.setIFeel(atoi(argv[14]) != 0);
        ac.setWiFi(atoi(argv[15]) != 0);
        ac.setDisplayTempSource(static_cast<uint8_t>(atoi(argv[16])));
        ac.setTimer(static_cast<uint16_t>(atoi(argv[17])));
        ac.setPower(atoi(argv[2]) != 0);

        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kGreeStateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Kelon (48-bit) raw send -----

    if (strcmp(fn, "sendKelon") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendKelon <value_hex> [repeat]\n");
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendKelon(data, kKelonBits, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Kelon via class setters (modes restricted to Heat/Cool to avoid
    //       the temp side-effects of Smart/Dry/Fan) -----

    if (strcmp(fn, "kelon") == 0) {
        // Args: powerToggle temp mode fan sleep swingVToggle dryGrade timerMins
        if (argc < 10) {
            fprintf(stderr, "Usage: runner kelon <powerToggle> <temp> <mode> <fan> "
                "<sleep> <swingVToggle> <dryGrade> <timerMins>\n");
            return 1;
        }
        IRKelonAc ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSleep(atoi(argv[6]) != 0);
        ac.setToggleSwingVertical(atoi(argv[7]) != 0);
        ac.setDryGrade(static_cast<int8_t>(atoi(argv[8])));
        if (atoi(argv[9]) > 0) ac.setTimer(static_cast<uint16_t>(atoi(argv[9])));
        ac.setTogglePower(atoi(argv[2]) != 0);

        printf("%012llX\n", static_cast<unsigned long long>(ac.getRaw()));
        return 0;
    }

    // ----- Kelon168 raw send -----

    if (strcmp(fn, "sendKelon168") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendKelon168 <data_hex_42> [repeat]\n");
            return 1;
        }
        const char* hex = argv[2];
        if (strlen(hex) != kKelon168StateLength * 2) {
            fprintf(stderr, "sendKelon168: data must be exactly %d hex chars\n",
                    kKelon168StateLength * 2);
            return 1;
        }
        uint8_t data[kKelon168StateLength];
        for (int i = 0; i < kKelon168StateLength; i++) {
            char buf[3] = { hex[i*2], hex[i*2+1], 0 };
            data[i] = static_cast<uint8_t>(strtoul(buf, nullptr, 16));
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendKelon168(data, kKelon168StateLength, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Kelon168: recompute checksums for raw bytes -----

    if (strcmp(fn, "kelon168cksum") == 0) {
        if (argc < 3 || strlen(argv[2]) != kKelon168StateLength * 2) {
            fprintf(stderr, "Usage: runner kelon168cksum <data_hex_42>\n");
            return 1;
        }
        const char* hex = argv[2];
        uint8_t data[kKelon168StateLength];
        for (int i = 0; i < kKelon168StateLength; i++) {
            char buf[3] = { hex[i*2], hex[i*2+1], 0 };
            data[i] = static_cast<uint8_t>(strtoul(buf, nullptr, 16));
        }
        IRKelon168Ac ac(4);
        ac.begin();
        ac.setRaw(data, kKelon168StateLength);
        uint8_t* raw = ac.getRaw(true);  // recompute checksums
        for (int i = 0; i < kKelon168StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Kelon168 via class setters (non-auto modes; super/sleep left off) --

    if (strcmp(fn, "kelon168") == 0) {
        // Args: on temp mode fan swing light clockMins offEn offMins onEn onMins cmd
        if (argc < 14) {
            fprintf(stderr, "Usage: runner kelon168 <on> <temp> <mode> <fan> <swing> "
                "<light> <clockMins> <offEn> <offMins> <onEn> <onMins> <cmd>\n");
            return 1;
        }
        IRKelon168Ac ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwing(atoi(argv[6]) != 0);
        ac.setLight(atoi(argv[7]) != 0);
        ac.setPower(atoi(argv[2]) != 0);
        ac.setClock(static_cast<uint16_t>(atoi(argv[8])));
        ac.setOffTimer(static_cast<uint16_t>(atoi(argv[10])));
        ac.enableOffTimer(atoi(argv[9]) != 0);
        ac.setOnTimer(static_cast<uint16_t>(atoi(argv[12])));
        ac.enableOnTimer(atoi(argv[11]) != 0);
        ac.setCommand(static_cast<uint8_t>(atoi(argv[13])));

        uint8_t* raw = ac.getRaw(true);
        for (int i = 0; i < kKelon168StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Teco raw send -----

    if (strcmp(fn, "sendTeco") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendTeco <value_hex> [repeat]\n");
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendTeco(data, kTecoBits, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Teco via class setters -----

    if (strcmp(fn, "teco") == 0) {
        // Args: power temp mode fan swing sleep light humid save timerMins
        if (argc < 12) {
            fprintf(stderr, "Usage: runner teco <power> <temp> <mode> <fan> <swing> "
                "<sleep> <light> <humid> <save> <timerMins>\n");
            return 1;
        }
        IRTecoAc ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwing(atoi(argv[6]) != 0);
        ac.setSleep(atoi(argv[7]) != 0);
        ac.setLight(atoi(argv[8]) != 0);
        ac.setHumid(atoi(argv[9]) != 0);
        ac.setSave(atoi(argv[10]) != 0);
        ac.setTimer(static_cast<uint16_t>(atoi(argv[11])));
        ac.setPower(atoi(argv[2]) != 0);

        printf("%09llX\n", static_cast<unsigned long long>(ac.getRaw()));
        return 0;
    }

    // ----- Mitsubishi (16-bit TV) raw send -----

    if (strcmp(fn, "sendMitsubishi") == 0) {
        if (argc < 3) { fprintf(stderr, "Usage: runner sendMitsubishi <hex> [repeat]\n"); return 1; }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 1;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendMitsubishi(data, kMitsubishiBits, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "sendMitsubishi2") == 0) {
        if (argc < 3) { fprintf(stderr, "Usage: runner sendMitsubishi2 <hex> [repeat]\n"); return 1; }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 1;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendMitsubishi2(data, kMitsubishiBits, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Mitsubishi A/C (144) -----

    if (strcmp(fn, "sendMitsubishiAc") == 0) {
        if (argc < 3 || strlen(argv[2]) != kMitsubishiACStateLength * 2) {
            fprintf(stderr, "Usage: runner sendMitsubishiAc <data_hex_36> [repeat]\n"); return 1;
        }
        const char* hex = argv[2];
        uint8_t data[kMitsubishiACStateLength];
        for (int i = 0; i < kMitsubishiACStateLength; i++) {
            char buf[3] = { hex[i*2], hex[i*2+1], 0 };
            data[i] = static_cast<uint8_t>(strtoul(buf, nullptr, 16));
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendMitsubishiAC(data, kMitsubishiACStateLength, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "mitsubishiAc") == 0) {
        // Args: power tempHalfDeg mode fan vane wideVane isee
        if (argc < 9) {
            fprintf(stderr, "Usage: runner mitsubishiAc <power> <tempHalfDeg> <mode> "
                "<fan> <vane> <wideVane> <isee>\n"); return 1;
        }
        IRMitsubishiAC ac(4); ac.begin(); ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setWideVane(static_cast<uint8_t>(atoi(argv[7])));
        ac.setVane(static_cast<uint8_t>(atoi(argv[6])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setTemp(atoi(argv[3]) / 2.0f);
        ac.setISee(atoi(argv[8]) != 0);
        ac.setPower(atoi(argv[2]) != 0);
        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kMitsubishiACStateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Mitsubishi136 -----

    if (strcmp(fn, "sendMitsubishi136") == 0) {
        if (argc < 3 || strlen(argv[2]) != kMitsubishi136StateLength * 2) {
            fprintf(stderr, "Usage: runner sendMitsubishi136 <data_hex_34> [repeat]\n"); return 1;
        }
        const char* hex = argv[2];
        uint8_t data[kMitsubishi136StateLength];
        for (int i = 0; i < kMitsubishi136StateLength; i++) {
            char buf[3] = { hex[i*2], hex[i*2+1], 0 };
            data[i] = static_cast<uint8_t>(strtoul(buf, nullptr, 16));
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendMitsubishi136(data, kMitsubishi136StateLength, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "mitsubishi136") == 0) {
        // Args: power temp mode fan swingV
        if (argc < 7) {
            fprintf(stderr, "Usage: runner mitsubishi136 <power> <temp> <mode> <fan> <swingV>\n"); return 1;
        }
        IRMitsubishi136 ac(4); ac.begin(); ac.stateReset();
        ac.setPower(atoi(argv[2]) != 0);
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingV(static_cast<uint8_t>(atoi(argv[6])));
        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kMitsubishi136StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Mitsubishi112 -----

    if (strcmp(fn, "sendMitsubishi112") == 0) {
        if (argc < 3 || strlen(argv[2]) != kMitsubishi112StateLength * 2) {
            fprintf(stderr, "Usage: runner sendMitsubishi112 <data_hex_28> [repeat]\n"); return 1;
        }
        const char* hex = argv[2];
        uint8_t data[kMitsubishi112StateLength];
        for (int i = 0; i < kMitsubishi112StateLength; i++) {
            char buf[3] = { hex[i*2], hex[i*2+1], 0 };
            data[i] = static_cast<uint8_t>(strtoul(buf, nullptr, 16));
        }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendMitsubishi112(data, kMitsubishi112StateLength, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "mitsubishi112") == 0) {
        // Args: power temp mode fan swingV swingH
        if (argc < 8) {
            fprintf(stderr, "Usage: runner mitsubishi112 <power> <temp> <mode> <fan> "
                "<swingV> <swingH>\n"); return 1;
        }
        IRMitsubishi112 ac(4); ac.begin(); ac.stateReset();
        ac.setPower(atoi(argv[2]) != 0);
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingV(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwingH(static_cast<uint8_t>(atoi(argv[7])));
        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kMitsubishi112StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
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
        // IRHitachiAc296::stateReset() does not zero-fill its state (unlike the
        // AC424 family), leaving the don't-care bits of bytes 13 (Temp) and 25
        // (Mode/Fan) reading uninitialized memory. Zero the state first so those
        // bits are deterministically 0 — matching the TS encoder's canonical
        // form — instead of platform-dependent stack garbage.
        const uint8_t zeros296[kHitachiAc296StateLength] = {0};
        ac.setRaw(zeros296, kHitachiAc296StateLength);
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

    // ----- Teknopoint raw send -----

    if (strcmp(fn, "sendTeknopoint") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendTeknopoint <hex_bytes> [repeat]\n");
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
        irsend.sendTeknopoint(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Teknopoint via IRTcl112Ac setters (shared byte format) -----

    if (strcmp(fn, "teknopoint") == 0) {
        // Args: power temp mode fan swingV swingH econo health light turbo
        //       onTimer offTimer model
        if (argc < 15) {
            fprintf(stderr, "Usage: runner teknopoint <power> <temp> <mode> "
                "<fan> <swingV> <swingH> <econo> <health> <light> <turbo> "
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
        for (int i = 0; i < kTeknopointStateLength; i++) printf("%02X", raw[i]);
        printf("\n");

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendTeknopoint(raw, kTeknopointStateLength, 0);
        printTimings(irsend);
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
