# @noventia/cleanup-core

Wallet cleanup and swap planning for Noventia. Pure TypeScript, no UI, runs in
the Expo app on web and Android.

It reads public token accounts, classifies them, and builds **unsigned**
transactions that the user signs in their own wallet. It never asks for,
holds or logs a key or a seed phrase, never signs, and never offers a
transaction whose exact bytes failed simulation. It sends only a transaction
the user signed, unchanged, and never on mainnet before the owner allows it. Lint rules forbid
importing key or signer modules.

## Flow

```
scanWallet          read only: token accounts of a public address, classified
  user selects      per account; nothing is selected by default
prepareCleanup      unsigned close transactions, fee inside each, simulated
previewCleanup      the scan screen numbers, same batching and fees, nothing signable
prepareSwap         one swap to SOL via Jupiter; on mainnet simulation only, no bytes
  wallet signs      in the app, through the user's wallet
submitSignedTransaction  sends the signed bytes if the message is unchanged
waitForOutcomes     confirmed / failed / timeout per signature
explorerTxUrl       link to each transaction
```

## API

| Function | What it does |
|---|---|
| `createConfig(overrides)` | Config with defaults and validation. Throws `INVALID_CONFIG`. |
| `isFeatureEnabled(config, platform, feature)` | `false` on iOS always; otherwise from config. |
| `createHttpTransport(url)` | JSON-RPC over `fetch` with a timeout. Tests pass recorded responses instead. |
| `createJupiterPriceSource({ url, apiKey })` | Jupiter Price API v3, 50 mints per request, throttled. |
| `scanWallet({ rpc, owner, config, prices })` | Checks the RPC serves the configured cluster, reads both token programs, returns `ScanResult`. |
| `classifyEntries(...)` | The same classification from already fetched entries. |
| `planCleanup({ scan, selection, config, platform, lifetime })` | Pure preview: batches and unsigned bytes, no network. |
| `prepareCleanup({ rpc, scan, selection, config, platform })` | Builds, simulates twice (measure, then the final bytes), returns `CleanupOffer` with only passing transactions plus `rejected` with plain reasons. |
| `prepareSwap({ rpc, scan, request, config, platform })` | Jupiter `/swap/v2/build`, allowlist checks, lookup tables read from our RPC, compile, simulate, fee measured in the simulation. Returns `SwapOffer`. |
| `assertBurnAllowed(account, amountRaw, config)` | The burn guard on its own. |
| `previewCleanup({ scan, selection, config, platform })` | Pure numbers for a selection with the same batching and fee rounding as `prepareCleanup`; works while the fee wallet is the placeholder, produces nothing signable. |
| `submitSignedTransaction({ rpc, config, offered, signed })` | Refuses if the wallet changed the message or did not sign it, refuses mainnet before approval, checks the cluster, sends with preflight, returns the signature. |
| `waitForOutcomes({ rpc, signatures })` | Polls signature statuses. |
| `explorerTxUrl(sig, cluster)` / `explorerAddressUrl` | Links; refuses anything that is not a signature or address. |
| `formatSol`, `formatTokenAmount`, `shorten` | Exact text from integers, no floating point. |

Errors are `CleanupError` with a `code`: `FEATURE_DISABLED`, `MAINNET_BLOCKED`,
`CLUSTER_MISMATCH`, `INVALID_CONFIG`, `INVALID_ADDRESS`, `STALE_SCAN`,
`NOT_IN_SCAN`, `NOT_CLOSABLE`, `PROTECTED`, `BURN_REFUSED`, `NOT_SWAPPABLE`,
`FEE_WALLET_NOT_SET`, `RPC_ERROR`, `BAD_RESPONSE`, `UNSAFE_TRANSACTION`, `FEE_ACCOUNT_INVALID`,
`TOO_LARGE`, `SIMULATION_FAILED`.

### Categories

| Category | Meaning | Can be selected for |
|---|---|---|
| `empty` | zero balance | close |
| `withheldFees` | zero balance, Token-2022 fees withheld | harvest to the mint, then close |
| `wrappedSol` | wrapped SOL | unwrap (close) |
| `dust` | priced under `dustThresholdUsd` | swap; burn only if enabled and under `burn.maxValueUsd` |
| `valuable` | priced at or above the threshold | swap |
| `noMarket` | no price | swap; burn only if `burn.allowUnpriced` |
| `nft` | zero decimals with a balance | nothing, ever |
| `frozen` | frozen by the mint | nothing |
| `blocked` | foreign close authority, confidential transfer, unknown extension, non-transferable balance | nothing |

