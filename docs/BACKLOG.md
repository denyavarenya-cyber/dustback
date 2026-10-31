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
- Font family tokens (IBM Plex Sans, IBM Plex Mono) in the app theme; cleanup screens already read `typography.family.mono` when it exists.
- Switch the cleanup screens to the shared button once it is flat (no gradient, no glow).
- Cleanup screen text into the app's i18n files (English strings live in `src/features/cleanup/strings.ts` for now).
- `https://noventia.app/.well-known/assetlinks.json` with the Play app signing key, so Android wallets verify the Noventia app.
- Swap preview screen on top of the mainnet simulation (no signing), once Jupiter confirms the fee terms.
- Use agent 1's wallet connection in cleanup once it lands, instead of the minimal one in `src/features/cleanup/wallet`.
- Run the cleanup flow on a real Android device and in Phantom on devnet before any mainnet step.
- The Noventia mark for the dustback.app page once the owner provides the source file.
