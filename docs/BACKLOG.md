# Backlog

One line per idea outside the current task. Not discussed or done until the owner picks it.

- Read-only daily fee summary from the fee wallet's transactions (CSV), each line linked to its transaction.
- Token names and symbols on scan rows (Jupiter token search), escaped as text, cached.
- Publish `@noventia/cleanup-core` to npm as compiled ESM with declarations and provenance.
- Move the frozen Android app to a tag so the package can sit at the repo root.
- One harvest instruction per mint for several withheld Token-2022 accounts, to fit more closes per transaction.
- Reuse the scan classification for the public wallet check page and the Telegram /check bot.
- Solana v1 transactions (4096 bytes) once the main wallets sign them; fewer signatures for big cleanups.
- Read the fee account delta from the confirmed transaction too, and show actual against simulated on the result screen.
- Ask Jupiter for a written statement on any share of the `/build` integrator fee.
- Cleanup screen text into the app's i18n files (English strings live in `src/features/cleanup/strings.ts` for now).
- `https://noventia.app/.well-known/assetlinks.json` with the Play app signing key, so Android wallets verify the Noventia app (owner: later).
- Swap confirm screen on a real quote: buying a token (SOL to token) in cleanup-core, simulation only, with the allowlist extended for wrapping SOL (a transfer only to the owner's own wrapped SOL account); the screen and the token check already run in mock mode.
- Use agent 1's wallet connection in cleanup once it lands, instead of the minimal one in `src/features/cleanup/wallet`.
- Run the cleanup flow on a real Android device and in Phantom on devnet before any mainnet step.
- The Noventia mark for the dustback.app page once the owner provides an SVG or a transparent PNG; the text mark stays until then.
- Level 4 warnings (confirmed fraud) on the swap confirm screen: the owner may want the swap stopped there instead of one extra tap.
- The select screen shows each account's mint and the confirm screen its address; label both, or show both on both screens.
- Raw `fontWeight` in the app's screens (about 90 places) and the `v5.type` ramp still draw the system font; moving them to `typography.family` is the theme owner's sweep.
- Devnet SOL for tests: a small funded devnet wallet kept by the owner, or a paid RPC plan with a devnet faucet, so end to end runs do not wait on the web faucet.
- cleanup-core `createHttpTransport` gives up on HTTP 429; retry scan and status reads with a growing pause, and use a paid RPC for mainnet (the public devnet RPC answered 429 during the first devnet run).
