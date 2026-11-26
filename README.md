# CrimsonFin — Jellyfin client with public HTTPS gateway

A custom cinematic React client with a secure Node gateway for Jellyfin, HLS media proxying, FileList metadata search, media requests, and Electron packaging for Windows/Linux. This is an **integration-ready MVP**, not a production-certified release: the mock-server tests pass, but real playback (especially transcoding, subtitles, and codec support), FileList account behavior, and packaged installers still require integration testing on your machine.

## What works in the code

- Existing **per-user Jellyfin login**, with an HttpOnly session cookie and an encrypted Jellyfin token held **only on the gateway**. Accounts remain separate. Basic administrator authorization comes from Jellyfin's login response.
- Library browsing, item details, seasons and episodes, Jellyfin search, recently added, resume items, next episodes, favorites, and playback progress reporting.
- Video with **hls.js** (Jellyfin HLS/transcoding) or opt-in direct playback. Native video controls support seeking, volume and fullscreen; HLS subtitle/audio track support varies by browser/server. This is **not** an mpv-based client.
- Protected media proxy preserving HTTP 206, Range headers, backpressure and cancellation; HLS playlists rewritten to same-origin proxied paths; redirects to internal/private servers are blocked.
- Media requests stored in SQLite with status updates, per-user visibility, admin moderation, and an optional server-side FileList **metadata search**. **No automatic downloads** and no torrent passkeys in web responses.
- Responsive dark UI with deterministic CSS motion timings and reduced-motion support.
- Browser deployment and an Electron desktop shell showing the **custom CrimsonFin frontend** at the configured public hostname (not the stock Jellyfin web client). It does not yet integrate a native mpv player or offline mode.

## Server requirements

