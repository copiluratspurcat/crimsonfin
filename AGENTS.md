# CrimsonFin: notes for coding agents

Read this first, then `docs/HANDOFF.md` for the current state of work. Both files are kept up to
date by whoever (human or LLM) finishes a piece of work. Please do the same: see "Before you
finish" at the bottom.

## What this is

A custom Jellyfin client for a small group of friends, plus everything around it:

| Part | Where | Notes |
|---|---|---|
| Gateway | `server/index.mjs` (+ `server/*.mjs`) | Node 22, no framework, `node:sqlite`. Logs users in against Jellyfin, keeps their Jellyfin token **server-side** (AES-GCM encrypted, cookie holds only a random session id), proxies the API and media, serves `dist/`. Exposed publicly through Tailscale Funnel. |
| Requests and downloads | `server/request-fulfillment.mjs`, `filelist-*.mjs`, `download-manager.mjs`, `media-layout.mjs` | Users request titles; an admin approves; the gateway searches the FileList private tracker and queues the torrent in a **loopback-only** qBittorrent, choosing the library drive with the most free space. Series go to `Show/Season NN`. |
| Web app | `web/src/` | React 19 + Vite + TanStack Query + hls.js. One codebase for PC and TV. |
| TV layout | `web/src/tv.ts`, `.crimsonfin-tv` rules in `web/src/spotlight.css` | Turned on when the user agent contains `CrimsonFinTV/` (the Android TV WebView adds it). Spatial focus navigation for the remote; sizes scale with `--u: calc(100vw / 1920)`. |
| Desktop app | `desktop/` | Electron shell that loads the gateway. Prefers a LAN HTTPS endpoint with a **pinned** self-signed certificate, falls back to the public URL. Auto-updates from GitHub releases. |
| Android TV app | `android-tv/` | A WebView pointed at `GATEWAY_URL` (Gradle property). |
| Romanian subtitle job | `scripts/romanian-subtitle-audit.py` | systemd timer on the server (`scripts/install-romanian-subs.sh`). Finds videos without Romanian subtitles; tries a local copy of the opensubtitles.org dataset, then Podnapisi/TVSubtitles; validates language and timing; installs `<video>.ro.srt`. |
| Subtitle timing | `server/subtitle-sync.mjs` | Optional ffsubsync alignment (`SUBTITLE_SYNC_COMMAND`). |

The server is a Linux box (media under `/mnt/ADATA`, `/mnt/WD1TBLU`). Development happens on
Windows too.

## Commands

```bash
npm install
npm test                 # Node tests: gateway, requests, FileList, downloads, subtitles (fake Jellyfin)
npm run test:py          # Python tests for the subtitle job
npm run typecheck        # TypeScript for web/
npm run build            # web app -> dist/
npm run mock             # after build: the app with fake data at http://127.0.0.1:8123 (no Jellyfin needed)
npm run test:visual      # after build: headless-browser smoke test, PC + TV layouts, screenshots in tests/visual/out/
npm run dev              # Vite dev server; set CRIMSONFIN_GATEWAY=https://... to proxy /api and /jellyfin to a real gateway
npm run dev:server       # the gateway itself (needs .env, see .env.example)
```

`test:visual` needs Chrome, Edge or Chromium (set `CRIMSONFIN_BROWSER` if it isn't found).
**Look at the screenshots** after UI changes; the checks catch behaviour, not ugliness.
The mock gateway (`tools/mock-server.mjs`) has no video, so the player shows a stream error.
That is expected.

CI (`.github/workflows/ci.yml`) runs `npm test` and `npm run build`. It does not run the Python
tests, the typecheck or the browser test, so run those yourself.

## Rules that are not obvious from the code

**Security and privacy**
- Never send Jellyfin tokens, the FileList passkey or qBittorrent credentials to the browser or
  into logs or error messages. The gateway strips `api_key`/`token` query params and rewrites HLS
  playlists; keep it that way. Errors returned to users go through `hideSecrets`.
- Every state-changing endpoint calls `verifyMutation(req)` (Origin / Sec-Fetch-Site check).
- Item ids from the client go through `safeId()`; media paths through the `allowedMediaPath` allowlist.
- qBittorrent must stay loopback-only; downloads only go to configured `/mnt/<drive>/...` folders.
- Secrets live in `.env` (never committed). `desktop/config.json` and `data/` are git-ignored.
- Behind Tailscale Funnel every client arrives from `127.0.0.1`. Don't key anything (rate limits,
  bans) on the socket address. Login throttling is per username for this reason.
- Do not commit photos of people. The original cat photo has a person in the background; only the
  cut-out logo files are used.

**Subtitles**
- No machine translation, ever. The user disabled it deliberately (`scripts/disable-legacy-ai-translation.py`).
- Never overwrite an existing subtitle file (the job writes with mode `"xb"`).
- The OpenSubtitles dataset is used **offline only**: never run the opensubtitles scraper against
  the site and never add code that downloads from opensubtitles.org.
- Romanian is the default subtitle language in the player (`web/src/prefs.ts`).

**Code conventions**
- Server paths are Linux paths: modules that handle library/download paths import
  `{ posix as path }` so tests also pass on Windows.
- Files are checked out with **CRLF** on Windows (git autocrlf). If you edit with scripts, keep
  the file's existing line endings.
- Jellyfin version differences: prefer trying the classic route and falling back
  (`jellyfinEither`) over assuming one server version. Intro/credits come from MediaSegments
  (10.10+) or the Intro Skipper plugin; both are optional.
- Artwork URLs carry Jellyfin's image `tag` so the gateway can cache them for a week (`art()` in `web/src/lib.ts`).
- Keep the gateway dependency-free beyond what's in `package.json`; it runs as a systemd user service.

## Design (from the owner)
- **Readability beats decoration.** Body text ≥ 13–14px, contrast ≥ 4.5:1, no decorative or tiny
  letter-spaced type for anything functional. An earlier "theatre programme" style was rejected
  as too hard to read.
- **Login stays a plain username + password form.** A Netflix-style "Who's watching?" profile
  picker was rejected.
- The mascot and logo is **Dobby**, the owner's cat, in a Santa hat (`web/public/dobby.png`,
  app icons in `build/` and `desktop/`). Keep the cat as he is; don't redraw him.
- PC and TV share one layout ("Spotlight"): TV keeps big type, focus rings and remote navigation;
  PC adds hover menus, a search dropdown and denser grids. Change both when you change one.

## Before you finish
1. Run `npm test`, `npm run test:py`, `npm run typecheck`; for UI changes also `npm run build &&
   npm run test:visual` and look at the screenshots.
2. Update `docs/HANDOFF.md`: what you changed, what is unverified, anything the next person needs.
3. Work on a branch and open a pull request; don't push to `main`.
