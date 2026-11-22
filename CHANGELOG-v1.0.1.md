# CrimsonFin v1.0.1 — Continue Watching & Version Display

- Episode cards in **Continue Watching** now display their **series name** as the headline.
- Beneath the series name, display the **season/episode number and episode title** (e.g. `S01E03 · Episode name`).
- A small playback-progress bar appears when Jellyfin provides the position and duration.
- Movies and non-episode resume entries keep their previous card presentation.
- Show **v1.0.1** in the app footer and Settings → Network & maintenance. The displayed version comes from `package.json` at build time; it is not a simulated update status.

## Deploy

Copy this folder's contents over the existing Git checkout, leaving `.git` intact. Run `npm install` and `npm start` to test. Then commit, push `main`, and create the **new** `v1.0.1` tag to trigger the Windows and Linux release workflow. Do not re-tag an already published version.

## Test

Check a partially watched TV episode and a partially watched movie in Continue Watching. Verify the installed version shown in the footer matches the release. For actual auto-update testing, launch the older installed v1.0.0 build (NSIS or AppImage), publish v1.0.1, and verify an update is detected and installed; development `npm start` does not test installed-app auto-updates.
