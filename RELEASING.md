# CrimsonFin v2 — deployment and GitHub releases

This branch replaces the old CrimsonFin 1.x desktop implementation with the new
Jellyfin gateway and Electron client. Old releases remain in GitHub history.
The former main-branch state is retained in `legacy/v1.2.5-before-rebuild`.

## Release automation

Bump the version in both `package.json` and `package-lock.json` before merging
to `main`. The release workflow runs the Node and Python tests, checks TypeScript,
and builds the web app, Windows NSIS installer, Linux packages, Apple Silicon and Intel macOS DMGs, and Android TV
preview. It verifies the manifest versions and installer checksums, then publishes
a stable release from a draft tied to the build commit. Each stable tag is used once.

Set `TV_KEYSTORE` to the base64-encoded PKCS#12 keystore and
`TV_KEYSTORE_PASSWORD` to its password in the repository's Actions secrets.
The key alias is `crimsonfin-tv` and the key and store passwords are identical.
Keep an offline backup and reuse the same keystore for every stable APK. When both
secrets are absent, the release contains desktop packages and the debug preview
is available as a separate Actions artifact. Existing debug previews require a
one-time uninstall before installing a stable APK signed with a different key.

Desktop packages use the HTTPS endpoint in `desktop/release-target.json`.

## Server

The gateway runs only on localhost port 8099. Tailscale Funnel exposes it
through HTTPS on port 8443; an unrelated Funnel service on 443 is preserved.
The active service is `systemctl --user status crimsonfin`.

The private server `.env` contains Jellyfin origin, an encrypted session key,
and optionally `FILELIST_RSS_URL`. Do **not** commit or distribute it.
The FileList RSS feed supports searching recent release metadata. It is not
a full historical FileList search, and no automatic downloads occur.
User submissions and administrative approvals are stored in SQLite.

## Limitations

- `.exe` and `.deb` packages are not code-signed, so Windows SmartScreen and
  some Linux package warnings are possible.
- Windows installs updates on restart. macOS and Linux users install updates from the official release.
- macOS DMGs are ad-hoc signed. Apple Developer ID signing and notarization are not configured.
- Test real Jellyfin accounts, playback, permissions, and remote bandwidth
  before distributing clients broadly.
- If a GitHub token or tracker passkey was pasted into a chat, rotate it in
  its respective service. The server configuration must then be updated with
  the new RSS passkey.