### Where every number comes from

* Rent per account: the account's own lamports from the RPC (`ClassifiedAccount.lamports`).
* Cleanup fee: `floor(rent of the accounts in that transaction × cleanupFeeBps / 10000)`,
  one `SystemProgram.transfer` at the end of that same transaction. A transaction that
  fails costs no fee; there is never a fee-only transaction.
* Swap fee: the Jupiter integrator fee inside the swap instruction; the amount shown is
  the change of the fee account in the simulation of the exact bytes offered, and is
  checked to be no more than `swapFeeBps` of the output.
* Network fee: 5000 lamports per transaction plus, for swaps, the priority fee
  `computeUnitLimit × computeUnitPrice`.

## Config

| Key | Default | Note |
|---|---|---|
| `cluster` | `devnet` | |
| `allowMainnet` | `false` | Stays false until the owner approves mainnet in writing. |
| `features.android` / `features.web` | cleanup on, swap on | iOS has no switch: always off. |
| `feeWallet` | `FEE_WALLET_PLACEHOLDER` | Public address only. The placeholder fails closed (`FEE_WALLET_NOT_SET`); `null` means the owner chose no fee. |
| `cleanupFeeBps` | `300` | Owner decision of 31 October; hard cap 2000. |
| `swapFeeBps` | `50` | Draft; hard cap 200. |
| `swapFeeTokenAccount` | `FEE_WALLET_PLACEHOLDER` | Wrapped SOL account of `feeWallet`; required when both are set. Checked on chain before each swap. |
| `dustThresholdUsd` | `5` | |
| `burn.enabled` | `false` | |
| `burn.maxValueUsd` | `0.1` | |
| `burn.allowUnpriced` | `false` | |
| `maxTransactionBytes` | `1232` | |
| `maxScanAgeSeconds` | `600` | |
| `computeUnitMargin` | `1.2` | |
| `swap.simulationOnly` | `true` | Swaps may be built and simulated on mainnet but return no signable bytes. |
| `swap.slippageBps` | `100` | |
| `swap.maxPriceImpact` | `0.05` | |
| `swap.maxAccounts` | `40` | |
| `swap.maxComputeUnitPriceMicroLamports` | `100000` | |
| `jupiter.swapBaseUrl` | `https://api.jup.ag/swap/v2` | |
| `jupiter.priceUrl` | `https://api.jup.ag/price/v3` | |
| `jupiter.apiKey` | `null` | From an environment variable in the app, never committed. |

## Checks

```
npm install
npm run check      # typecheck, lint, tests
```

Tests run on fixtures in `test/fixtures/` (synthetic data in the exact RPC and
Jupiter formats; regenerate with `node test/fixtures/generate.mjs`). Any real
network call fails the test run.

## Dependencies

| Package | Version | Why | Status |
|---|---|---|---|
| `@solana/kit` | 8.6.0 | Addresses, instructions, message compile with lookup tables, size limits, wire encoding. | Anza, released 28 October 2026. The current Mobile Wallet Adapter 3.0.1 is built on it, so the app needs no second Solana library. |
| `typescript` (dev) | 5.9.3 | Same version as the Noventia app. | Maintained. |
| `vitest` (dev) | 4.1.12 | Test runner. Version 5 needs Node 22; this machine has Node 20. | Maintained. |
| `eslint` (dev) | 10.14.0 | Lint. ESLint 9 is marked unsupported. | Maintained. |
| `@eslint/js` (dev) | 10.0.1 | ESLint base rules. | Maintained. |
| `typescript-eslint` (dev) | 8.72.1 | TypeScript lint rules. | Maintained. |
| `@types/node` (dev) | 20.19.43 | Types for the test files only. | Maintained. |

`npm audit --omit=dev`: 0 vulnerabilities on 31 October 2026.

## Where it lives (proposal)

1. One package, `@noventia/cleanup-core`, in this repo once it moves to `noventiaproject-ops` (renamed `noventia-cleanup`, kept public so anyone can read what a user signs).
2. Each release is published to npm under the `@noventia` scope with an exact version; the app pins that version in one line of `package.json`, so EAS, Vercel and local builds install it without tokens and without copying files.
3. Until the first publish, the app can pin a git tag of this repo; the frozen Android app moves to a tag so the package can sit at the repo root.
