# Running the app

## Release signing

Keystores live **outside the repo** in a `dustback-keys` folder in the user profile and
are referenced by absolute path from `keystore.properties` at the repo root
(gitignored). Never put them under `android/` — `npx expo prebuild --clean`
deletes that whole directory, gitignored files included; the upload key was
wiped exactly that way on 2026-09-13 and only survived because a copy
existed in a backup outside the project folder. **Keep the whole `dustback-keys` folder plus
`keystore.properties` backed up off-machine.**

- `upload-keystore.jks` (`storeFile`/`storePassword`/`keyAlias`/`keyPassword`)
  — the Google Play upload key. Build with `cd android && .\gradlew
  bundleRelease` (AAB) or `.\gradlew assembleRelease` (APK). Output:
  `app/build/outputs/{bundle,apk}/release/`. `upload_certificate.pem` beside
  it is what Play Console asks for in an upload-key reset.
- `dappstore-keystore.jks` (`dappstoreStoreFile`/`dappstoreStorePassword`/
  `dappstoreKeyAlias`/`dappstoreKeyPassword`) — the Solana dApp Store key,
  deliberately separate from the Play key. Build with
  `.\gradlew assembleReleaseDappstore`. Output:
  `app/build/outputs/apk/releaseDappstore/`.

Both build types are identical apart from the signing key. Each falls back to
debug signing when its properties are absent, so a fresh clone still builds.
`npx expo prebuild --clean` still regenerates `android/app/build.gradle` and
wipes both signing blocks and the `releaseDappstore` build type — restore
with `git checkout -- android/app/build.gradle` afterwards (the committed
file carries the config) and re-check the diff.

The app now uses native modules (Mobile Wallet Adapter), so Expo Go no longer works. Instead of scanning the QR code with Expo Go, build and install the dev client once with `npx expo run:android` (emulator running or device plugged in); after that, day-to-day development is `npx expo start` and opening the installed "DustBack" app — it connects to the same Metro server and hot-reloads exactly like Expo Go did. Rebuild with `npx expo run:android` only when native dependencies change.
