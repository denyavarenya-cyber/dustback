# The funded devnet run, start to finish. Run from this folder inside an app
# worktree (copied there as .e2e/), with the Pixel_7 emulator booted and
# Expo Go for SDK 54 installed on it.
#
#   FUND_WAIT_MIN=720 bash run-devnet.sh <out-dir>
#
# 1. starts the test wallet bridge (keys in memory only) and waits for the
#    "FUND <address>" line; someone sends 0.1+ devnet SOL to that address at
#    https://faucet.solana.com, and the bridge sets up the accounts by itself
#    (FUND_WAIT_MIN minutes to fund it, default 60)
# 2. starts Metro with the bridge's fee wallet as EXPO_PUBLIC_FEE_WALLET and
#    the app's RPC through the bridge (it retries when devnet answers 429)
# 3. walks the four steps on the emulator, then checks screen against chain
#
# Once the address is funded, a failure does not stop the bridge: the key and
# the funds stay, and the script says how to resume.
set -e
OUT="$1"; [ -n "$OUT" ] || { echo "usage: bash run-devnet.sh <out-dir>"; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
. "$HERE/adb.sh"
for p in 8090 8799; do $ADB reverse tcp:$p tcp:$p >/dev/null; done
$ADB reverse --remove tcp:8798 >/dev/null 2>&1 || true

node "$HERE/bridge.mjs" > "$OUT/bridge.log" 2>&1 &
BRIDGE=$!
trap 'kill $METRO 2>/dev/null || true' EXIT
until grep -q "READY http\|STOPPED" "$OUT/bridge.log"; do
  kill -0 $BRIDGE 2>/dev/null || { cat "$OUT/bridge.log"; exit 1; }
  grep -m1 "FUND " "$OUT/bridge.log" 2>/dev/null && sleep 30 || sleep 3
done
if ! grep -q "READY http" "$OUT/bridge.log"; then
  tail -5 "$OUT/bridge.log"
  echo "bridge $BRIDGE keeps the key: curl -X POST http://127.0.0.1:8799/setup to resume"
  exit 1
fi
FEE=$(grep -o "fee=[1-9A-HJ-NP-Za-km-z]*" "$OUT/bridge.log" | head -1 | cut -d= -f2)
echo "bridge ready, fee wallet $FEE"

(cd "$HERE" && EXPO_PUBLIC_FEATURE_CLEANUP=1 EXPO_PUBLIC_FEE_WALLET="$FEE" \
  EXPO_PUBLIC_CLEANUP_RPC_URL=http://127.0.0.1:8799/rpc CI=1 EXPO_NO_TELEMETRY=1 \
  node ../node_modules/expo/bin/cli start --port 8090 --localhost --clear --go > "$OUT/metro.log" 2>&1) &
METRO=$!

if ! bash "$HERE/walk.sh" "$OUT"; then
  echo "walk failed; bridge $BRIDGE keeps the key: rerun walk.sh, then check.mjs"
  exit 1
fi
sleep 20   # let the last confirmation settle before reading the chain
curl -s http://127.0.0.1:8799/state > "$OUT/state.json"
node "$HERE/check.mjs" "$OUT"
kill $BRIDGE
