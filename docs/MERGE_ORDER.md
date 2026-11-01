# Merge order: wallet cleanup, swaps, /check page, /check bot

Updated 1 November 2026, Release 1. One list for every branch and pull request of this
work, across five repositories. Each PR description points here and repeats its own line.
Everything is a draft; the owner merges. Done means live for users, so the owner steps
that make a merge live are listed below the merges.

## Order

| # | Repository | PR / branch | Into | Depends on | Notes |
|---|---|---|---|---|---|
| 1 | dustback | push `agent2/cleanup-core`, `agent2/site`, `release/cleanup-core`, tags `cleanup-core-v0.1.0` to `v0.1.6` | | | **Done 1 November.** The repo stays at `denyavarenya-cyber/dustback`; `noventiaproject-ops` is a collaborator. |
| 2 | dustback | #1 `agent2/cleanup-core` | `master` | | `packages/cleanup-core` 0.1.6 (retries on 429, never sends twice, RPC through the core relay), docs (mainnet readiness, first mainnet cleanup, Phantom pack, devnet evidence), e2e kits, this file. |
| 3 | dustback | #2 `agent2/site` | `master` | | **The page is live since 1 November** (Worker version `37e6ecbc`, hotfix `82b7db20` first). Merging makes `master` what is live. Independent of 2. |
| 4 | Noventia_app | #10 `feat/plex-fonts` | `v5/foundation` | | **Merged 1 November.** IBM Plex. |
| 5 | Noventia_app | #6 `feat/cleanup` | `v5/foundation` (retargeted after 4) | 1 | Cleanup screens, network switches, `FoundCleanupLink`, swap confirm screen in mock mode. Pins `cleanup-core-v0.1.6` (relay contract core-api 1.2.0; the tag is pushed in step 1). |
| 6 | Noventia_app | agent 1: #9, #11, #12, #13, #14 | `v5/foundation` | | #9, #13 and #14 merged 1 November (agent 1). Passport, wallet sign-in, web app, release 1. |
| 7 | Noventia_app | #15 `feat/cleanup-in-passport` | `v5/foundation` (retargeted by agent 1) | 1, 5 | Two lines in the passport's Found card: the way into cleanup. Blocked like 5 until the DustBack tag is on GitHub; then agent 1 merges v5/foundation into it, runs the checks and merges. |
| 8 | poe-engine | agent 3: #25 `core/free-plan` | `main` | | **Merged 1 November; `noventia-core-api` v1.1.0 tagged.** `busy_today`, real `Retry-After`, CORS for noventia.app, `notices[]` with look-alike dust, cache `stale`. Then core-api 1.2.0 (tagged): the relay `/v1/rpc` for mainnet cleanup, poe-engine draft #26; live after the owner merges it and deploys the core. |
| 9 | noventia-app | #4 `agent2/check` | `main` | none to merge | `/check` on the real core, limits in plain words, menu flag, look-alike dust, smoke test, `docs/RELEASE_1_CHECKS.md`. Pins core-api v1.1.0; needs core 1.1.0 deployed to show every limit. |
| 10 | noventia-check-bot | #1 `agent2/check-bot` | `main` | none to merge | The bot's share of the core's credits, the same limits and notices. Deploy after the core is live. |
| 11 | noventia-app | #6 `agent2/assetlinks` | `main` | none | Owner steps for the Play signing key fingerprint and a format check. |

## Pinned versions

* Noventia_app #6 and #15: `@noventia/cleanup-core` `github:denyavarenya-cyber/dustback#cleanup-core-v0.1.6`
  (commit `64280ca`); a fresh clone passes a plain `npm ci`.
* noventia-app #4, noventia-check-bot #1: `@noventia/core-api` `#v1.1.0`.

## Owner steps that make it live

| When | Step | Where it is written |
|---|---|---|
| Any time | `npx wrangler login`, then "wrangler logged in": assetlinks hotfix, then the dustback.app page | `dustback-hotfix/OWNER_STEPS.md`, `docs/SITE_DEPLOY.md` (branch `agent2/site`) |
| Any time | Add `noventiaproject-ops` as collaborator, then "collaborator added" | step 1 above |
| Core live (8) | Smoke test, `NEXT_PUBLIC_CORE_API_URL`, then `NEXT_PUBLIC_CHECK_IN_MENU=1` on Vercel; the bot on Railway | noventia-app `docs/RELEASE_1_CHECKS.md`, noventia-check-bot `docs/DEPLOY.md` |
| After 5 and 7 | `EXPO_PUBLIC_FEATURE_CLEANUP=1` on the app builds (devnet until the next row) | Noventia_app `src/features/cleanup/README.md` |
| When ready for mainnet | Fee wallet in Phantom, written yes, the five variables, one cleanup of own dust | `docs/FIRST_MAINNET_CLEANUP.md` |
| A week after the dustback.app page is live | Phantom review form | `docs/PHANTOM_REVIEW.md` |
| Any time | Play app signing key fingerprint | noventia-app `docs/ASSETLINKS.md` (11) |
