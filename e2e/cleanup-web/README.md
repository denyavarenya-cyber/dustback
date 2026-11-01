# Wallet cleanup on the web, end to end against a local stand-in

The app's own `src/features/cleanup` on Expo web, with its real Wallet Standard
wallet module. The passport's "Found in your wallets" block is drawn here with
the passport's own text and cleanup's real button (`FoundCleanupLink`), then the
real cleanup screen. Nothing ships.

A test Wallet Standard wallet is registered in the page. It holds no key: it
asks the devnet stand-in (`../cleanup-devnet/mock-devnet.mjs`, a local JSON-RPC
that answers like devnet) for the address and for signatures, made with a
non-extractable in-memory key that lives in that process only. The signed
transaction goes to the stand-in, never to a cluster.

## Run

1. Copy this folder into a Noventia_app checkout that has the passport and
   cleanup (branch `feat/cleanup-in-passport`) as `.e2e-web/`, and
   `../cleanup-devnet` as `.e2e/`; `npm ci` in the checkout.
2. `node .e2e/mock-devnet.mjs` (RPC on 8798, wallet on 8799; it prints `fee=`).
3. `node .e2e-web/cors-proxy.mjs` (8797, lets the browser reach both).
4. In `.e2e-web`: `EXPO_PUBLIC_FEATURE_CLEANUP=1 EXPO_PUBLIC_FEE_WALLET=<fee=> EXPO_PUBLIC_CLEANUP_DEVNET_RPC_URL=http://127.0.0.1:8797/rpc CI=1 node ../node_modules/expo/bin/cli start --web --port 8095 --localhost`
5. `OUT=shots node run.mjs`: the passport block, connect, select, confirm, result,
   with the screen text and how many signatures the wallet was asked for.

Result on 1 November 2026: five screens, the fee (7 %, 0.000716184 SOL) and the
network fee shown before signing, no signature asked before "Sign in wallet",
one after, "Confirmed", no page errors. Screenshots in Noventia_app
`docs/screenshots/wallet-cleanup-web/`.
