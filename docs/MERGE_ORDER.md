# Merge order: wallet cleanup, swaps, /check page, /check bot

Updated 1 November 2026. One list for every branch and pull request of this
work, across four repositories. Each PR description points here and repeats its
own line. Everything is a draft; the owner merges.

## Order

| # | Repository | PR / branch | Into | Depends on | Notes |
|---|---|---|---|---|---|
| 1 | dustback | push `agent2/cleanup-core`, `agent2/site`, `release/cleanup-core`, tags `cleanup-core-v0.1.0` to `v0.1.4` | | owner: "collaborator added" | Not on GitHub yet. Until the tags are there, `npm ci` fails on Noventia_app #6. |
| 2 | dustback | `agent2/cleanup-core` | `master` | 1 | `packages/cleanup-core` 0.1.4, audit, fees, Phantom pack, e2e kit, this file. |
| 3 | dustback | `agent2/site` | `master` | 1; the page deployed (owner: "wrangler logged in") | Merge after the deploy, so `master` is what is live. Independent of 2. |
| 4 | Noventia_app | #5 `feat/cleanup-deps` | `v5/foundation` | none | Solana packages only. Agent 1's #11 already contains it, so #5 goes first. |
| 5 | Noventia_app | #7 `feat/one-dark-theme` (agent 1) | `v5/foundation` | none | The theme. |
| 6 | Noventia_app | #10 `feat/plex-fonts` | `feat/one-dark-theme` | 5 | IBM Plex in the theme. Merge into #7 before #7 merges, or retarget to `v5/foundation` after. |
| 7 | Noventia_app | #6 `feat/cleanup` | `feat/plex-fonts` | 1, 4, 6 | Cleanup screens on the theme, swap confirm screen in mock mode. Pins `cleanup-core-v0.1.4`. Retarget to `v5/foundation` once #10 and #7 are in. |
| 8 | noventia-app | #4 `agent2/check` | `main` | none | `/check` page in mock mode on `@noventia/core-api` v1.0.0 (public). No menu link until it reads the real core. |
| 9 | noventia-check-bot | #1 `agent2/check-bot` | `main` | none to merge | Deploy waits for the core staging (`docs/DEPLOY.md`). |

Agent 1's #9 (passport) and #11 (wallet sign-in) also sit on #7. #6 and #11 meet
only in `package.json`, the lock file, and one line each in `MainNavigator.js`
and `SettingsScreen.js`; whichever merges second rebases.

## Pinned versions

* Noventia_app #6: `@noventia/cleanup-core` `github:noventiaproject-ops/dustback#cleanup-core-v0.1.4`
  (commit `421ac7b`). If the repo stays under `denyavarenya-cyber`, the pin moves to
  that address in the same PR.
* noventia-app #4: `@noventia/core-api` `github:noventiaproject-ops/noventia-core-api#v1.0.0`.

## Owner steps that are not merges

| When | Step | Where it is written |
|---|---|---|
| Any time | `npx wrangler login`, then tell the agent "wrangler logged in": assetlinks hotfix, then the page | `dustback-hotfix/OWNER_STEPS.md`, `docs/SITE_DEPLOY.md` (branch `agent2/site`) |
| Any time | Add `noventiaproject-ops` as collaborator, tell the agent "collaborator added" | step 1 above |
| During a run | 0.1 devnet SOL to the address the run prints, from faucet.solana.com | `docs/E2E_DEVNET.md` |
| A week after the page is live | Phantom review form | `docs/PHANTOM_REVIEW.md` |
| After the core staging | `NEXT_PUBLIC_CORE_API_URL` on Vercel, bot on Railway | noventia-app `docs/CHECK.md`, noventia-check-bot `docs/DEPLOY.md` |
