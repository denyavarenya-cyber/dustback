# DustBack

DustBack is an Android app that recovers unused value from a Solana wallet: it
closes empty token accounts (returning their rent deposit) and swaps dust
balances to SOL in one reviewed, signed sweep. Scanning needs only a public
address; nothing is signed until every account, swap and fee has been shown.

## How a sweep works

1. **Scan** ([src/core/scan.ts](src/core/scan.ts)) reads the wallet's token
   accounts over RPC — both the legacy token program and token-2022. Accounts
   with a zero balance are recoverable rent; the rest are priced via Jupiter
   ([src/core/price.ts](src/core/price.ts)) and anything under $5 is dust.
2. **Close** ([src/core/sweep.ts](src/core/sweep.ts)) builds one `CloseAccount`
   instruction per empty account (12 per transaction). Closing an empty
   account returns its ~0.002 SOL rent deposit to you.
3. **Swap** ([src/core/swap.ts](src/core/swap.ts)) fetches a fresh Jupiter
   quote and swap transaction per dust token at confirm time. Each swap is its
   own transaction; output is unwrapped to native SOL on your wallet.
4. **Fee**: 8% of rent plus **confirmed** swap output, taken as a single
   visible `SystemProgram.transfer` instruction in the final transaction.
   Swaps are sent and confirmed first
   ([src/store.ts](src/store.ts), `confirmSweep`); the fee transaction is
   built afterwards, so a swap that fails on-chain is never charged. If
   nothing is delivered, no fee transaction exists.

Signing happens in your own wallet app via the Solana Mobile Wallet Adapter;
every transaction is preflight-simulated before the wallet opens.

## What the app never does

- never requests token approvals or delegates
- never sees your seed phrase or private keys
- never talks to a DustBack server — there is none
- collects no data; requests go only to your RPC endpoint and Jupiter's public
  APIs, and only to perform the scan or sweep you asked for

## Build and run

Expo dev client (Expo Go does not work — native modules):

```
npm install
npx expo run:android   # once, to build and install the dev client
npx expo start         # day-to-day development
```

Environment (`.env`):

- `EXPO_PUBLIC_RPC_URL` — Solana RPC endpoint (defaults to the public
  mainnet RPC, which rate-limits busy scans)
- `EXPO_PUBLIC_FEE_WALLET` — fee destination address (unset: the fee transfer
  goes back to the owner)

See [RUNNING.md](RUNNING.md) for details.

## Tests

```
npm test
```

Pure-logic unit tests: scan classification, pricing and dust thresholds, sweep
construction and fee math, the two-phase send with partial-failure handling,
and the store pipeline with mocked network and wallet.

## License

[MIT](LICENSE)
