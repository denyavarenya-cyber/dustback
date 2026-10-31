# Wallet cleanup, end to end on devnet

The app's own `src/features/cleanup` code on an Android emulator, signing with
a throwaway devnet key, checked against the chain. Nothing here ships: it is a
test kit that runs inside a Noventia_app checkout.

## The key

`bridge.mjs` makes the owner key and the fee wallet key with WebCrypto as
non-extractable `CryptoKey`s (`generateKeyPairSigner` in @solana/kit). There is
no seed and no secret bytes: nothing can print, save or commit them, and they
are gone when the process exits. The bridge refuses to start unless the RPC's
genesis hash is devnet's, and signs only transactions whose fee payer is the
test key and whose blockhash devnet knows. It listens on 127.0.0.1 only; the
emulator reaches it through `adb reverse tcp:8799`.

The app side swaps one module: Metro resolves `./wallet` inside the cleanup
folder to `bridgeWallet.ts`, which asks the bridge for the address and the
signatures. Everything else (scan, fee, build, simulation, submit, outcomes) is
the app's code and @noventia/cleanup-core.

## Files

| File | What it does |
|---|---|
| `bridge.mjs` | Devnet guard, the two keys, funding, test accounts (4 empty Token, 1 empty Token-2022, an NFT, a frozen account, one with a balance), signing, `/verify` |
| `run-devnet.sh` | The whole run: bridge, Metro with the bridge's fee wallet, `walk.sh`, `check.mjs` |
| `walk.sh` | Drives the four steps on the emulator, saves screenshots and screen text |
| `check.mjs` | Screen against chain: fee in the same transaction, amounts, NFT and frozen account untouched; writes `evidence.md` with explorer links |
| `mock-devnet.mjs` | A local RPC stand-in with the same account mix, for screenshots without devnet SOL |
| `swap-walk.sh` | The swap confirm screen in mock mode, three tokens |
| `index.js`, `metro.config.js`, `bridgeWallet.ts`, `app.json`, `babel.config.js`, `package.json` | The Expo entry that renders one feature screen |
| `adb.sh` | Emulator helpers (`ANDROID_HOME`, `ADB_SERIAL`) |

## Run

1. Copy this folder into a Noventia_app checkout of `feat/cleanup` as `.e2e/`
   (add `.e2e/` to `.git/info/exclude`) and `npm ci` there. Until this repo is
   on GitHub, `npm ci` needs git told to read it locally, for example
   `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.file:///C:/Noventia/dustback/.insteadOf
   GIT_CONFIG_VALUE_0=ssh://git@github.com/noventiaproject-ops/dustback.git`.
2. Boot the emulator; install Expo Go for SDK 54 (the version comes from
   `https://api.expo.dev/v2/versions/latest`, `sdkVersions["54.0.0"]`).
3. `bash .e2e/run-devnet.sh <out-dir>` from the checkout.
4. When it prints `FUND <address>`, send 0.1 devnet SOL or more to that
   address at https://faucet.solana.com. The RPC faucet is closed on devnet
   (HTTP 410), and the web faucet asks for a captcha or a GitHub sign-in.
5. The run continues by itself and ends with the evidence table. Exit code 0
   means every check passed.
