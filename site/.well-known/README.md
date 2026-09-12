# assetlinks.json

Digital Asset Links statement binding dustback.app to the Android app
(`app.dustback`). MWA wallets fetch this to verify the dApp identity; without
it Phantom shows the app as unverified on connect.

Fingerprints currently listed:

1. `84:CD:…:D8:45` — Play upload key (also signs local release builds)
2. `FA:C6:…:3B:9C` — shared Android debug keystore (dev-client builds)

Still to be added:

- (a) the separate dApp Store signing key — not created yet; the Play upload
  key will NOT be used for the dApp Store build. Add its SHA-256 once the key
  exists.
- (b) the Google Play app-signing key — Play re-signs store builds. Copy the
  SHA-256 from Play Console > App integrity > App signing key certificate.

JSON cannot carry comments, hence this file.
