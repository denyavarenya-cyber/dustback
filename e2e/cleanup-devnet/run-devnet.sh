# The funded devnet run, start to finish. Run from this folder inside an app
# worktree (copied there as .e2e/), with the Pixel_7 emulator booted and
# Expo Go for SDK 54 installed on it.
#
#   bash run-devnet.sh <out-dir>
#
# 1. starts the test wallet bridge (keys in memory only) and waits for the
#    "FUND <address>" line; someone sends 0.1+ devnet SOL to that address at
#    https://faucet.solana.com, and the bridge sets up the accounts by itself
# 2. starts Metro with the bridge's fee wallet as EXPO_PUBLIC_FEE_WALLET
# 3. walks the four steps on the emulator, then checks screen against chain
set -e
OUT="$1"; [ -n "$OUT" ] || { echo "usage: bash run-devnet.sh <out-dir>"; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
. "$HERE/adb.sh"
for p in 8090 8799; do $ADB reverse tcp:$p tcp:$p >/dev/null; done
$ADB reverse --remove tcp:8798 >/dev/null 2>&1 || true

node "$HERE/bridge.mjs" > "$OUT/bridge.log" 2>&1 &
BRIDGE=$!
trap 'kill $BRIDGE $METRO 2>/dev/null || true' EXIT
until grep -q "READY\|Error" "$OUT/bridge.log"; do
  grep -m1 "FUND " "$OUT/bridge.log" 2>/dev/null && sleep 30 || sleep 3
done
grep -q READY "$OUT/bridge.log" || { cat "$OUT/bridge.log"; exit 1; }
FEE=$(grep -o "fee=[1-9A-HJ-NP-Za-km-z]*" "$OUT/bridge.log" | head -1 | cut -d= -f2)
echo "bridge ready, fee wallet $FEE"

(cd "$HERE" && EXPO_PUBLIC_FEATURE_CLEANUP=1 EXPO_PUBLIC_FEE_WALLET="$FEE" CI=1 EXPO_NO_TELEMETRY=1 \
  node ../node_modules/expo/bin/cli start --port 8090 --localhost --clear --go > "$OUT/metro.log" 2>&1) &
METRO=$!

bash "$HERE/walk.sh" "$OUT"
sleep 20   # let the last confirmation settle before reading the chain
curl -s http://127.0.0.1:8799/state > "$OUT/state.json"
node "$HERE/check.mjs" "$OUT"
