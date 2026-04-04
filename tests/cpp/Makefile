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
            -I$(VENDOR)/src \
            -I$(VENDOR)/test

SRCS := runner.cpp \
        $(VENDOR)/src/IRsend.cpp \
        $(VENDOR)/src/IRtimer.cpp \
        $(VENDOR)/src/IRutils.cpp \
        $(VENDOR)/src/IRtext.cpp \
        $(VENDOR)/src/ir_NEC.cpp \
        $(VENDOR)/src/ir_Daikin.cpp \
        $(VENDOR)/src/ir_Coolix.cpp

runner: $(SRCS)
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) -o $@ $(SRCS)

clean:
	rm -f runner

.PHONY: clean
