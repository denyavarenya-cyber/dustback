# Store submission checklists

Assets in this folder: `icon-512.png` (both stores). Feature graphic
(1024×500, Google Play) is NOT here — use the one from the brand work; drop it
in as `feature-graphic.png` before submitting.

## Listing copy (both stores)

- Title: **DustBack: Wallet Cleanup**
- Short description (≤30 chars for dApp Store): **Recover unused wallet value.**
  Google Play short description (≤80 chars): **Recover unused wallet value from
  empty accounts and token dust.**
- Full description draft:

  > Every Solana wallet slowly collects leftovers: empty token accounts that
  > still hold a small SOL deposit, and dust balances too small to trade by
  > hand. DustBack scans any wallet address, shows exactly what can be
  > recovered, closes the empty accounts and swaps the dust to SOL in one
  > reviewed, signed sweep.
  >
  > Scanning is read-only and needs only a public address — no connection, no
  > signature, no permissions. Before anything is signed you see every
  > account, every swap and the exact fee. DustBack never requests token
  > approvals or delegates, never sees your seed phrase, and runs no backend:
  > requests go only to your RPC endpoint and Jupiter's public APIs.
  >
  > The 8% service fee is a visible transfer instruction and is only charged
  > on value actually delivered — a swap that fails is never charged. The app
  > is open source.

## a. Google Play

1. Play Console → create app (app.dustback), free, app category Finance.
2. Upload the signed AAB (`android/app/build/outputs/bundle/release/app-release.aab`)
   to a **closed testing** track first; add tester emails; roll out.
3. **Data safety form** (matches site/privacy.html):
   - Data collected: none. Data shared: none.
   - No encryption-in-transit question issues (all requests HTTPS).
   - Wallet addresses are user-provided input processed ephemerally to deliver
     the requested function; nothing is retained by the developer — answer
     "no data collected" per Google's definition (not stored beyond the
     request's needs).
4. **Content rating questionnaire**: Utility/Finance app; no user-generated
   content, no gambling (real-money trading of crypto assets is declared via
   the finance questions, not gambling), no violence. Expected rating:
   Everyone / PEGI 3.
5. **Financial features declaration**: declare cryptocurrency
   exchange/wallet-adjacent functionality honestly: the app composes
   transactions the user signs in an external wallet; it does not custody
   funds, does not on/off-ramp fiat, and is not a bank/loan product. If the
   form's "cryptocurrency exchanges" option requires a license statement,
   state that DustBack is a non-custodial transaction-builder using external
   wallets and public DEX routing (Jupiter).
6. Store listing: title, descriptions above, icon 512, feature graphic
   1024×500, screenshots (below), privacy policy URL
   `https://dustback.app/privacy.html`, contact `hello@dustback.app`.

## b. Solana dApp Store

Current process (verified against docs.solanamobile.com, Sept 2026): first
submission happens in the **Publisher Portal**, CLI is for later updates.

1. Portal: sign up at https://publish.solanamobile.com, complete KYC/KYB.
2. Connect a Solana wallet (Phantom/Solflare/Backpack) holding ~0.2 SOL for
   mint/storage fees; choose ArDrive as the storage provider. Publisher, app
   and each release are minted as NFTs from this wallet — use a dedicated
   publisher keypair and back it up like the upload keystore.
3. Add the dApp: name, descriptions above (short ≤30 chars), icon 512×512,
   screenshots at least 1080px on both axes, consistent orientation and equal
   aspect ratio (optional .mp4 preview, 1080p recommended).
4. New version → upload the signed **APK**
   (`android/app/build/outputs/apk/release/app-release.apk` — dApp Store takes
   APK, not AAB), approve every signing request in the wallet (skipping one
   aborts the mint), submit.
5. Review takes 3-5 business days; chase via Solana Mobile Discord
   `#dev-answers` if silent after 5.
6. Later releases via CLI: `npm i -D @solana-mobile/dapp-store-cli`, then
   `npx dapp-store --apk-file app-release.apk --keypair publisher.json
   --whats-new "..."` with `DAPP_STORE_API_KEY` set (portal → API keys).

## Screenshots to capture (manual, on the emulator)

Target 1080×2400 (Pixel 7 native), portrait, same aspect for all:

1. Scan screen — light
2. Results with real-looking data (several dust rows with symbols) — light
3. Review before signing (details expanded) — light
4. Done after a successful sweep — light
5. Results — dark

Capture: `adb exec-out screencap -p > shot.png` with the emulator set to the
wanted color scheme.
