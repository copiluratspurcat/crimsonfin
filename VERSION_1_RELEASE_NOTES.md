# CrimsonFin 1.0.0 — feature preview

Built on the actual v0.7 Smart Connect project.

## Implemented
- Preferences screen with local import/export (does not export authentication credentials).
- UI sound profiles and volume.
- Motion toggle, improved cinematic poster transitions.
- Subtitle size, color, position, and shadow preferences.
- Preferred audio/subtitle language defaults (best-effort, dependent on streams Jellyfin provides).
- Playback speed, bitrate setting for transcoded streams, PiP (platform-dependent), and playback diagnostics.
- Season dropdown with episode guide, progress badges, spoiler hiding, and mark-season-watched action.
- Next episode button and optional automatic 8-second advance.
- Advanced search: movie/series filters, watched filter, release-year sorting.
- Unwatched recommendations shelf.
- Existing Smart Connect, GitHub builds and updater retained.

## Not fully implemented
- **Native MPV engine:** not integrated. Electron HLS/HTML5 is still the default; packaging a safe, cross-platform MPV engine with native window embedding requires separate work and testing.
- Thumbnail scrubbing: requires Jellyfin trick-play metadata handling and testing.
- Intro/credit skip: requires compatible server-provided segment metadata / plugin.
- True audio-delay DSP, volume normalization and advanced codecs depend on native player support.
- AI personalized recommendations, multi-server accounts and transient network handoff are not implemented.

This is a **preview**, not a verified stable 1.0. Tests: JS syntax checks only unless separately noted. Verify playback, resume, login, subtitle controls and installers on Windows and Linux before publishing a production release.

## Release safely
Copy files into your existing Git repository, run npm install and npm run build, run the app, fix any issues, then commit. Ensure package version is 1.0.0, tag only once tests pass: `git tag v1.0.0 && git push origin v1.0.0`. Do not force-rewrite previous release tags.
