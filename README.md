# CrimsonFin v0.7 — Smart Connect

A red-themed Jellyfin desktop client for Windows and Linux.

**New in v0.7:** CrimsonConnect automatically checks the home Jellyfin URL and falls back to the public Tailscale Funnel HTTPS URL when logging in or opening a saved session, with editable endpoints and a local/remote indicator. See [SMART_CONNECT_SETUP.md](SMART_CONNECT_SETUP.md).

Run `npm install && npm start` to launch from source. `npm run pack:linux` builds Linux packages; `npm run pack:win` builds Windows installers when run in Windows or a compatible build environment. The GitHub release workflow builds both platforms on hosted runners.
