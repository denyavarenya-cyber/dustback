# Running the app

## Release signing

Two keystores live in `android/app/` and are configured through
`android/keystore.properties` (all gitignored). **Back all three files up
off-machine now** — losing a keystore permanently ends your ability to update
the app in that store; there is no recovery.

- `upload-keystore.jks` (`storeFile`/`storePassword`/`keyAlias`/`keyPassword`
  in keystore.properties) — the Google Play upload key. Build with
  `cd android && .\gradlew bundleRelease` (AAB) or `.\gradlew assembleRelease`
  (APK). Output: `app/build/outputs/{bundle,apk}/release/`.
- `dappstore-keystore.jks` (`dappstoreStoreFile`/`dappstoreStorePassword`/
  `dappstoreKeyAlias`/`dappstoreKeyPassword`) — the Solana dApp Store key,
  deliberately separate from the Play key. Build with
  `.\gradlew assembleReleaseDappstore`. Output:
  `app/build/outputs/apk/releaseDappstore/`.

Both build types are identical apart from the signing key. Each falls back to
debug signing when its properties are absent, so a fresh clone still builds.
Note that `npx expo prebuild --clean` regenerates `android/app/build.gradle`
and wipes both signing blocks and the `releaseDappstore` build type —
restore with `git checkout -- android/app/build.gradle` after any clean
prebuild (the committed file carries the config), then re-check the diff.

The app now uses native modules (Mobile Wallet Adapter), so Expo Go no longer works. Instead of scanning the QR code with Expo Go, build and install the dev client once with `npx expo run:android` (emulator running or device plugged in); after that, day-to-day development is `npx expo start` and opening the installed "DustBack" app — it connects to the same Metro server and hot-reloads exactly like Expo Go did. Rebuild with `npx expo run:android` only when native dependencies change.
