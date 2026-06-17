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
            -DSEND_KELVINATOR=true \
            -DDECODE_KELVINATOR=true \
            -DSEND_MIDEA=true \
            -DDECODE_MIDEA=true \
            -DSEND_MIDEA24=true \
            -DDECODE_MIDEA24=true \
            -DSEND_ELECTRA_AC=true \
            -DDECODE_ELECTRA_AC=true \
            -DSEND_VESTEL_AC=true \
            -DDECODE_VESTEL_AC=true \
            -DSEND_TROTEC=true \
            -DDECODE_TROTEC=true \
            -DSEND_TROTEC_3550=true \
            -DDECODE_TROTEC_3550=true \
            -DSEND_NEOCLIMA=true \
            -DDECODE_NEOCLIMA=true \
            -DSEND_AIRTON=true \
            -DDECODE_AIRTON=true \
            -DSEND_DELONGHI_AC=true \
            -DDECODE_DELONGHI_AC=true \
            -DSEND_GORENJE=true \
            -DDECODE_GORENJE=true \
            -DSEND_WHYNTER=true \
            -DDECODE_WHYNTER=true \
            -DSEND_TRUMA=true \
            -DDECODE_TRUMA=true \
            -DSEND_AMCOR=true \
            -DDECODE_AMCOR=true \
            -DSEND_RHOSS=true \
            -DDECODE_RHOSS=true \
            -DSEND_TECHNIBEL_AC=true \
            -DDECODE_TECHNIBEL_AC=true \
            -DSEND_ECOCLIM=true \
            -DDECODE_ECOCLIM=true \
            -DSEND_CORONA_AC=true \
            -DDECODE_CORONA_AC=true \
            -DSEND_AIRWELL=true \
            -DDECODE_AIRWELL=true \
            -DSEND_ARGO=true \
            -DDECODE_ARGO=true \
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
            -DSEND_GOODWEATHER=true \
            -DDECODE_GOODWEATHER=true \
            -DSEND_TRANSCOLD=true \
            -DDECODE_TRANSCOLD=true \
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
            -DSEND_TOSHIBA_AC=true \
            -DDECODE_TOSHIBA_AC=true \
            -DSEND_SHARP=true \
            -DDECODE_SHARP=true \
            -DSEND_SHARP_AC=true \
            -DDECODE_SHARP_AC=true \
            -DSEND_SANYO=true \
            -DDECODE_SANYO=true \
            -DSEND_SANYO_LC7461=true \
            -DDECODE_SANYO_LC7461=true \
            -DSEND_SANYO_AC=true \
            -DDECODE_SANYO_AC=true \
            -DSEND_SANYO_AC88=true \
            -DDECODE_SANYO_AC88=true \
            -DSEND_SANYO_AC152=true \
            -DDECODE_SANYO_AC152=true \
            -DSEND_WHIRLPOOL_AC=true \
            -DDECODE_WHIRLPOOL_AC=true \
            -DSEND_MITSUBISHIHEAVY=true \
            -DDECODE_MITSUBISHIHEAVY=true \
            -DSEND_BLUESTARHEAVY=true \
            -DDECODE_BLUESTARHEAVY=true \
            -DSEND_FUJITSU_AC=true \
            -DDECODE_FUJITSU_AC=true \
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
        $(VENDOR)/src/ir_Midea.cpp \
        $(VENDOR)/src/ir_Electra.cpp \
        $(VENDOR)/src/ir_Vestel.cpp \
        $(VENDOR)/src/ir_Trotec.cpp \
        $(VENDOR)/src/ir_Neoclima.cpp \
        $(VENDOR)/src/ir_Airton.cpp \
        $(VENDOR)/src/ir_Delonghi.cpp \
        $(VENDOR)/src/ir_Gorenje.cpp \
        $(VENDOR)/src/ir_Whynter.cpp \
        $(VENDOR)/src/ir_Truma.cpp \
        $(VENDOR)/src/ir_Amcor.cpp \
        $(VENDOR)/src/ir_Rhoss.cpp \
        $(VENDOR)/src/ir_Technibel.cpp \
        $(VENDOR)/src/ir_Ecoclim.cpp \
        $(VENDOR)/src/ir_Corona.cpp \
        $(VENDOR)/src/ir_Airwell.cpp \
        $(VENDOR)/src/ir_Argo.cpp \
        $(VENDOR)/src/ir_Kelon.cpp \
        $(VENDOR)/src/ir_Teco.cpp \
        $(VENDOR)/src/ir_Voltas.cpp \
        $(VENDOR)/src/ir_Hitachi.cpp \
        $(VENDOR)/src/ir_Tcl.cpp \
        $(VENDOR)/src/ir_Teknopoint.cpp \
        $(VENDOR)/src/ir_Goodweather.cpp \
        $(VENDOR)/src/ir_Transcold.cpp \
        $(VENDOR)/src/ir_Mitsubishi.cpp \
        $(VENDOR)/src/ir_Panasonic.cpp \
        $(VENDOR)/src/ir_Samsung.cpp \
        $(VENDOR)/src/ir_LG.cpp \
        $(VENDOR)/src/ir_Carrier.cpp \
        $(VENDOR)/src/ir_Haier.cpp \
        $(VENDOR)/src/ir_Toshiba.cpp \
        $(VENDOR)/src/ir_Sharp.cpp \
        $(VENDOR)/src/ir_Sanyo.cpp \
        $(VENDOR)/src/ir_Whirlpool.cpp \
        $(VENDOR)/src/ir_MitsubishiHeavy.cpp \
        $(VENDOR)/src/ir_BluestarHeavy.cpp \
        $(VENDOR)/src/ir_Fujitsu.cpp \
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
