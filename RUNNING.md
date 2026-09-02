# Running the app

The app now uses native modules (Mobile Wallet Adapter), so Expo Go no longer works. Instead of scanning the QR code with Expo Go, build and install the dev client once with `npx expo run:android` (emulator running or device plugged in); after that, day-to-day development is `npx expo start` and opening the installed "DustBack" app — it connects to the same Metro server and hot-reloads exactly like Expo Go did. Rebuild with `npx expo run:android` only when native dependencies change.
