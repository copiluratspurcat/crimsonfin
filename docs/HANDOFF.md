# Handoff: current state of work

_Last updated: 2026-11-24. Update this file at the end of every work session (see `AGENTS.md`)._

## Shared title and subtitle preference

Selecting EN or RO in the main menu also sets the player's automatic subtitle
language. The active preference appears in the Auto option. Users can still
pick a specific subtitle track or turn subtitles off in the player.

## Release 2.5.9

Includes the English and Romanian title switch, local-only Romanian subtitle
lookup, and a display fallback for recognizable release filenames. The fallback
does not alter the matching or artwork in Jellyfin. The gateway updater does
not copy the subtitle scripts, so switching the subtitle job requires a
separate service override and a verified local index and dump.

## English and Romanian titles

The top-right EN/RO switch changes displayed movie and show names and remembers the
choice on the device. Set `TMDB_READ_ACCESS_TOKEN` in the gateway's `.env` to enable both
localized titles for items with a Jellyfin TMDB ID. When a translation is missing,
CrimsonFin uses Jellyfin's title (or its original title in English mode).
Search matching and sort order still follow Jellyfin. The live TMDB configuration
and a physical TV remain unverified.

## Release 2.5.8

The live FileList API returned valid rows with English labels such as Movies HD
and TV-Series HD. The gateway now accepts those aliases alongside Romanian
labels and IDs, with the same Movies, TV Shows, and Anime allowlist.

## Release 2.5.7

The release integrates the Spotlight redesign (#4), review fixes (#5), and
handoff tools (#6). PRs #5 and #6 originally merged into intermediate branches.
The FileList scope remains Movies, TV Shows, and Anime. The release workflow
pins the tag to the commit that built the assets.

## Local-only subtitles

The subtitle audit accepts `--local-only` to disable internet providers. It
requires a configured local metadata index and at least one dump. The
`scripts/build-opensubs-index.py` helper builds a Romanian-only index from the
published compressed metadata export.

## Verified
- Automated tests: `npm test` (46 pass, 1 skipped on Windows), `npm run test:py` (16), typecheck, build.
- `npm run test:visual`: 37 checks across the PC and TV layouts against the mock gateway.
- PC layout against the owner's real gateway, through the Vite proxy: browsing, paging, details,
  card menus, playback, artwork caching. The desktop Electron app was also run against it.

## Not verified yet
- **Android TV on a real device.** The TV layout has only been tested in a desktop browser with
  the TV user agent.
- **Skip intro / credits with real data.** That needs Jellyfin 10.10+ MediaSegments or the Intro
  Skipper plugin on the server; only mock data has been used.
- **Live deployment and device upgrade.** Verify the updater logs, the gateway version and served bundle, and client installation.
- **#5 against real services:** login throttling through Funnel, and qBittorrent request
  handling (removed torrents, interrupted searches).
- **The local OpenSubtitles dataset.** It isn't downloaded on the server yet. Setup is in the
  README ("Local OpenSubtitles dataset"); it needs about 160–200 GB plus the
  `subtitles_all.db` index. Its column names come from the scraper project's scripts, not
  from a real copy.

## Decisions and why (don't undo these without asking)
- **Login is username + password**, not a profile picker. This was the owner's explicit choice.
- **Readability first.** An earlier decorative "theatre" design was rejected as hard to read.
- **Login throttling is per username plus a global cap**, because every Funnel client shares
  `127.0.0.1`. The trade-off: someone who knows a username can block that one account for 15 minutes.
- **OpenSubtitles daily limit:** solved with the offline dataset instead of the API. Don't add
  scraping or API workarounds. It's still unknown which server component was hitting the limit
  (probably Jellyfin's own OpenSubtitles plugin).
- **Subtitle job cooldowns:** online providers 7 days, local dataset 30 days, tracked separately
  so a local miss doesn't block the online providers.
- **FileList categories** stay limited to Movies, TV Shows, and Anime. Untagged RSS
  entries are omitted because their category cannot be verified.
- **FileList search** is open to all signed-in users (the Requests page uses it), so they share
  the global hourly quota.

## Ideas not started
- Run `npm run typecheck`, `npm run test:py` and possibly `npm run test:visual` in CI (`ci.yml`
  only runs `npm test` and the build).
- `scripts/repair-episode-metadata.mjs` reads at most 10,000 episodes in one request; add paging.
- The README's "Project structure" section is out of date (it mentions `web/src/styles.css`;
  the styles are in `web/src/spotlight.css`).
- Player: Jellyfin PlaybackInfo / device-profile negotiation. The player always asks for HLS with
  H.264 + AAC at a chosen bitrate (`web/src/hls-url.ts`), so Jellyfin transcodes even when the
  device could play the file directly.

## Working setup
- Copy `.env.example` to `.env`. The owner shares secrets out of band; never commit them.
- UI work without a server: `npm run build && npm run mock`.
- UI work against the real gateway: `CRIMSONFIN_GATEWAY=https://<gateway host> npm run dev`,
  then sign in with your own Jellyfin account.
- Desktop app against the dev server: `CRIMSONFIN_DEV_URL=http://127.0.0.1:5173 npm run desktop:dev`
  (only works when unpackaged).
