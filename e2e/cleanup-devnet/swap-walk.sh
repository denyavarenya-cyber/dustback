# Swap confirm screen in mock mode, three tokens. Usage: bash swap-walk.sh <out-dir>
set -e
OUT="$1"; mkdir -p "$OUT"
. "$(dirname "$0")/adb.sh"
B="http://127.0.0.1:8090/index.bundle?platform=android&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&unstable_transformProfile=hermes-stable"
until curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8090/status | grep -q 200; do sleep 2; done
curl -s -o /dev/null "$B"
$ADB reverse tcp:8788 tcp:8788 >/dev/null
wait_for() { for i in $(seq 1 60); do texts | grep -q "$1" && return 0; sleep 2; done; echo "timeout waiting for: $1"; texts > "$OUT/timeout.txt"; return 1; }
open() {
  $ADB shell am force-stop host.exp.exponent
  for t in 1 2 3; do
    $ADB shell am start -W -a android.intent.action.VIEW -d "exp://127.0.0.1:8090/--/swap?mint=$1" host.exp.exponent >/dev/null
    sleep 8
    texts | grep -q "Check before you swap" && break
  done
  wait_for 'Example token\|The check service'
  sleep 1
}
down() { for i in $(seq 1 $1); do $ADB shell input swipe 540 1900 540 600 500; sleep 1; done; sleep 1; }

# 1. pulled liquidity: level 3, the gate
open Cq4SiFC3rpx9zTCx2e2nQbweAB3siEGH2eW2CHRdiZ2X
shot "$OUT/l3-1-top.png"
down 2; shot "$OUT/l3-2-facts.png"
down 6; shot "$OUT/l3-3-gate.png"; texts > "$OUT/l3-gate.txt"
tapt "I read the warning. Level 3, high risk: The creator removed a launch's liquidity within 72 hours of the launch."
sleep 1; shot "$OUT/l3-4-gate-tapped.png"
tapt "Simulate swap"; sleep 1; down 1; shot "$OUT/l3-5-simulated.png"; texts > "$OUT/l3-simulated.txt"

# 2. fake official asset: level 2, no gate
open BBF3FfGm2hV7mGaJtHyFz2Yg5DhVqQKQYV4N2iisyCtF
down 2; shot "$OUT/l2-1-facts.png"
down 6; shot "$OUT/l2-2-bottom.png"; texts > "$OUT/l2.txt"

# 3. a mint the core has no answer for: fails closed
open So11111111111111111111111111111111111111112
shot "$OUT/none-1-top.png"
down 6; shot "$OUT/none-2-bottom.png"; texts > "$OUT/none.txt"
echo "swap walk done"
