# DustBack audit

Date: 31 October 2026. Scope: the whole repository at `master` 7eed2c0 (DustBack 1.0.2,
Expo SDK 57, React Native 0.86), its git history on all branches, the static site in
`site/`, and the build config. Nothing was deployed, signed or sent while auditing.
Findings are ordered worst first. Paths and lines refer to commit 7eed2c0.

## Red line check first

**No code in the current tree or anywhere in the history creates, imports, stores or
logs a private key or a seed phrase, and nothing signs for a user.**

* `git log --all -S<term>` over `Keypair`, `secretKey`, `privateKey`, `mnemonic`,
  `bip39`, `fromSecretKey`, `partialSign` finds no commit that touched code with them.
  The words "seed phrase" appear only in user facing promises (`README.md:33`,
  `site/privacy.html:46`, `store-assets/SUBMISSION.md:24`).
* Signing happens only in the user's wallet through Mobile Wallet Adapter
  (`src/core/wallet.ts:157`, `wallet.signAndSendTransactions`).
* No token approval, delegate or burn instruction exists anywhere in the code.
* The only key material near the project is the owner's own Android signing keys,
  kept outside the repo, in the owner's key folder and its backup
  (see finding 1 for the one key that is a problem). They were not touched.

So nothing has to be removed for key handling. The problems below are about what a
user could be asked to sign, and about trust.

## Findings

### 1. Critical: the live asset links file vouches for a public debug key

* `site/.well-known/assetlinks.json:9` lists the certificate fingerprint
  `FA:C6:17:45:…:91:03:3B:9C`. `keytool` on `android/app/debug.keystore` (committed
  since c5f2d73, password `android`, public repo) prints exactly this SHA-256.
* `site/.well-known/README.md:11` documents it as "shared Android debug keystore".
* It is live: a plain GET of `https://dustback.app/.well-known/assetlinks.json` on
  31 October 2026 returned all three fingerprints, `FA:C6` included.
* Effect: anyone can build an APK with package `app.dustback`, sign it with that public
  key, and wallets that check Digital Asset Links (Phantom on Android, via Mobile Wallet
  Adapter identity verification) will show it as the verified `dustback.app`. A
  phishing clone gets our verified name for free.
* Made worse by `android/app/build.gradle:140` and `:152`: when `keystore.properties`
  is missing, the `release` and `releaseDappstore` builds silently fall back to the
  debug key, so a "release" APK can be signed with the public key without anyone
  noticing.
* Status 31 October: wrangler on this machine is not logged in, so the agent did not
  deploy. A local hotfix folder outside the repo (`dustback-hotfix`) holds the six live files byte for byte with only
  that line removed, plus `OWNER_STEPS.md` (versions upload, then versions deploy; the
  domains are not touched).
* Fix (owner action, it is a production deploy): remove the `FA:C6` line from the live
  `assetlinks.json` now. Since the DustBack app is frozen, the whole file can go with
  the block E site. The repo copy is fixed in the block E branch.

### 2. High: swap transactions from a third party API are signed without being inspected

* `src/core/swap.ts:100-123` fetches a ready made transaction from
  `lite-api.jup.ag/swap/v1/swap` and deserializes it (`swap.ts:120`).
  `src/store.ts:380-393` only checks that simulation does not return an error, then
  `src/store.ts:395` hands it to the wallet.
* Nothing checks the fee payer, which programs are called, which of the user's
  accounts are writable, or that the transaction contains no `Approve`,
  `SetAuthority`, `Burn` or `CloseAccount` with a foreign destination. If that keyless
  endpoint, or anything between it and the phone, returned a hostile transaction, the
  user would be asked to sign it under the DustBack name.
* The endpoint itself is outdated: `lite-api.jup.ag/swap/v1` is the Metis API that
  Jupiter now marks as no longer actively maintained (see `docs/FEES.md`).
* Fix (done in the new module): ask Jupiter for instructions (`/swap/v2/build`), check
  every instruction against an allowlist, refuse any user token account other than the
  one being swapped as writable, compile the transaction ourselves with lookup tables
  read from our own RPC, then simulate.

### 3. High: the user does not choose what is swapped or closed

* `src/screens/ResultsScreen.tsx:63` starts with an empty "excluded" set and `:79`
  selects every dust token by default. Dust is anything priced under 5 USD
  (`src/config.ts:6`). Every airdropped or small token the user may want to keep is
  sold unless they untick it.
