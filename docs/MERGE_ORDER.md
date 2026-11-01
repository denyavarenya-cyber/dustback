# Merge order: wallet cleanup, swaps, /check page, /check bot

Updated 1 November 2026 (evening), Release 1a. One list for every branch and pull request
of this work, across five repositories. Each PR description points here and repeats its
own line. Done means live for users, so the owner steps that make a merge live are listed
below the merges. Agent 2 merges its own PRs when every check is green, in this order;
anything that deploys to production waits for the owner's "release 1a go" (Release 1 is split: 1a is /check and the bot on the production core, 1b the passport).

## Order

| # | Repository | PR / branch | Into | Depends on | Notes |
|---|---|---|---|---|---|
| 1 | dustback | push `agent2/cleanup-core`, `agent2/site`, `release/cleanup-core`, tags `cleanup-core-v0.1.0` to `v0.1.6` | | | **Done 1 November.** The repo stays at `denyavarenya-cyber/dustback`; `noventiaproject-ops` is a collaborator. |
| 2 | dustback | #1 `agent2/cleanup-core` | `master` | | **Merged 1 November** (`08ca1c5`). `packages/cleanup-core` 0.1.6 (retries on 429, never sends twice, RPC through the core relay), docs, e2e kits, this file. |
| 2a | dustback | #3 `agent2/cleanup-core-0.1.7` | `master` | 2 | `packages/cleanup-core` 0.1.7: passes the Noventia app's non-strict root typecheck (`answer.busy === false`); `npm run check` also runs the app's settings. Tag `cleanup-core-v0.1.7` (`145405b`) pushed 1 November. Docs: relay Origin check, staging results. |
| 3 | dustback | #2 `agent2/site` | `master` | | **Merged 1 November** (`f68929b`). The page is live since 1 November (Worker version `37e6ecbc`, hotfix `82b7db20` first). |
| 4 | Noventia_app | #10 `feat/plex-fonts` | `v5/foundation` | | **Merged 1 November.** IBM Plex. |
| 5 | Noventia_app | #6 `feat/cleanup` | `v5/foundation` | 2a | **Merged 1 November by agent 1** (`e7be685`) after his full gate. Cleanup screens, network switches, `FoundCleanupLink`, swap confirm screen in mock mode. Pins `cleanup-core-v0.1.7`. |
| 6 | Noventia_app | agent 1: #9, #11, #12, #13, #14 | `v5/foundation` | | #9, #13 and #14 merged 1 November (agent 1). Passport, wallet sign-in, web app, release 1. |
| 7 | Noventia_app | #15 `feat/cleanup-in-passport` | `v5/foundation` | 5 | **Merged 1 November by agent 1** (`b32b6a5`) after his full gate. Two lines in the passport's Found card: the way into cleanup. Pins `cleanup-core-v0.1.7`. Live with Release 1b (the passport). |
| 8 | poe-engine | agent 3: #25, #26, #27 | `main` | | **Merged 1 November.** #25 core 1.1.0 (`busy_today`, real `Retry-After`, CORS, look-alike notices, `stale`). #26 the relay `/v1/rpc` (core-api 1.2.0). #27 refuses a foreign Origin with 403 `origin_not_allowed` before any credit (core-api 1.2.1, tag waiting for the owner's push). On staging (build `8c56393`); production core is an owner step. |
| 9 | noventia-app | #4 `agent2/check` | `main` | none to merge | `/check` on the real core. `main` deploys to Vercel Production: **waits for "release 1a go"**. Smoke test against staging: all PASS (1 November, builds `25df21c` and `8c56393`). |
| 10 | noventia-check-bot | #1 `agent2/check-bot` | `main` | none to merge | **Merged 1 November** (`e1e7009`). No deployment until the owner creates the Railway service (`docs/DEPLOY.md`). |
| 11 | noventia-app | #6 `agent2/assetlinks` | `main` | none | Owner steps for the Play signing key fingerprint and a format check. **Waits for "release 1a go"** (same Vercel Production deploy). |
| 12 | noventia-app | #7 `agent2/projects` | `agent2/check`, then `main` | 9 | Noventia for Projects: the project cabinet on example data, **closed in production** (`NEXT_PUBLIC_PROJECTS_APP` unset). Core contract 1.4.0 agreed with agent 3; the core side waits for the owner's decision after Release 1b (`docs/PROJECTS.md` in that branch). Merging deploys nothing new to users while closed, but it goes through Vercel Production, so after "release 1a go". |

## Pinned versions

* Noventia_app #6 and #15: `@noventia/cleanup-core` `github:denyavarenya-cyber/dustback#cleanup-core-v0.1.7`
  (commit `145405b`); the tag is readable over plain https.
* noventia-app #4, noventia-check-bot #1: `@noventia/core-api` `#v1.1.0`. The cleanup module
  needs nothing from 1.2.1: any refusal code other than `upstream_failed` already means
  "nothing was forwarded".

## Owner steps that make it live

| When | Step | Where it is written |
|---|---|---|
| Done 1 November | "wrangler logged in" and "collaborator added" | |
| Release 1a | Three actions: the DNS record `core` in Hostinger, the BotFather token in Railway (project `noventia-check-bot`, service `check-bot`), then "release 1a go". Before it, decision 0: the line "prepare production core" for agent 3 and the Helius key `engine-production` | noventia-app `docs/RELEASE_1A.md` (branch `agent2/check`) |
| After Release 1b | Noventia for Projects: assign the core side, Helius Developer plan or no list checks, the naming reading, appeals, mail provider | noventia-app `docs/PROJECTS.md` (branch `agent2/projects`) |
| After 5 and 7 | `EXPO_PUBLIC_FEATURE_CLEANUP=1` on the app builds (devnet until the next row) | Noventia_app `src/features/cleanup/README.md` |
| When ready for mainnet | Fee wallet in Phantom, written yes, the five variables, one cleanup of own dust; the production core must refuse a foreign Origin (#27) | `docs/FIRST_MAINNET_CLEANUP.md` |
| From 8 November | Phantom review form | `docs/PHANTOM_REVIEW.md` |
| If wanted | `www.dustback.app` as a domain of the Worker (DNS) | `docs/PHANTOM_REVIEW.md` |
| Any time | Play app signing key fingerprint | noventia-app `docs/ASSETLINKS.md` (11) |
