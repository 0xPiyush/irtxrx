VENDOR := ../../vendor/IRremoteESP8266

CXX      := c++
CXXFLAGS := -std=gnu++11 -Wall -Wextra -O2
CPPFLAGS := -DUNIT_TEST \
            -D_IR_LOCALE_=en-AU \
            -D_IR_ENABLE_DEFAULT_=false \
            -DSEND_NEC=true \
            -DDECODE_NEC=false \
            -DSEND_DAIKIN64=true \
            -DDECODE_DAIKIN64=false \
            -DSEND_DAIKIN152=true \
            -DDECODE_DAIKIN152=false \
            -DSEND_DAIKIN160=true \
            -DDECODE_DAIKIN160=false \
            -DSEND_DAIKIN176=true \
            -DDECODE_DAIKIN176=false \
            -DSEND_DAIKIN216=true \
            -DDECODE_DAIKIN216=false \
            -DSEND_DAIKIN=true \
            -DDECODE_DAIKIN=false \
            -DSEND_DAIKIN128=true \
            -DDECODE_DAIKIN128=false \
            -DSEND_DAIKIN2=true \
            -DDECODE_DAIKIN2=false \
            -DSEND_DAIKIN312=true \
            -DDECODE_DAIKIN312=false \
            -DSEND_COOLIX=true \
            -DDECODE_COOLIX=false \
            -DSEND_COOLIX48=true \
            -DDECODE_COOLIX48=false \
            -DSEND_GREE=true \
            -DDECODE_GREE=false \
            -DSEND_KELON=true \
            -DDECODE_KELON=false \
            -DSEND_KELON168=true \
            -DDECODE_KELON168=false \
            -DSEND_TECO=true \
            -DDECODE_TECO=false \
            -DSEND_VOLTAS=true \
            -DDECODE_VOLTAS=false \
            -DSEND_HITACHI_AC=true \
            -DDECODE_HITACHI_AC=false \
            -DSEND_HITACHI_AC1=true \
            -DDECODE_HITACHI_AC1=false \
            -DSEND_HITACHI_AC2=true \
            -DDECODE_HITACHI_AC2=false \
            -DSEND_HITACHI_AC3=true \
            -DDECODE_HITACHI_AC3=false \
            -DSEND_HITACHI_AC264=true \
            -DDECODE_HITACHI_AC264=false \
            -DSEND_HITACHI_AC296=true \
            -DDECODE_HITACHI_AC296=false \
            -DSEND_HITACHI_AC344=true \
            -DDECODE_HITACHI_AC344=false \
            -DSEND_HITACHI_AC424=true \
            -DDECODE_HITACHI_AC424=false \
            -DSEND_TCL112AC=true \
            -DDECODE_TCL112AC=true \
            -DSEND_TCL96AC=true \
            -DDECODE_TCL96AC=true \
            -DSEND_TEKNOPOINT=true \
            -DDECODE_TEKNOPOINT=true \
            -DDECODE_MITSUBISHI112=true \
            -DSEND_MITSUBISHI=true \
            -DSEND_MITSUBISHI2=true \
            -DSEND_MITSUBISHI_AC=true \
            -DSEND_MITSUBISHI136=true \
            -DSEND_MITSUBISHI112=true \
            -DSEND_PANASONIC=true \
            -DDECODE_PANASONIC=true \
            -DSEND_PANASONIC_AC=true \
            -DDECODE_PANASONIC_AC=true \
            -DSEND_PANASONIC_AC32=true \
            -DDECODE_PANASONIC_AC32=true \
            -DSEND_SAMSUNG=true \
            -DDECODE_SAMSUNG=true \
            -DSEND_SAMSUNG36=true \
            -DDECODE_SAMSUNG36=true \
            -DSEND_SAMSUNG_AC=true \
            -DDECODE_SAMSUNG_AC=true \
            -DSEND_LG=true \
            -DDECODE_LG=true \
            -DSEND_LG2=true \
            -DSEND_CARRIER_AC=true \
            -DDECODE_CARRIER_AC=true \
            -DSEND_CARRIER_AC40=true \
            -DDECODE_CARRIER_AC40=true \
            -DSEND_CARRIER_AC64=true \
            -DDECODE_CARRIER_AC64=true \
            -DSEND_CARRIER_AC84=true \
            -DDECODE_CARRIER_AC84=true \
            -DSEND_CARRIER_AC128=true \
            -DDECODE_CARRIER_AC128=true \
            -DSEND_HAIER_AC=true \
            -DDECODE_HAIER_AC=true \
            -DSEND_HAIER_AC_YRW02=true \
            -DDECODE_HAIER_AC_YRW02=true \
            -DSEND_HAIER_AC160=true \
            -DDECODE_HAIER_AC160=true \
            -DSEND_HAIER_AC176=true \
            -DDECODE_HAIER_AC176=true \
            -I$(VENDOR)/src \
            -I$(VENDOR)/test

SRCS := runner.cpp \
        $(VENDOR)/src/IRsend.cpp \
        $(VENDOR)/src/IRtimer.cpp \
        $(VENDOR)/src/IRutils.cpp \
        $(VENDOR)/src/IRtext.cpp \
        $(VENDOR)/src/ir_NEC.cpp \
        $(VENDOR)/src/ir_Daikin.cpp \
        $(VENDOR)/src/ir_Coolix.cpp \
        $(VENDOR)/src/ir_Gree.cpp \
        $(VENDOR)/src/ir_Kelvinator.cpp \
        $(VENDOR)/src/ir_Kelon.cpp \
        $(VENDOR)/src/ir_Teco.cpp \
        $(VENDOR)/src/ir_Voltas.cpp \
        $(VENDOR)/src/ir_Hitachi.cpp \
        $(VENDOR)/src/ir_Tcl.cpp \
        $(VENDOR)/src/ir_Teknopoint.cpp \
        $(VENDOR)/src/ir_Mitsubishi.cpp \
        $(VENDOR)/src/ir_Panasonic.cpp \
        $(VENDOR)/src/ir_Samsung.cpp \
        $(VENDOR)/src/ir_LG.cpp \
        $(VENDOR)/src/ir_Carrier.cpp \
        $(VENDOR)/src/ir_Haier.cpp \
        $(VENDOR)/src/IRrecv.cpp

runner: $(SRCS)
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) -o $@ $(SRCS)

# Standalone capture-identification tool: compiles EVERY IRremoteESP8266
# protocol decoder (via _IR_ENABLE_DEFAULT_=true) and runs IRrecv::decode on a
# capture. Use it to triage unknown edge arrays, including protocols not yet
# ported to irtxrx.   Usage:  make identify && ./identify "<csv_edges_usec>"
identify: identify.cpp
	$(CXX) -std=gnu++11 -w -O1 -DUNIT_TEST -D_IR_LOCALE_=en-AU \
	    -D_IR_ENABLE_DEFAULT_=true \
	    -I$(VENDOR)/src -I$(VENDOR)/test -o $@ identify.cpp \
	    $(VENDOR)/src/ir_*.cpp \
	    $(VENDOR)/src/IRrecv.cpp $(VENDOR)/src/IRsend.cpp \
	    $(VENDOR)/src/IRutils.cpp $(VENDOR)/src/IRtext.cpp \
	    $(VENDOR)/src/IRtimer.cpp

clean:
	rm -f runner identify

.PHONY: clean
