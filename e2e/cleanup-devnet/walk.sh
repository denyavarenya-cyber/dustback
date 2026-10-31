# Walk the four cleanup steps on emulator-5554 and save screenshots + screen text.
# Usage: bash walk.sh <out-dir>
set -e
OUT="$1"; mkdir -p "$OUT"
. "$(dirname "$0")/adb.sh"
B="http://127.0.0.1:8090/index.bundle?platform=android&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&unstable_transformProfile=hermes-stable"
until curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8090/status | grep -q 200; do sleep 2; done
curl -s -o /dev/null "$B"   # warm the bundle so the first load does not block the app
$ADB shell am force-stop host.exp.exponent
$ADB shell am start -W -a android.intent.action.VIEW -d "exp://127.0.0.1:8090" host.exp.exponent >/dev/null
wait_for() { for i in $(seq 1 60); do texts | grep -q "$1" && return 0; sleep 2; done; echo "timeout waiting for: $1"; texts > "$OUT/timeout.txt"; return 1; }
wait_for "Connect devnet test wallet"
sleep 2
# Close the Expo Go developer menu if it opened over the screen.
if texts | grep -q "developer menu"; then tapt "Continue" || true; sleep 2; fi
# The close button of the Expo Go developer menu, on a 1080x2400 screen.
if texts | grep -q '"Reload"'; then $ADB shell input tap 1012 788; sleep 2; fi
shot "$OUT/1-connect.png"; texts > "$OUT/1-connect.txt"
tapt "Connect devnet test wallet"; wait_for "Select all"
tapt "Select all"; wait_for "You receive"; sleep 1
shot "$OUT/2-select.png"; texts > "$OUT/2-select.txt"
swipeup; sleep 1; shot "$OUT/2-select-bottom.png"; texts > "$OUT/2-select-bottom.txt"
REVIEW=$(texts | grep -o 'text="Review [0-9]* accounts*"' | head -1 | sed 's/text="//;s/"$//')
tapt "$REVIEW"; wait_for "Check before you sign"; sleep 1
shot "$OUT/3-confirm.png"; texts > "$OUT/3-confirm.txt"
tapt "Sign in wallet"; wait_for "Scan again"; sleep 1
shot "$OUT/4-result.png"; texts > "$OUT/4-result.txt"
echo "walk done: $OUT"
