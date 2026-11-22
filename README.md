# CrimsonFin v1.0.0 — Preview

Cinematic desktop Jellyfin client for Windows and Linux, based on v0.7 Smart Connect.

## Run

```bash
npm install
npm start
```

## Build

```bash
npm run pack:linux   # Linux machine: DEB + AppImage
npm run pack:win     # Windows machine: NSIS installer
```

The GitHub Actions workflow builds both on tagged releases. The package is already versioned `1.0.0`. Do not tag until the build and live Jellyfin playback are tested.

## Important

Read `VERSION_1_RELEASE_NOTES.md` for implemented features, known missing features, and release instructions. *Native MPV, thumbnail seeking, and server-dependent skip intro are not completed.* The v1.0 label describes this feature-preview milestone, not a fully validated production release.
