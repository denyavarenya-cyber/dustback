# Running the app

## Release signing

Release builds are signed with `android/app/upload-keystore.jks` via
`android/keystore.properties` (both gitignored). **Back both files up
off-machine now** — losing the keystore permanently ends your ability to
update the app on Google Play; there is no recovery. Build with
`cd android && .\gradlew bundleRelease` (AAB, Google Play) or
`.\gradlew assembleRelease` (APK, Solana dApp Store). Note that
`npx expo prebuild --clean` regenerates `android/app/build.gradle` and wipes
the release signing block — re-apply it from git history
(commit "release signing config") after any clean prebuild.

The app now uses native modules (Mobile Wallet Adapter), so Expo Go no longer works. Instead of scanning the QR code with Expo Go, build and install the dev client once with `npx expo run:android` (emulator running or device plugged in); after that, day-to-day development is `npx expo start` and opening the installed "DustBack" app — it connects to the same Metro server and hot-reloads exactly like Expo Go did. Rebuild with `npx expo run:android` only when native dependencies change.
