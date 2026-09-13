# assetlinks.json

Digital Asset Links statement binding dustback.app to the Android app
(`app.dustback`). MWA wallets fetch this to verify the dApp identity; without
it Phantom shows the app as unverified on connect.

Fingerprints currently listed:

1. `84:CD:…:D8:45` — Play upload key (also signs local `assembleRelease`).
   Now kept outside the repo; see RUNNING.md.
2. `FA:C6:…:3B:9C` — shared Android debug keystore (dev-client builds)
3. `70:58:…:BD:92` — dApp Store signing key (`assembleReleaseDappstore`),
   separate from the Play upload key by design

Still to be added:

- the Google Play app-signing key — Play re-signs store builds. Copy the
  SHA-256 from Play Console > App integrity > App signing key certificate.

JSON cannot carry comments, hence this file.
