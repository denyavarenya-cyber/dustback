# Small helpers to drive one Android emulator. Source this file.
#   ANDROID_HOME  the SDK (default: the Android Studio location on Windows)
#   ADB_SERIAL    which device (default emulator-5554, the first emulator)
ADB0="${ANDROID_HOME:-$HOME/AppData/Local/Android/Sdk}/platform-tools/adb"
ADB="$ADB0 -s ${ADB_SERIAL:-emulator-5554}"
export MSYS_NO_PATHCONV=1
shot() { $ADB exec-out screencap -p > "$1"; }
dump() { $ADB shell rm -f /sdcard/win.xml >/dev/null 2>&1; $ADB shell uiautomator dump /sdcard/win.xml >/dev/null 2>&1; $ADB shell cat /sdcard/win.xml 2>/dev/null; }
texts() { dump | grep -o 'text="[^"]*"\|content-desc="[^"]*"' | grep -v '=""' ; }
# Tap the centre of the first node whose text or content-desc is exactly $1.
tapt() {
  local b=$(dump | tr '>' '\n' | grep -F "text=\"$1\"" | head -1 | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | tr '\n' ' ')
  [ -z "$b" ] && { echo "no node: $1"; return 1; }
  set -- $b; $ADB shell input tap $(( ($1+$3)/2 )) $(( ($2+$4)/2 )); echo "tapped ($(( ($1+$3)/2 )),$(( ($2+$4)/2 )))";
}
swipeup() { $ADB shell input swipe 540 1800 540 700 400; }
