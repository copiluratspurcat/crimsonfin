# CrimsonFin for Android TV

This initial build targets Android TV and Google TV devices running Android 7.0
or later with an up-to-date Android System WebView. It loads the same CrimsonFin
gateway as the desktop app over HTTPS. Local Jellyfin logins, account-specific
libraries, and playback history use the existing gateway.

The gateway must serve the TV navigation and stylesheet from this branch.
The Android TV APK uses the gateway configured in desktop/release-target.json.
The Android TV interface keeps CrimsonFin's shelves, detail screens and player,
with D-pad focus, the Android on-screen keyboard, and remote Back handling.
It uses the shared HLS player. Verify H.264/AAC and subtitles on each target
device before distributing, since WebView versions and codec support vary.

## Build and sideload

Use JDK 17, Gradle 8.11.1 and Android SDK platform 35 with build tools 35.0.0.
From this directory, run:

```sh
gradle :app:lintDebug :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The GitHub Actions Android TV APK workflow also uploads a debug APK. Treat
debug APKs as test builds. Keep a stable signing key for future distribution
and in-place upgrades across builds.

## Device validation

- Launch from the Android TV home screen and sign in using the remote.
- Browse shelves, select a movie and episode, and return using Back.
- Exercise play, pause, seek, fullscreen, audio and subtitle selection.
- Check slow-stream recovery, resume position, and exit confirmation.
- Repeat on a Sony TV and another Android TV or Google TV model.
