# Handoff: current state of work

_Last updated: 2026-11-24. Update this file at the end of every work session (see `AGENTS.md`)._

## Open pull requests (merge in this order)

| PR | Branch | What | Base |
|---|---|---|---|
| #4 | `spotlight-redesign` | The "Spotlight" redesign for PC and TV, plus everything built on it: Dobby branding, paged libraries with sort/genre/filter, card menus (remove from Continue watching, mark watched, My list), longer artwork caching, player features (Skip intro, Up next with autoplay, subtitle size/background settings), lazy-loaded pages, and the local OpenSubtitles dataset for the Romanian subtitle job. | `main` |
| #5 | `review-fixes` | Fixes from an in-depth code review of #4 and of the backend (login throttling behind Funnel, undecryptable sessions, stuck requests, subtitle job cooldowns, player and search bugs). The PR description lists every finding, including the ones deliberately not changed. | `spotlight-redesign` |
| #6 | `handoff-docs` | This file, `AGENTS.md`, the mock gateway and the browser smoke test. | `review-fixes` |

Each PR is stacked on the previous one. After merging one, GitHub retargets the next to `main`
if the merged branch is deleted. Otherwise change the base by hand.

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
- **Deploying #4–#6 to the server.** The server still runs the code from `main`.
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
- **Untagged FileList RSS feeds** only keep titles with video release tags (resolution, source,
  codec, season), because their categories can't be checked.
- **Desene (15) and Docs (16)** are included in default FileList searches on purpose.
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
