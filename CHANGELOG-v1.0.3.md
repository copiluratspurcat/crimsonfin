# CrimsonFin v1.0.3 — Cross-platform titlebar fix

- Fixed an overlap between window buttons and the profile/sound controls on **Linux (including Debian 13/KDE)** as well as Windows.
- Added a dedicated 34px draggable title strip and placed all application content below it.
- Reset Windows-specific header padding that was only a partial fix.
- Bumped the displayed application version to 1.0.3.

## Test

Run `npm install && npm start` in the project root. Confirm the top-right window controls are above the main toolbar, with no overlap when the window is resized.

## Publish

Commit the updated project and tag `v1.0.3` to trigger your configured GitHub Actions workflows. This project publishes installers to your separate `crimsonfin-downloads` repository when the `DOWNLOADS_RELEASE_TOKEN` secret is configured.