- Linux with Node.js **22.16+** (Node's built-in `node:sqlite`; experimental in Node 22), npm, and your existing Jellyfin server.
- Tailscale installed and logged in on the **server only**. Funnel capability enabled in your tailnet, MagicDNS and HTTPS certificates activated.
- Actual server address and a strong encryption key. A real Jellyfin server and FileList credentials were **not** included in this archive.

## 1. Install and configure on Linux

```bash
unzip CrimsonFin-Client.zip
cd CrimsonFin-Client
npm install
cp .env.example .env
openssl rand -base64 32
```

Edit `.env`: set `JELLYFIN_URL` to the Jellyfin URL **as reachable from the same Linux server** (normally `http://127.0.0.1:8096`), `SESSION_ENCRYPTION_KEY` to the generated base64 key, `PUBLIC_ORIGIN` to your **real** `https://device.tailnet.ts.net:8443` host, and optionally `FILELIST_RSS_URL` (recent feed search) or `FILELIST_USERNAME`/`FILELIST_PASSKEY` (full API search). Keep `.env` private (`chmod 600 .env`). Do not change the session key without knowing that it invalidates existing sessions. The FileList passkey is not your website password.

```bash
npm test
npm run build
npm start
```

Check `curl http://127.0.0.1:8099/api/health`, then open `http://127.0.0.1:8099` **locally** to test. In dev, set `NODE_ENV=development` so cookies work over local HTTP; for actual public Funnel exposure use `NODE_ENV=production`, so session cookies are secure.

To keep the gateway running after reboot:

```bash
bash scripts/install-user-service.sh
sudo loginctl enable-linger "$USER"
systemctl --user status crimsonfin
```

## 2. Expose to friends with Tailscale Funnel

On the Linux server (you need Tailscale signed in, and tailnet Funnel capability enabled):

```bash
tailscale funnel --bg --yes --https=8443 127.0.0.1:8099
# Or: bash scripts/funnel.sh on
tailscale funnel status
curl -i https://YOUR-REAL-DEVICE.YOUR-TAILNET.ts.net/api/health
```

Use your real hostname, never the example one. The `--bg` mode keeps Funnel's configuration active through Tailscale restarts and machine reboots. Configure the gateway's `PUBLIC_ORIGIN` to exactly this public HTTPS origin. Confirm access from mobile data or another external network, and log in as a **non-admin Jellyfin user**.

Diagnostics:

```bash
sudo tailscale status
sudo tailscale funnel status
sudo tailscale netcheck
systemctl --user status crimsonfin --no-pager
journalctl --user -u crimsonfin -n 80 --no-pager
curl -i http://127.0.0.1:8099/api/health
curl -i https://YOUR-REAL-HOST.ts.net/api/health
```

To turn off public access: `bash scripts/funnel.sh off` or `tailscale funnel --https=8443 off`. Tailscale docs may change again, so compare with `tailscale funnel --help` on your installed release.

### Funnel throughput warning

Funnel routes internet traffic through Tailscale relay infrastructure and has **nonconfigurable bandwidth limits**. It may be inadequate for simultaneous 4K streams or multiple remote users. If playback buffers, test your actual uplink and the Funnel path; use Jellyfin transcoding with a lower bitrate or move to a public HTTPS reverse proxy with capacity appropriate to your workload. Nothing in the React interface can lift Funnel limits.

### Alternate public HTTPS reverse proxy

CrimsonFin uses relative `/api` and `/jellyfin` paths. You can put Caddy, Nginx, or another trustworthy HTTPS reverse proxy in front of **the same loopback gateway on port 8099**. Set `PUBLIC_ORIGIN=https://your-domain.example`, keep `BIND_HOST=127.0.0.1`, configure TLS at the proxy, and proxy full media streams without buffering. Protect the gateway behind host firewalls; don't route the stock Jellyfin server directly through this application's login system.

## 3. Build the Windows / Linux desktop app

The desktop client runs the custom Chromium-compatible interface from your CrimsonFin gateway. It requires **no Tailscale installed by friends**. Before packaging, hard-code your public HTTPS endpoint in its configuration:

```bash
node scripts/configure-client.mjs https://YOUR-REAL-HOST.ts.net
npm run desktop:dist
```

- Windows NSIS packaging must be performed on Windows for the most reliable result: `npm run build && npx electron-builder --win nsis`.
- Linux AppImage and Debian package: `npm run build && npx electron-builder --linux AppImage deb`.
- Installer output appears in `releases/`.
- `npm run desktop:dev` launches the desktop client; set `CRIMSONFIN_URL=https://YOUR-REAL-HOST.ts.net` to override the configured URL during development.

**Important:** this Electron app is a desktop host for the independently developed CrimsonFin UI, not a native media decoder. In a later iteration, integrate an mpv-based native player for formats Chromium cannot decode efficiently. Its local source is separate from your Jellyfin server and it is **not** the Jellyfin site's built-in UI.

## 4. Media requests / FileList

All logged-in Jellyfin users can create requests, list their own requests, and optionally search FileList metadata. Admins can see all requests and set `pending`, `approved`, `rejected`, or `fulfilled`. FileList search uses the private RSS feed for recent items, or the API when configured with a username and API passkey, with a five-minute query cache and per-user rate limiting. The app **does not fetch torrents or install content automatically**. Use only content you have the rights to obtain and distribute.

## Test status and limitations

`npm test` uses Node's built-in test runner and a fake Jellyfin server; it exercises login, session isolation, request moderation, 206 Range responses and HLS URL rewriting. Tests do **not** establish compatibility with your real Jellyfin version, devices, codecs, subtitles, or remote throughput. The frontend still needs `npm install` and `npm run build` on a machine with npm registry access. This environment had no npm network access, so it could not build Electron installers or run browser integration tests.

For public deployment, additionally consider: TLS/domain access audit, account throttling behind Tailscale's proxy (all clients may share one loopback IP), more rigorous CSRF protection, observability, rate limiting per account, FileList quota monitoring, subtitle and media-stream selection, and a Jellyfin PlaybackInfo/device-profile negotiation layer. Before calling this production-ready, test at least two simultaneous remote playback sessions and all critical actions with non-admin users.

### Project structure

```text
server/index.mjs         Node gateway, auth, SQLite, media proxy, FileList
web/src/main.tsx         React interface, player, requests, admin UI
web/src/styles.css       Theme, transitions, responsive styling
web/index.html           Application entry
vite.config.ts           React builder, local API proxy
 desktop/main.cjs        Electron desktop shell with locked navigation
 scripts/funnel.sh       Public Funnel enable/status/disable
 scripts/configure-client.mjs   Bake server URL into desktop release
 scripts/install-user-service.sh  Boot-time systemd user service
 tests/gateway.test.mjs  Gateway tests without real Jellyfin credentials
```

## Sources

- Tailscale Funnel CLI: https://tailscale.com/docs/reference/tailscale-cli/funnel
- Tailscale Funnel limitations: https://tailscale.com/docs/features/tailscale-funnel
- Jellyfin 12 release changes: https://jellyfin.org/posts/jellyfin-release-12.0/
- Jellyfin TypeScript SDK: https://typescript-sdk.jellyfin.org/
- Community-documented FileList API: https://github.com/ByteBendr/FileListWindowsClient

## 6. Automatic desktop releases

See [RELEASING.md](RELEASING.md) for GitHub Actions preview/stable releases and configuration of the remote HTTPS endpoint. The build creates Linux `.deb`, Linux AppImage and Windows `.exe` installers.

## Deployment state and release automation (v2.0.0)

The server gateway runs separately from Jellyfin, bound to the local loopback interface on port 8099. Tailscale Funnel exposes it on **HTTPS port 8443**, leaving any existing HTTPS port 443 configuration untouched. The browser app displays **Local** or **Remote** rather than showing an internal IP address. That label is cosmetic; the public hostname is still present in network traffic and packaged desktop apps so they can connect.

### Windows and Linux automatic installers

The GitHub Actions workflow at `.github/workflows/release.yml` runs on pushes to the `main` branch, release tags matching `v*`, or manual workflow dispatches. It runs tests, compiles the web client on Node.js 24, packages a Windows NSIS `.exe` and Linux `.deb` and `.AppImage`, and uploads them to a GitHub release.

- A push to `main` creates a numbered **prerelease** (`preview-N`).
- A pushed tag like `v2.0.0` creates a **stable release**.
- The workflow uses its built-in `GITHUB_TOKEN`, requiring repository Actions **read/write contents** permission. Personal GitHub tokens are **not** stored in workflows.
- `desktop/release-target.json` contains **only** the public Tailscale HTTPS hostname, which desktop clients need. It is not a private LAN/Tailscale IP, passkey, or password.
- To change the server endpoint in subsequent installers, update `desktop/release-target.json`, commit, and push.
- Windows releases are not digitally code-signed; Windows SmartScreen warnings may appear.

### FileList RSS catalog

Set `FILELIST_RSS_URL` in the **server's private `.env` only**, pointing to the FileList RSS feed. The protected `/api/filelist/search` endpoint searches recent RSS item titles; the frontend receives sanitized titles but never feed URLs, tracker passkeys, or download links. This is an RSS-recent-entry search, **not** a full catalog index or automatic torrent download. Optional FileList API credentials can still enable the pre-existing API search.

### Verification

```bash
npm ci
npm test
npm run build
npm run pack:linux
systemctl --user status crimsonfin
tailscale funnel status
```

Use a non-admin Jellyfin account to verify login, library visibility, search, playback and requests. The automated tests use a simulated Jellyfin upstream and do not guarantee every live video codec, remote playback or torrent-tracker operation works.

**Security:** never commit `.env`, `desktop/config.json`, GitHub tokens or FileList passkeys. After secrets appear in a chat, rotate them before continuing long-term use.

## LAN-first, metadata and FileList API (v2.1)

The desktop client checks for a certificate-pinned HTTPS gateway on the local network first, then uses the public Tailscale Funnel URL if the LAN gateway is unreachable. Browsers that directly open the public Funnel URL still use the public route. LAN discovery uses UDP port 8098 and HTTPS port 9443. The public address is shown as Local or Remote in CrimsonFin rather than revealing IPs in the UI.

The server can run `scripts/repair-episode-metadata.mjs` via an optional systemd user timer. It only replaces uncertain/generic episode titles when it finds a positively matched title in TVMaze, and saves a local backup of every changed Jellyfin record. Some official catalogs also use titles such as Episode 1, so a missing title cannot always be resolved.

The full FileList API uses the **FileList-specific username** and the private feed/API passkey. Administrators can configure this in CrimsonFin → Admin → FileList. RSS-only search remains available if no username is configured. The API uses HTTP Basic credentials over HTTPS and never sends the passkey in URL parameters or to the web browser. Admin-only torrent fetching and queuing to the loopback-only qBittorrent instance requires `QBIT_URL`, `QBIT_USERNAME`, `QBIT_PASSWORD`, and optionally `QBIT_SAVE_PATH` in the **private server .env**. Media request users are not allowed to trigger torrent downloads.

## CrimsonFin Theater v2.2: playback controls and Romanian subtitles

The theater has a deep-red theme, audio stream selector, selectable WebVTT
subtitles (with Romanian preferred where indexed), subtitle time-offset
adjustment (±15 seconds), ±10-second playback skip, timeline scrubbing,
quality and Direct/HLS options. Audio changes use Jellyfin's HLS
`AudioStreamIndex`; text subtitles use its authenticated `Stream.vtt` API.
Track switching and offset changes are scoped to playback, not media files.

### Romanian subtitle audit

`scripts/install-romanian-subs.sh` installs a non-AI user-level timer that
checks the Jellyfin movie and TV library twice each day. It can automatically
install Romanian subtitles *only when* Podnapisi or TVSubtitles provides a
validated text subtitle with plausible Romanian language and timing.
The audit uses a 7-day cooldown for failed attempts, never overwrites files,
never machine-translates English, and exposes a progress summary only to
Jellyfin admins in CrimsonFin's admin panel.

#### Local OpenSubtitles dataset (no daily download limit)

OpenSubtitles' API allows only a handful of downloads per day. The audit can
instead look subtitles up in a local copy of the published opensubtitles.org
dataset ([milahu/opensubtitles-scraper](https://github.com/milahu/opensubtitles-scraper)),
entirely on disk. It is tried before the online providers, and each scan may
check up to `--local-limit` titles (default 200).

1. **Subtitle files.** Download the dump releases (torrents listed in that
   repository's `release/` folder). Each release is one SQLite file such as
   `95xxxxx.db` with a `zipfiles(num, name, content)` table. Subtitles of every
   language are mixed in each release, so Romanian coverage needs all of them
   (roughly 160–200 GB). Releases lag behind the live site.
2. **Index.** Download `subtitles_all.txt.gz` from OpenSubtitles' export page and
   build `subtitles_all.db` with that repository's
   `subtitles_all.txt.gz-parse.py` (table `subz_metadata`).
3. **Configure** `OPENSUBS_METADATA_DB` and `OPENSUBS_DUMP_DIRS` in `.env`.

Matching uses Jellyfin's IMDb ids (the show's IMDb id plus season/episode for
episodes) and prefers subtitles whose release name matches the video file. Every
candidate still passes the same Romanian-language and timing checks, and existing
subtitle files are never overwritten. To fill a backlog in one go:
`python3 scripts/romanian-subtitle-audit.py --apply --local-limit 2000`

Audit manually: `python3 scripts/romanian-subtitle-audit.py`
Attempt a few missing subtitles: `python3 scripts/romanian-subtitle-audit.py --apply --limit 4`

Important: an older *separate root-managed* Jellyfin subtitle autopilot may
still perform Argos machine translations. If already installed, the server
administrator must run this one-time command to disable its AI fallback:

`sudo python3 ~/CrimsonFin-Client/scripts/disable-legacy-ai-translation.py`

This preserves the old JSON configuration in a private backup, sets
`translate_english=false`, and does not stop the non-AI subtitle search
timer. **Do not assume AI translations are disabled until this is done.**

The existing Lioness S3 Romanian sidecars were backed up privately before
further changes. Their current content was preserved; no unverified
replacement was installed. Public subtitles from RegieLive were discoverable,
but the provider later denied download access. An official provider such as
Subs.ro or SubDL needs a user-generated API key, and availability varies.

The suggested LavX OpenSubtitles.org scraper is a separate self-hosted service
or Bazarr+ plugin; it was evaluated but not deployed. Provider limits and
site access controls must be respected.

### Security notes

The media streaming proxy only allows per-user authenticated Jellyfin media
paths. Subtitle URLs must identify a Jellyfin media source and text WebVTT
stream. The subtitle audit never exposes server API keys or the underlying
media paths to CrimsonFin users. Subtitle file provenance and human translation
quality cannot be fully guaranteed automatically; inspect uncertain matches
before using them as permanent replacements.

## v2.3 — Download progress and automatic disk selection

The authenticated **Downloads** navigation tab is available to Jellyfin
administrators. It refreshes qBittorrent progress every 3.5 seconds and shows
download speed, upload speed, percentage, state, ETA, and destination folder.
Its three drive cards report available, used and total space. The system SSD
is visible but is **not** a download destination.

**Critical: download locations use the actual existing Jellyfin libraries.**
CrimsonFin selects a writable folder in the configured Movies or Shows
libraries with the most unreserved free disk space, and asks qBittorrent to
download **directly into that folder**. It sets `autoTMM=false` to keep
qBittorrent from silently overriding that destination. It reserves space
already needed by incomplete downloads and a further 2 GiB safety margin.

Configure server-only paths in the private `.env`:

```
MEDIA_MOVIE_DIRS=/mnt/ADATA/Movies,/mnt/WD1TBLU/movies
MEDIA_SERIES_DIRS=/mnt/ADATA/Shows,/mnt/ADATA/TV Shows,/mnt/WD1TBLU/shows
```

These were verified against Jellyfin's virtual folders on the original
CrimsonFin server. Only actual writable directories under `/mnt` qualify.
The system drive is never chosen automatically.

FileList searches offer administrators a **Download as** selector for Movie
or TV Show. Choose the correct kind before queuing. Existing downloads are
**not moved**, only new ones use the new routing. Single-file TV episodes may
need additional Jellyfin metadata recognition if the file is not in a series
subfolder; Jellyfin library scanning is not guaranteed to run immediately.

Only administrators can queue or see the qBittorrent status. Credentials
stay private on the backend. The local downloader is not exposed via Funnel.
Unit tests use simulated torrents and fake qBittorrent responses; a true
live download test must be separately approved before modifying live data.

## CrimsonFin v2.4 – playable Jellyfin HLS and TV series organization

Playback uses compatible HLS by default (H.264 video + AAC audio) and always
sends Jellyfin's mandatory `MediaSourceId` with the master playlist request.
This resolves the HTTP 400/networkError which affected MKV episodes in Jellyfin
12. Direct Play has been removed from the desktop player because browsers can
display video but silently reject unsupported MKV E-AC-3/DTS audio. You can
still select any available Jellyfin audio stream and Romanian subtitles.

New torrents are inspected by their bencoded file list. Episode patterns
(`S01E01`) and numbered season packs are automatically treated as TV shows
even if mistakenly selected as movies. New single-season shows are saved into
the same existing Jellyfin series library under `Shows/Show Title/Season 01`
(or the appropriate season number), with `contentLayout=NoSubfolder` so
individual episode files sit directly in the Season folder, not in an extra
tracker release folder. The download manager selects the media drive with the
most unreserved free space. Multi-season packs are rejected with a helpful
message rather than silently misfiled.

Existing misfiled shows can be repaired through qBittorrent's tracked-file
rename and move endpoints, preserving the torrent and download progress.
One-time migration tooling and its audit logs remain private on the server
and are intentionally not included in the public GitHub repository.

File metadata identification may still be inaccurate until Jellyfin rescans
the series or an administrator identifies the correct series. Episode
availability for torrents that are still downloading is not guaranteed.


## v2.5.0 — Desktop auto-updates and approved media request downloads

### Auto-update setup

The public GitHub repository is the official **stable** update source.
Desktop apps installed from v2.5.0 onward use `electron-updater` with the
embedded `app-update.yml`. GitHub Actions creates a stable `vX.Y.Z` release
and publishes the Windows `.exe`, Linux `.deb` and AppImage, along with
`latest.yml`, `latest-linux.yml`, and optional blockmap metadata. The
package update manifests include SHA-512 checksums. Do not distribute update
metadata separately from its corresponding installer.

The **Windows NSIS installer** checks for updates shortly after launch and
every four hours while running. A new release downloads automatically and
prompts for a restart. Updates can also be checked under Settings → App
updates. Linux AppImage and `.deb` installations check automatically and
link to the latest stable release for manual installation. The web-only version
runs from the server and is updated immediately on server deployment.

Existing v2.4.0 desktop installations do **not** have an auto-updater: every
friend must install v2.5.0 once. Subsequent Windows updates will not require
redistribution of the installer. An unsigned Windows installer may still
trigger a Windows SmartScreen warning on its first installation.

Never put a GitHub personal access token into the desktop app. Publishing
uses GitHub Actions' built-in `GITHUB_TOKEN`, while the public update
feed uses only the official public GitHub release metadata.

### Approved media requests

The admin's **Approved** action attempts a FileList search and automatically
queues only an **unambiguous, exact normalized release title** that matches
the media type and actual torrent contents. The request remains visible to
the requester with a download status: searching, needs review, queued,
downloading or downloaded. Queued requests are linked to the torrent's
infohash, and repeat approvals do not add duplicate torrents.

If FileList returns ambiguous releases, no releases, a mislabeled season,
or an incorrectly classified movie/series, nothing is downloaded and the
admin is shown a clear **Needs release selection** status. The admin panel
allows manual release selection, retry, or correction of the request's
Movie/TV type. The downloader verifies season numbers in the real torrent
file list against the advertised tracker release, preventing a misleading
S03 listing from silently queuing S04 files.

All torrent downloads remain server-side, restricted to administrators,
and use the existing Jellyfin Movies/Shows folders and available-disk-space
selection. The FileList API credentials are never forwarded to clients.

## Automatic subtitle timing

Set `SUBTITLE_SYNC_COMMAND` in the gateway's `.env` to the absolute path of
an installed `ffsubsync` executable, with `ffmpeg` on the service PATH. The
gateway user needs read access to the media files under the configured Jellyfin
movie and series directories. The player uses the selected audio track and
keeps the original text subtitles visible while the server analyzes timing.
Alignment is best-effort. Turn off **Auto-sync to dialogue** or use the manual
offset under **Tracks & sync** if a track still needs adjustment.