* `ResultsScreen.tsx:64` and `:78`: all empty accounts are one checkbox, on by default,
  with no way to keep a single account.
* This breaks the rule that the user selects each action. Fix (done in the module):
  nothing is selected by default; selection is per account and the plan refuses any
  account that was not selected.

### 4. High: the swap fee is a second transaction, on quoted rather than delivered value

* Swaps are signed first; the fee is computed afterwards and sent in a later
  transaction with the closes (`src/store.ts:431-516`, `src/core/swap.ts:156-208`).
  When there is nothing to close, the fee is a transaction of its own: a bare SOL
  transfer to the fee wallet (`swap.ts:201-206`).
* The new rule is that the fee is an instruction inside the same transaction, with its
  amount shown before signing. The old flow does the opposite.
* The fee basis uses the quote, not what arrived: `src/store.ts:417` adds
  `quotedSolOut` for each confirmed swap. With 1 percent slippage (`swap.ts:18`) the
  fee can be computed on up to 1 percent more than the user received.
* The rate is 8 percent of rent plus swap output (`src/config.ts:10`), far above the
  market (see `docs/FEES.md`).

### 5. High: anything with a zero balance is treated as closable

* `src/core/scan.ts:81-87` puts every account whose amount is `"0"` into the close
  list. It does not look at the account state, the close authority or Token-2022
  extensions.
* A frozen account, an account whose close authority is another address, a Token-2022
  account with withheld transfer fees, or one with a confidential transfer balance
  cannot be closed by the owner. One such account makes its whole batch fail; the
  phase 2 simulation failure then stops every close (`src/store.ts:455-466`), and the
  user sees a raw log line.
* Batches are a fixed 12 closes (`src/core/sweep.ts:15`) instead of being measured
  against the 1232 byte limit.
* No loss of funds results (the chain rejects these closes), but the user gets a
  failure they cannot understand. Fix (done in the module): classify frozen, foreign
  close authority, confidential transfer and unknown extensions as blocked; harvest
  withheld fees to the mint first; batch by measured size.

### 6. Medium: with no fee wallet set, the "fee" is a transfer to the user

* `src/core/swap.ts:177` falls back to the owner when `FEE_WALLET` is unset
  (`src/config.ts:9`). The review screen still shows "Fee (8%)" with an amount. The
  number shown does not match what happens. Fix (done in the module): no fee wallet,
  no fee instruction, fee shown as zero.

### 7. Medium: mainnet only, no devnet

* `src/core/wallet.ts:13` hardcodes `solana:mainnet-beta`; `src/config.ts:2-3` defaults
  to the public mainnet RPC. Every manual test was a mainnet transaction (the
  1 September double charge happened on mainnet). Fix (done in the module): the
  cluster comes from config and defaults to devnet; mainnet needs an explicit
  setting.

### 8. Medium: the old test suite no longer runs; no typecheck or lint script

* `npm test` on this machine today: 5 of 8 suites fail to load (`createRequireEsmError`
  from a dependency), 25 tests in the other 3 pass. `package.json` has no typecheck or
  lint script and no ESLint.

### 9. Medium: dependencies

* `@solana/web3.js` 1.98.4 with a caret range (`package.json:9`). The 1.x line gets
  maintenance releases only (1.99.0, September 2026); the current line is 3.1.1, built
  on `@solana/kit`. The Mobile Wallet Adapter packages are at 2.3.0 with caret ranges;
  current is 3.0.1, which needs `@solana/web3.js` ^1.99 or `@solana/kit`.
* All runtime dependencies use caret or tilde ranges; only the lockfile pins them.
* `npm audit` on the production tree: 26 findings (1 critical in `shell-quote`, 6 high).
  All sit in Expo and React Native build tooling except one: `@solana/web3.js` pulls
  `jayson`, which pulls a `uuid` with a moderate advisory. Deprecated packages in the
  tree: `uuid` 8.3.2 and 7.0.3, `glob` 10.5.0.
* `react-native-view-shot`, `expo-sharing` and `expo-store-review` serve only the
  share card and the review prompt.

### 10. Medium: the site has no security headers and posts emails to Apps Script

