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
            -DDECODE_MITSUBISHI112=true \
            -DSEND_MITSUBISHI=true \
            -DSEND_MITSUBISHI2=true \
            -DSEND_MITSUBISHI_AC=true \
            -DSEND_MITSUBISHI136=true \
            -DSEND_MITSUBISHI112=true \
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
        $(VENDOR)/src/ir_Mitsubishi.cpp \
        $(VENDOR)/src/IRrecv.cpp

runner: $(SRCS)
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) -o $@ $(SRCS)

clean:
	rm -f runner

.PHONY: clean
