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
#include "ir_Panasonic.h"
#include "ir_Samsung.h"
#include "ir_LG.h"
#include "ir_Carrier.h"
#include "ir_Haier.h"
#include "ir_Toshiba.h"
#include "ir_Sharp.h"
#include "ir_Sanyo.h"
#include "ir_Whirlpool.h"
#include "ir_MitsubishiHeavy.h"
#include "ir_Goodweather.h"
#include "ir_Transcold.h"
#include "ir_Fujitsu.h"
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

    // ----- Panasonic 48-bit -----

    if (strcmp(fn, "sendPanasonic64") == 0) {
        if (argc < 4) {
            fprintf(stderr, "Usage: runner sendPanasonic64 <data_hex> <nbits> [repeat]\n");
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t nbits = static_cast<uint16_t>(atoi(argv[3]));
        uint16_t repeat = argc > 4 ? static_cast<uint16_t>(atoi(argv[4])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendPanasonic64(data, nbits, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "encodePanasonic") == 0) {
        if (argc < 6) {
            fprintf(stderr, "Usage: runner encodePanasonic <mfr_hex> <device> <subdevice> <function>\n");
            return 1;
        }
        uint16_t mfr = static_cast<uint16_t>(strtoul(argv[2], nullptr, 16));
        uint8_t device = static_cast<uint8_t>(atoi(argv[3]));
        uint8_t subdevice = static_cast<uint8_t>(atoi(argv[4]));
        uint8_t function = static_cast<uint8_t>(atoi(argv[5]));

        IRsendTest irsend(4);
        irsend.begin();
        printf("%012llX\n", static_cast<unsigned long long>(
            irsend.encodePanasonic(mfr, device, subdevice, function)));
        return 0;
    }

    // ----- Panasonic AC raw send (27-byte state) -----

    if (strcmp(fn, "sendPanasonicAC") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendPanasonicAC <hex_bytes> [repeat]\n");
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
        irsend.sendPanasonicAC(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Panasonic AC via class setters -----

    if (strcmp(fn, "panasonicAc") == 0) {
        // Args: model power temp mode fan swingV swingH quiet powerful ion
        //       clock onTimer onTimerEn offTimer offTimerEn
        if (argc < 16) {
            fprintf(stderr, "Usage: runner panasonicAc <model> <power> <temp> "
                "<mode> <fan> <swingV> <swingH> <quiet> <powerful> <ion> "
                "<clock> <onTimer> <onTimerEn> <offTimer> <offTimerEn>\n");
            return 1;
        }
        IRPanasonicAc ac(4);
        ac.begin();
        ac.stateReset();
        ac.setModel(static_cast<panasonic_ac_remote_model_t>(atoi(argv[2])));
        ac.setMode(static_cast<uint8_t>(atoi(argv[5])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[4])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwingVertical(static_cast<uint8_t>(atoi(argv[7])));
        ac.setSwingHorizontal(static_cast<uint8_t>(atoi(argv[8])));
        ac.setQuiet(atoi(argv[9]) != 0);
        ac.setPowerful(atoi(argv[10]) != 0);
        ac.setIon(atoi(argv[11]) != 0);
        ac.setClock(static_cast<uint16_t>(atoi(argv[12])));
        ac.setOnTimer(static_cast<uint16_t>(atoi(argv[13])), atoi(argv[14]) != 0);
        ac.setOffTimer(static_cast<uint16_t>(atoi(argv[15])), argc > 16 ? atoi(argv[16]) != 0 : true);
        ac.setPower(atoi(argv[3]) != 0);

        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kPanasonicAcStateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        ac.send();
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Panasonic AC32 raw send -----

    if (strcmp(fn, "sendPanasonicAC32") == 0) {
        if (argc < 4) {
            fprintf(stderr, "Usage: runner sendPanasonicAC32 <data_hex> <nbits> [repeat]\n");
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t nbits = static_cast<uint16_t>(atoi(argv[3]));
        uint16_t repeat = argc > 4 ? static_cast<uint16_t>(atoi(argv[4])) : 0;

        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendPanasonicAC32(data, nbits, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Panasonic AC32 via class setters -----

    if (strcmp(fn, "panasonicAc32") == 0) {
        // Args: powerToggle temp mode fan swingV swingH
        if (argc < 8) {
            fprintf(stderr, "Usage: runner panasonicAc32 <powerToggle> <temp> "
                "<mode> <fan> <swingV> <swingH>\n");
            return 1;
        }
        IRPanasonicAc32 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwingHorizontal(atoi(argv[7]) != 0);
        ac.setPowerToggle(atoi(argv[2]) != 0);

        printf("%08lX\n", static_cast<unsigned long>(ac.getRaw()));
        return 0;
    }

    // ----- Samsung 32-bit -----

    if (strcmp(fn, "sendSAMSUNG") == 0) {
        if (argc < 4) {
            fprintf(stderr, "Usage: runner sendSAMSUNG <data_hex> <nbits> [repeat]\n");
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t nbits = static_cast<uint16_t>(atoi(argv[3]));
        uint16_t repeat = argc > 4 ? static_cast<uint16_t>(atoi(argv[4])) : 0;
        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendSAMSUNG(data, nbits, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "encodeSAMSUNG") == 0) {
        if (argc < 4) {
            fprintf(stderr, "Usage: runner encodeSAMSUNG <customer> <command>\n");
            return 1;
        }
        uint8_t customer = static_cast<uint8_t>(atoi(argv[2]));
        uint8_t command = static_cast<uint8_t>(atoi(argv[3]));
        IRsendTest irsend(4);
        irsend.begin();
        printf("%08lX\n", static_cast<unsigned long>(irsend.encodeSAMSUNG(customer, command)));
        return 0;
    }

    // ----- Samsung 36-bit -----

    if (strcmp(fn, "sendSamsung36") == 0) {
        if (argc < 4) {
            fprintf(stderr, "Usage: runner sendSamsung36 <data_hex> <nbits> [repeat]\n");
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t nbits = static_cast<uint16_t>(atoi(argv[3]));
        uint16_t repeat = argc > 4 ? static_cast<uint16_t>(atoi(argv[4])) : 0;
        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendSamsung36(data, nbits, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Samsung AC raw send -----

    if (strcmp(fn, "sendSamsungAC") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendSamsungAC <hex_bytes> [repeat]\n");
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
        irsend.sendSamsungAC(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Samsung AC via class setters (standard 14-byte message) -----

    if (strcmp(fn, "samsungAc") == 0) {
        // Args: power temp mode fan swingV swingH quiet powerful breeze econo
        //       clean beep display ion
        if (argc < 16) {
            fprintf(stderr, "Usage: runner samsungAc <power> <temp> <mode> <fan> "
                "<swingV> <swingH> <quiet> <powerful> <breeze> <econo> <clean> "
                "<beep> <display> <ion>\n");
            return 1;
        }
        IRSamsungAc ac(4);
        ac.begin();
        ac.stateReset();
        ac.setPower(atoi(argv[2]) != 0);
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwing(atoi(argv[6]) != 0);
        ac.setSwingH(atoi(argv[7]) != 0);
        ac.setQuiet(atoi(argv[8]) != 0);
        ac.setPowerful(atoi(argv[9]) != 0);
        ac.setBreeze(atoi(argv[10]) != 0);
        ac.setEcono(atoi(argv[11]) != 0);
        ac.setClean(atoi(argv[12]) != 0);
        ac.setBeep(atoi(argv[13]) != 0);
        ac.setDisplay(atoi(argv[14]) != 0);
        ac.setIon(atoi(argv[15]) != 0);

        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kSamsungAcStateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        IRsendTest irsend(4);
        irsend.begin();
        irsend.sendSamsungAC(raw, kSamsungAcStateLength, 0);
        printTimings(irsend);
        return 0;
    }

    // ----- LG / LG2 28-bit -----

    if (strcmp(fn, "sendLG") == 0 || strcmp(fn, "sendLG2") == 0) {
        if (argc < 4) {
            fprintf(stderr, "Usage: runner %s <data_hex> <nbits> [repeat]\n", fn);
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t nbits = static_cast<uint16_t>(atoi(argv[3]));
        uint16_t repeat = argc > 4 ? static_cast<uint16_t>(atoi(argv[4])) : 0;
        IRsendTest irsend(4);
        irsend.begin();
        if (strcmp(fn, "sendLG2") == 0) irsend.sendLG2(data, nbits, repeat);
        else irsend.sendLG(data, nbits, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "encodeLG") == 0) {
        if (argc < 4) {
            fprintf(stderr, "Usage: runner encodeLG <address> <command>\n");
            return 1;
        }
        uint16_t address = static_cast<uint16_t>(atoi(argv[2]));
        uint16_t command = static_cast<uint16_t>(atoi(argv[3]));
        IRsendTest irsend(4);
        irsend.begin();
        printf("%07lX\n", static_cast<unsigned long>(irsend.encodeLG(address, command)));
        return 0;
    }

    // ----- LG A/C via class setters (main command) -----

    if (strcmp(fn, "lgAc") == 0) {
        // Args: model power mode temp fan
        if (argc < 7) {
            fprintf(stderr, "Usage: runner lgAc <model> <power> <mode> <temp> <fan>\n");
            return 1;
        }
        IRLgAc ac(4);
        ac.begin();
        ac.stateReset();
        ac.setModel(static_cast<lg_ac_remote_model_t>(atoi(argv[2])));
        ac.setPower(atoi(argv[3]) != 0);
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[5])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[6])));
        printf("%07lX\n", static_cast<unsigned long>(ac.getRaw()));
        return 0;
    }

    // ----- Carrier value protocols (AC 32 / AC40 / AC64) -----

    if (strcmp(fn, "sendCarrierAC") == 0 || strcmp(fn, "sendCarrierAC40") == 0 ||
        strcmp(fn, "sendCarrierAC64") == 0) {
        if (argc < 4) {
            fprintf(stderr, "Usage: runner %s <data_hex> <nbits> [repeat]\n", fn);
            return 1;
        }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t nbits = static_cast<uint16_t>(atoi(argv[3]));
        uint16_t repeat = argc > 4 ? static_cast<uint16_t>(atoi(argv[4])) : 0;
        IRsendTest irsend(4);
        irsend.begin();
        if (strcmp(fn, "sendCarrierAC40") == 0) irsend.sendCarrierAC40(data, nbits, repeat);
        else if (strcmp(fn, "sendCarrierAC64") == 0) irsend.sendCarrierAC64(data, nbits, repeat);
        else irsend.sendCarrierAC(data, nbits, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "carrierAc64") == 0) {
        // Args: power mode temp fan swingV sleep onTimerMins offTimerMins
        if (argc < 10) {
            fprintf(stderr, "Usage: runner carrierAc64 <power> <mode> <temp> <fan> "
                "<swingV> <sleep> <onTimerMins> <offTimerMins>\n");
            return 1;
        }
        IRCarrierAc64 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[3])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[4])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingV(atoi(argv[6]) != 0);
        ac.setOnTimer(static_cast<uint16_t>(atoi(argv[8])));
        ac.setOffTimer(static_cast<uint16_t>(atoi(argv[9])));
        ac.setSleep(atoi(argv[7]) != 0);
        ac.setPower(atoi(argv[2]) != 0);
        printf("%016llX\n", static_cast<unsigned long long>(ac.getRaw()));
        return 0;
    }

    // ----- Carrier byte-array protocols (AC128 / AC84) -----

    if (strcmp(fn, "sendCarrierAC128") == 0 || strcmp(fn, "sendCarrierAC84") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner %s <hex_bytes> [repeat]\n", fn);
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
        if (strcmp(fn, "sendCarrierAC84") == 0) irsend.sendCarrierAC84(data, nbytes, repeat);
        else irsend.sendCarrierAC128(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Haier (all variants share sendHaierAC; length picks the decode) -----

    if (strcmp(fn, "sendHaier") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner sendHaier <hex_bytes> [repeat]\n");
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
        irsend.sendHaierAC(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Haier AC176 / YRW02 via class setters -----

    if (strcmp(fn, "haier176") == 0 || strcmp(fn, "haierYrw02") == 0) {
        // Args: model power temp mode fan swingV swingH health sleep turbo quiet button
        if (argc < 14) {
            fprintf(stderr, "Usage: runner %s <model> <power> <temp> <mode> <fan> "
                "<swingV> <swingH> <health> <sleep> <turbo> <quiet> <button>\n", fn);
            return 1;
        }
        const bool yrw02 = strcmp(fn, "haierYrw02") == 0;
        IRHaierAC176 ac176(4);
        IRHaierACYRW02 acy(4);
        IRHaierAC176& ac = yrw02 ? static_cast<IRHaierAC176&>(acy) : ac176;
        ac.begin();
        ac.stateReset();
        ac.setModel(static_cast<haier_ac176_remote_model_t>(atoi(argv[2])));
        ac.setMode(static_cast<uint8_t>(atoi(argv[5])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[4])), false);
        ac.setFan(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwingV(static_cast<uint8_t>(atoi(argv[7])));
        ac.setSwingH(static_cast<uint8_t>(atoi(argv[8])));
        ac.setHealth(atoi(argv[9]) != 0);
        ac.setSleep(atoi(argv[10]) != 0);
        ac.setTurbo(atoi(argv[11]) != 0);
        ac.setQuiet(atoi(argv[12]) != 0);
        ac.setPower(atoi(argv[3]) != 0);
        ac.setButton(static_cast<uint8_t>(atoi(argv[13])));
        uint8_t* raw = ac.getRaw();
        const int len = yrw02 ? kHaierACYRW02StateLength : kHaierAC176StateLength;
        for (int i = 0; i < len; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Haier AC160 via class setters -----

    if (strcmp(fn, "haier160") == 0) {
        // Args: power temp mode fan swingV health sleep turbo quiet clean auxHeating button
        if (argc < 14) {
            fprintf(stderr, "Usage: runner haier160 <power> <temp> <mode> <fan> "
                "<swingV> <health> <sleep> <turbo> <quiet> <clean> <auxHeating> <button>\n");
            return 1;
        }
        IRHaierAC160 ac(4);
        ac.begin();
        ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])), false);
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingV(static_cast<uint8_t>(atoi(argv[6])));
        ac.setHealth(atoi(argv[7]) != 0);
        ac.setSleep(atoi(argv[8]) != 0);
        ac.setTurbo(atoi(argv[9]) != 0);
        ac.setQuiet(atoi(argv[10]) != 0);
        ac.setClean(atoi(argv[11]) != 0);
        ac.setAuxHeating(atoi(argv[12]) != 0);
        ac.setPower(atoi(argv[2]) != 0);
        ac.setButton(static_cast<uint8_t>(atoi(argv[13])));
        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kHaierAC160StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Toshiba A/C -----

    if (strcmp(fn, "sendToshibaAC") == 0) {
        if (argc < 3) { fprintf(stderr, "Usage: runner sendToshibaAC <hex> [repeat]\n"); return 1; }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) { unsigned int b; sscanf(hex + i * 2, "%2x", &b); data[i] = static_cast<uint8_t>(b); }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendToshibaAC(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "toshibaAc") == 0) {
        // model power temp mode fan filter turbo econo
        if (argc < 10) { fprintf(stderr, "Usage: runner toshibaAc <model> <power> <temp> <mode> <fan> <filter> <turbo> <econo>\n"); return 1; }
        IRToshibaAC ac(4); ac.begin(); ac.stateReset();
        ac.setModel(static_cast<toshiba_ac_remote_model_t>(atoi(argv[2])));
        ac.setMode(static_cast<uint8_t>(atoi(argv[5])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[4])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[6])));
        ac.setFilter(atoi(argv[7]) != 0);
        ac.setTurbo(atoi(argv[8]) != 0);
        ac.setEcono(atoi(argv[9]) != 0);
        ac.setPower(atoi(argv[3]) != 0);
        uint8_t* raw = ac.getRaw();
        for (uint16_t i = 0; i < ac.getStateLength(); i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Sharp 15-bit remote -----

    if (strcmp(fn, "sendSharpRaw") == 0) {
        if (argc < 4) { fprintf(stderr, "Usage: runner sendSharpRaw <data_hex> <nbits> [repeat]\n"); return 1; }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t nbits = static_cast<uint16_t>(atoi(argv[3]));
        uint16_t repeat = argc > 4 ? static_cast<uint16_t>(atoi(argv[4])) : 0;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendSharpRaw(data, nbits, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "encodeSharp") == 0) {
        if (argc < 4) { fprintf(stderr, "Usage: runner encodeSharp <address> <command>\n"); return 1; }
        IRsendTest irsend(4); irsend.begin();
        printf("%lX\n", static_cast<unsigned long>(
            irsend.encodeSharp(static_cast<uint16_t>(atoi(argv[2])), static_cast<uint16_t>(atoi(argv[3])), 1, 0, true)));
        return 0;
    }

    // ----- Sharp A/C -----

    if (strcmp(fn, "sendSharpAc") == 0) {
        if (argc < 3) { fprintf(stderr, "Usage: runner sendSharpAc <hex> [repeat]\n"); return 1; }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) { unsigned int b; sscanf(hex + i * 2, "%2x", &b); data[i] = static_cast<uint8_t>(b); }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendSharpAc(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "sharpAc") == 0) {
        // model power temp mode fan swingV ion
        if (argc < 9) { fprintf(stderr, "Usage: runner sharpAc <model> <power> <temp> <mode> <fan> <swingV> <ion>\n"); return 1; }
        IRSharpAc ac(4); ac.begin();
        ac.setModel(static_cast<sharp_ac_remote_model_t>(atoi(argv[2])));
        ac.setMode(static_cast<uint8_t>(atoi(argv[5])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[4])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwingV(static_cast<uint8_t>(atoi(argv[7])), true);
        ac.setIon(atoi(argv[8]) != 0);
        ac.setPower(atoi(argv[3]) != 0);
        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kSharpAcStateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Sanyo LC7461 -----

    if (strcmp(fn, "sendGoodweather") == 0) {
        if (argc < 3) { fprintf(stderr, "Usage: runner sendGoodweather <data_hex> [repeat]\n"); return 1; }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendGoodweather(data, kGoodweatherBits, repeat);
        printTimings(irsend);
        return 0;
    }
    if (strcmp(fn, "sendTranscold") == 0) {
        if (argc < 3) { fprintf(stderr, "Usage: runner sendTranscold <data_hex> [repeat]\n"); return 1; }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendTranscold(data, kTranscoldBits, repeat);
        printTimings(irsend);
        return 0;
    }
    if (strcmp(fn, "sendSanyoLC7461") == 0) {
        if (argc < 4) { fprintf(stderr, "Usage: runner sendSanyoLC7461 <data_hex> <nbits> [repeat]\n"); return 1; }
        uint64_t data = strtoull(argv[2], nullptr, 16);
        uint16_t nbits = static_cast<uint16_t>(atoi(argv[3]));
        uint16_t repeat = argc > 4 ? static_cast<uint16_t>(atoi(argv[4])) : 0;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendSanyoLC7461(data, nbits, repeat);
        printTimings(irsend);
        return 0;
    }
    if (strcmp(fn, "encodeSanyoLC7461") == 0) {
        if (argc < 4) { fprintf(stderr, "Usage: runner encodeSanyoLC7461 <address> <command>\n"); return 1; }
        IRsendTest irsend(4); irsend.begin();
        printf("%llX\n", static_cast<unsigned long long>(
            irsend.encodeSanyoLC7461(static_cast<uint16_t>(atoi(argv[2])), static_cast<uint8_t>(atoi(argv[3])))));
        return 0;
    }

    // ----- Sanyo A/C raw sends -----

    if (strcmp(fn, "sendSanyoAc") == 0 || strcmp(fn, "sendSanyoAc88") == 0 || strcmp(fn, "sendSanyoAc152") == 0) {
        if (argc < 3) { fprintf(stderr, "Usage: runner %s <hex> [repeat]\n", fn); return 1; }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) { unsigned int b; sscanf(hex + i * 2, "%2x", &b); data[i] = static_cast<uint8_t>(b); }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;
        IRsendTest irsend(4); irsend.begin();
        if (strcmp(fn, "sendSanyoAc88") == 0) irsend.sendSanyoAc88(data, nbytes, repeat);
        else if (strcmp(fn, "sendSanyoAc152") == 0) irsend.sendSanyoAc152(data, nbytes, repeat);
        else irsend.sendSanyoAc(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Sanyo A/C via class setters -----

    if (strcmp(fn, "sanyoAc") == 0) {
        // power temp mode fan swingV sleep beep sensor sensorTemp offTimerMins
        if (argc < 12) { fprintf(stderr, "Usage: runner sanyoAc <power> <temp> <mode> <fan> <swingV> <sleep> <beep> <sensor> <sensorTemp> <offTimerMins>\n"); return 1; }
        IRSanyoAc ac(4); ac.begin(); ac.stateReset();
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingV(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSleep(atoi(argv[7]) != 0);
        ac.setBeep(atoi(argv[8]) != 0);
        ac.setSensor(atoi(argv[9]) != 0);
        ac.setSensorTemp(static_cast<uint8_t>(atoi(argv[10])));
        ac.setOffTimer(static_cast<uint16_t>(atoi(argv[11])));
        ac.setPower(atoi(argv[2]) != 0);
        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kSanyoAcStateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    if (strcmp(fn, "sanyoAc88") == 0) {
        // power temp mode fan swingV filter turbo sleep clockMins
        if (argc < 11) { fprintf(stderr, "Usage: runner sanyoAc88 <power> <temp> <mode> <fan> <swingV> <filter> <turbo> <sleep> <clockMins>\n"); return 1; }
        IRSanyoAc88 ac(4); ac.begin(); ac.stateReset();
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingV(atoi(argv[6]) != 0);
        ac.setFilter(atoi(argv[7]) != 0);
        ac.setTurbo(atoi(argv[8]) != 0);
        ac.setSleep(atoi(argv[9]) != 0);
        ac.setClock(static_cast<uint16_t>(atoi(argv[10])));
        ac.setPower(atoi(argv[2]) != 0);
        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kSanyoAc88StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Whirlpool A/C -----

    if (strcmp(fn, "sendWhirlpoolAc") == 0) {
        if (argc < 3) { fprintf(stderr, "Usage: runner sendWhirlpoolAc <hex> [repeat]\n"); return 1; }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) { unsigned int b; sscanf(hex + i * 2, "%2x", &b); data[i] = static_cast<uint8_t>(b); }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendWhirlpoolAC(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    if (strcmp(fn, "whirlpoolAc") == 0) {
        // model powerToggle temp mode fan swing light sleep clock onTimer onEn offTimer offEn command
        if (argc < 16) { fprintf(stderr, "Usage: runner whirlpoolAc <model> <powerToggle> <temp> <mode> <fan> <swing> <light> <sleep> <clock> <onTimer> <onEn> <offTimer> <offEn> <command>\n"); return 1; }
        IRWhirlpoolAc ac(4); ac.begin(); ac.stateReset();
        ac.setModel(static_cast<whirlpool_ac_remote_model_t>(atoi(argv[2])));
        ac.setMode(static_cast<uint8_t>(atoi(argv[5])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[4])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwing(atoi(argv[7]) != 0);
        ac.setLight(atoi(argv[8]) != 0);
        ac.setSleep(atoi(argv[9]) != 0);
        ac.setClock(static_cast<uint16_t>(atoi(argv[10])));
        ac.setOnTimer(static_cast<uint16_t>(atoi(argv[11])));
        ac.enableOnTimer(atoi(argv[12]) != 0);
        ac.setOffTimer(static_cast<uint16_t>(atoi(argv[13])));
        ac.enableOffTimer(atoi(argv[14]) != 0);
        ac.setPowerToggle(atoi(argv[3]) != 0);
        ac.setCommand(static_cast<uint8_t>(atoi(argv[15])));
        uint8_t* raw = ac.getRaw(true);
        for (int i = 0; i < kWhirlpoolAcStateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Mitsubishi Heavy + Bluestar raw sends -----

    if (strcmp(fn, "sendMitsubishiHeavy152") == 0 || strcmp(fn, "sendMitsubishiHeavy88") == 0 ||
        strcmp(fn, "sendBluestarHeavy") == 0) {
        if (argc < 3) { fprintf(stderr, "Usage: runner %s <hex> [repeat]\n", fn); return 1; }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) { unsigned int b; sscanf(hex + i * 2, "%2x", &b); data[i] = static_cast<uint8_t>(b); }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;
        IRsendTest irsend(4); irsend.begin();
        if (strcmp(fn, "sendMitsubishiHeavy88") == 0) irsend.sendMitsubishiHeavy88(data, nbytes, repeat);
        else if (strcmp(fn, "sendBluestarHeavy") == 0) irsend.sendBluestarHeavy(data, nbytes, repeat);
        else irsend.sendMitsubishiHeavy152(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Mitsubishi Heavy via class setters -----

    if (strcmp(fn, "mheavy152") == 0) {
        // power temp mode fan swingV swingH night silent filter clean threeD
        if (argc < 13) { fprintf(stderr, "Usage: runner mheavy152 <power> <temp> <mode> <fan> <swingV> <swingH> <night> <silent> <filter> <clean> <3d>\n"); return 1; }
        IRMitsubishiHeavy152Ac ac(4); ac.begin(); ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwingHorizontal(static_cast<uint8_t>(atoi(argv[7])));
        ac.setNight(atoi(argv[8]) != 0);
        ac.setSilent(atoi(argv[9]) != 0);
        ac.setFilter(atoi(argv[10]) != 0);
        ac.setClean(atoi(argv[11]) != 0);
        ac.set3D(atoi(argv[12]) != 0);
        ac.setPower(atoi(argv[2]) != 0);
        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kMitsubishiHeavy152StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    if (strcmp(fn, "mheavy88") == 0) {
        // power temp mode fan swingV swingH clean
        if (argc < 9) { fprintf(stderr, "Usage: runner mheavy88 <power> <temp> <mode> <fan> <swingV> <swingH> <clean>\n"); return 1; }
        IRMitsubishiHeavy88Ac ac(4); ac.begin(); ac.stateReset();
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<uint8_t>(atoi(argv[3])));
        ac.setFan(static_cast<uint8_t>(atoi(argv[5])));
        ac.setSwingVertical(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwingHorizontal(static_cast<uint8_t>(atoi(argv[7])));
        ac.setClean(atoi(argv[8]) != 0);
        ac.setPower(atoi(argv[2]) != 0);
        uint8_t* raw = ac.getRaw();
        for (int i = 0; i < kMitsubishiHeavy88StateLength; i++) printf("%02X", raw[i]);
        printf("\n");
        return 0;
    }

    // ----- Fujitsu raw send -----

    if (strcmp(fn, "sendFujitsuAc") == 0) {
        if (argc < 3) { fprintf(stderr, "Usage: runner sendFujitsuAc <hex> [repeat]\n"); return 1; }
        const char* hex = argv[2];
        uint16_t nbytes = static_cast<uint16_t>(strlen(hex) / 2);
        uint8_t data[64];
        for (uint16_t i = 0; i < nbytes && i < 64; i++) { unsigned int b; sscanf(hex + i * 2, "%2x", &b); data[i] = static_cast<uint8_t>(b); }
        uint16_t repeat = argc > 3 ? static_cast<uint16_t>(atoi(argv[3])) : 0;
        IRsendTest irsend(4); irsend.begin();
        irsend.sendFujitsuAC(data, nbytes, repeat);
        printTimings(irsend);
        return 0;
    }

    // ----- Fujitsu via class setters -----
    // Prints "<state_hex>\n<timings>". Builds a valid frame for the given model.

    if (strcmp(fn, "fujitsuAc") == 0) {
        // model power mode temp fan swing clean filter outsideQuiet cmd
        //   [id celsius tenCHeat timerType timerValue]
        if (argc < 12) {
            fprintf(stderr, "Usage: runner fujitsuAc <model> <power> <mode> <temp> <fan> "
                "<swing> <clean> <filter> <outsideQuiet> <cmd> "
                "[id celsius tenCHeat timerType timerValue]\n");
            return 1;
        }
        const bool celsius = argc > 13 ? atoi(argv[13]) != 0 : true;
        const int tenCHeat = argc > 14 ? atoi(argv[14]) : 0;
        const int timerType = argc > 15 ? atoi(argv[15]) : 0;
        const int timerValue = argc > 16 ? atoi(argv[16]) : 0;

        IRFujitsuAC ac(4, static_cast<fujitsu_ac_remote_model_t>(atoi(argv[2])));
        ac.begin();
        if (argc > 12) ac.setId(static_cast<uint8_t>(atoi(argv[12])));
        ac.setMode(static_cast<uint8_t>(atoi(argv[4])));
        ac.setTemp(static_cast<float>(atof(argv[5])), celsius);
        ac.setFanSpeed(static_cast<uint8_t>(atoi(argv[6])));
        ac.setSwing(static_cast<uint8_t>(atoi(argv[7])));
        ac.setClean(atoi(argv[8]) != 0);
        ac.setFilter(atoi(argv[9]) != 0);
        ac.setOutsideQuiet(atoi(argv[10]) != 0);
        switch (timerType) {
            case 1: ac.setSleepTimer(static_cast<uint16_t>(timerValue)); break;
            case 2: ac.setOffTimer(static_cast<uint16_t>(timerValue)); break;
            case 3: ac.setOnTimer(static_cast<uint16_t>(timerValue)); break;
            default: break;
        }
        if (tenCHeat) ac.set10CHeat(true);
        uint8_t cmd = static_cast<uint8_t>(strtoul(argv[11], nullptr, 16));
        if (cmd != 0)
            ac.setCmd(cmd);
        else
            ac.setPower(atoi(argv[3]) != 0);

        uint8_t* raw = ac.getRaw();
        uint8_t len = ac.getStateLength();
        for (uint8_t i = 0; i < len; i++) printf("%02X", raw[i]);
        printf("\n");
        ac.send();
        printTimings(ac._irsend);
        return 0;
    }

    // ----- Generic value decode: feed raw timings into IRrecv::decode -----
    // Prints "<PROTOCOL_NAME>\n<value_hex>" or "FAIL". For value-based
    // protocols (Panasonic 48-bit / AC32) that store the result in `value`.

    if (strcmp(fn, "decodeValue") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: runner decodeValue <csv_timings_usec>\n");
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
            printf("%llX\n", static_cast<unsigned long long>(results.value));
        } else {
            printf("FAIL\n");
        }
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
            // Round up so non-byte-aligned protocols (e.g. CARRIER_AC84's 84
            // bits across 11 bytes) print their full state.
            for (uint16_t i = 0; i < (results.bits + 7) / 8; i++)
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
