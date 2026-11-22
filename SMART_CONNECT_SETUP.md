# CrimsonFin v0.7 — Smart Connect

## How it works

The login screen has editable **Home server** and **Remote HTTPS** fields, plus an **Automatically choose local or remote** checkbox. Defaults for this CrimsonFin build:

- Home: `http://192.168.1.105:8096`
- Remote: `https://hoesmad.tail0adc10.ts.net`

On login and when reopening the app with a saved session, CrimsonFin checks the local server first (2.8-second limit), then tries the remote server. It uses the first endpoint returning a Jellyfin public server-info response. The connection indicator in the sidebar shows LOCAL or REMOTE. Settings are saved in the app's user-data folder. No Jellyfin password or Tailscale credentials are embedded in the source or package.

**Limitations:** This is startup/login failover, not seamless mid-stream handoff. Playback may be interrupted if the server goes offline during a movie. It does not automatically reconnect a playing video. On an existing signed-in client, open **Switch account** to edit your server addresses. The user must have a Jellyfin account. If you distribute this build, the default URL reveals your public Jellyfin endpoint; replace the default pair in `electron/main.cjs` to publish a generic client.

**Security:** Tailscale Funnel publishes the Jellyfin web login to the internet. Secure Jellyfin accounts, keep the server updated, and only share the Funnel URL with people you authorize. Funnel has bandwidth limits.

## Publish GitHub release v0.7.0

In your existing git checkout (where `.git` is present), **copy the contents of this extracted folder** over the tracked source files without deleting `.git`. Then:

```bash
cd ~/Videos/CrimsonFin-v0.6-GitHub-Windows-Linux
node -p "require('./package.json').version"  # should print 0.7.0
npm install --no-audit --no-fund
npm run build
git add -A
git commit -m "Add CrimsonConnect Smart Connect v0.7.0"
git push origin main
git tag v0.7.0
git push origin v0.7.0
```

Note: Do **not** run `npm version 0.7.0`; package.json is already version 0.7.0. Only create/push the tag once the commit has been pushed. GitHub Actions produces the Windows NSIS installer, Linux .deb and AppImage. Windows NSIS and Linux AppImage are the auto-update targets; .deb upgrades remain manual.

Verify Actions and Releases at:
- https://github.com/copiluratspurcat/crimsonfin/actions
- https://github.com/copiluratspurcat/crimsonfin/releases