* `site/` has no headers file, so the Worker serves it without a Content Security
  Policy, framing protection or HSTS of its own. Confirmed on 31 October 2026: the
  response for `https://dustback.app/` carries no `Content-Security-Policy`,
  `Strict-Transport-Security`, `X-Frame-Options` or `X-Content-Type-Options` header.
* `site/index.html:48` and `:117` post a tester form (email, handle) to a
  `script.google.com` web app with `fetch(..., { mode: 'no-cors' })`. That is the same
  technique phishing kits use to collect data, on a domain that also asks people to
  connect a wallet in the app. Emails land in a Google Sheet.
* Fix: block E replaces the site with one static page with strict headers and no form.

### 11. Low: debug output in release builds

* `src/store.ts:363`, `:384`, `:401`, `:413`, `:440`, `:485` call `console.log` in
  production paths (signatures, fee basis). These are public values, not secrets.
  Wallet adapter tracing (`src/core/wallet.ts:15-38`) runs only in development and
  masks the auth token to 6 characters.

### 12. Low: last scanned address kept on the device

* `src/store.ts:187` stores the last scanned address in AsyncStorage. It is a public
  address and never leaves the device, but it is a record of what someone looked at.

## Why Phantom marks the site "not safe", as far as code and config show

The exact warning text decides the path; ask the owner for a screenshot. What the
repository shows:

1. **Not the public blocklists.** `dustback.app` is not in `phantom/blocklist`
   (`blocklist.yaml`, `whitelist.yaml`) nor in MetaMask's `eth-phishing-detect`
   `src/config.json` (both checked 31 October 2026). Two unrelated Phantom entries
   contain "sweepers" (`degensweepers.online`, `degensweepers.top`). So the warning comes
   from Phantom's own scoring (domain review or transaction simulation), not from a
   public list.
2. **Drainer shaped transactions.** The phase 2 transaction is up to 12 `CloseAccount`
   instructions plus a `SystemProgram.transfer` to an address with no other history
   (`src/core/sweep.ts:107-114`, `src/core/swap.ts:178-205`); after swaps it can be a
   bare SOL transfer to that address (`swap.ts:201-206`). Closing many accounts and
   sending SOL to an unknown wallet, in a second request after a first one, is how
   drainers look to a transaction scanner.
3. **App identity.** For installs from Google Play the app signing key is missing from
   `assetlinks.json` (`site/.well-known/README.md:15-18`), so Phantom cannot verify the
   app and shows an identity warning on connect. Finding 1 is the opposite problem.
4. **Words and age.** The project was called Sweeper, and the site and app say "sweep"
   (`site/index.html:25`, `README.md:5`). "Sweeper" is the common name for bots that
   empty compromised wallets, and "dust" is the name of an attack. The domain is new
   (September 2026); Phantom shows "This domain is new or has not been reviewed yet"
   until a review.
5. **Page signals.** No Content Security Policy and a form that posts to Apps Script
   with `no-cors` (finding 10).

`docs/PHANTOM_REVIEW.md` is the owner's checklist to clear this.

## What is worth keeping and what goes

Keep, as knowledge carried into the new module (rewritten, not copied):

* Never charge for value that did not arrive. In the module the fee sits inside each
  transaction and is computed from what that transaction itself returns.
* Per signature outcome polling (`src/core/sweep.ts:137-167`).
* The plain message for a fee wallet that is not rent exempt (`sweep.ts:120-130`).
* One shared throttle for Jupiter's keyless limit (`src/core/price.ts:52-80`).
* The measured fact that a Jupiter swap blockhash dies in under a minute: build swaps
  right before signing, never before a screen the user reads.
* Mobile Wallet Adapter session handling and the battery setting help
  (`docs/mwa-authorize-notes.md`, `src/core/wallet.ts:55-121`,
  `src/screens/ConnectTroubleshooting.tsx`). Useful when the Noventia app adds Android
  wallet signing.

Goes (stays in git history and in tag form; nothing is deleted from history):

* The standalone Android app: `App.tsx`, `src/screens/`, `src/store.ts`, `src/ui.tsx`,
  `src/theme.ts`, `android/`, `app.json`, `store-assets/`. It is frozen and will not
  be released on its own.
* The share card and store review prompt with their packages.
* The tester form and `docs/tester-form-apps-script.md`.
* The current site copy and `assetlinks.json` (block E).
* The 8 percent fee and the two phase fee flow.

The owner's signing keys stay where they are and stay backed up; they are not deleted.
