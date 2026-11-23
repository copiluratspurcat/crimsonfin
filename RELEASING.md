# CrimsonFin v2 — deployment and GitHub releases

This branch replaces the old CrimsonFin 1.x desktop implementation with the new
Jellyfin gateway and Electron client. Old releases remain in GitHub history.
The former main-branch state is retained in `legacy/v1.2.5-before-rebuild`.

## Release automation

The workflow in `.github/workflows/release.yml`:

- Checks out, installs dependencies, runs seven automated tests and builds React.
- Compiles a Windows x64 NSIS installer (`.exe`) on GitHub's Windows runner.
- Compiles Linux x64 Debian (`.deb`) and AppImage packages on Ubuntu.
- Uploads all installers to a GitHub Release after both builds succeed.
- Publishes a **preview release** on each push to `main` with a `preview-N` tag.
- Publishes a **stable release** when a `v*` tag (such as `v2.0.0`) is pushed.
- Uses the built-in GitHub Actions `GITHUB_TOKEN` with `contents: write`;
  do not store a personal access token in GitHub Actions or commit one.

Before releasing, set **Settings → Secrets and variables → Actions → Variables**
in your repository:

`CRIMSONFIN_PUBLIC_URL` = your working public HTTPS Funnel origin, including
port 8443. The workflow generates `desktop/config.json` at build time.
The file is deliberately ignored by Git to avoid publishing the hostname in
source control. End users see **Local**/**Remote**, not IP addresses.

The public hostname must still be embedded in the installer to connect to
your server and is inherently discoverable by inspecting network traffic.

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
- Builds are automated; the app does not yet have an in-app auto-updater.
- Test real Jellyfin accounts, playback, permissions, and remote bandwidth
  before distributing clients broadly.
- If a GitHub token or tracker passkey was pasted into a chat, rotate it in
  its respective service. The server configuration must then be updated with
  the new RSS passkey.
