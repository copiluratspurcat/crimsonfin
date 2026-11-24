#!/usr/bin/env python3
"""Non-AI Romanian subtitle auditor for CrimsonFin.

Scans Jellyfin media metadata for missing Romanian captions. On --apply, looks
them up first in a local copy of the opensubtitles.org dataset (if configured:
no network, no daily quota), then in community subtitle providers; validates SRT
timing and language, and installs *only* missing sidecars atomically. Never
translates English, never replaces an existing file, and never downloads a
torrent or modifies a video file.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
STATE_PATH = DATA / "romanian-subtitle-audit.json"
SOURCE = "/opt/jellyfin-subtitle-autopilot/venv/bin/subliminal"
LANG_CODES = {"ro", "ron", "rum", "ro-ro"}
MEDIA_ROOTS = ["/mnt/WD1TBLU/", "/mnt/ADATA/"]
VIDEO_EXT = {".mkv", ".mp4", ".m4v", ".avi", ".webm"}
SRT_TIMES = re.compile(
    r"(?m)^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*"
    r"(\d{2}:\d{2}:\d{2}[,.]\d{3})"
)
KEYWORDS = re.compile(r"(?i)\b(?:și|si|în|intre|pentru|este|sunt|care|vreau|acum|doar|dacă|deci|facem|trebuie|bună|totuși|nici)\b")


def environment():
    config = {}
    for line in (ROOT / ".env").read_text(encoding="utf8").splitlines():
        if re.match(r"^[A-Z][A-Z0-9_]*=", line):
            name, value = line.split("=", 1)
            config[name] = value
    return config


def jf(url, cfg, method="GET"):
    token = cfg.get("JELLYFIN_METADATA_API_KEY")
    if not token:
        raise RuntimeError("Dedicated Jellyfin metadata key missing")
    api = urllib.parse.urlsplit(cfg.get("JELLYFIN_URL", "http://127.0.0.1:8096"))
    if api.scheme != "http" or api.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise RuntimeError("Only a local Jellyfin API is supported")
    auth = f'MediaBrowser Client="CrimsonFinSubs", Device="Server", DeviceId="crimsonfin-subtitle-audit", Version="2.2", Token="{token}"'
    request = urllib.request.Request(
        urllib.parse.urljoin(api.geturl().rstrip("/") + "/", url.lstrip("/")),
        method=method, headers={"Authorization": auth, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=25) as response:
        if method != "GET" or response.status == 204:
            return None
        if (response.headers.get("Content-Length") or "0").isdigit() and int(response.headers.get("Content-Length") or 0) > 10_000_000:
            raise RuntimeError("Jellyfin response exceeds safe size")
        return json.loads(response.read(10_000_000))


def admin_id(cfg):
    users = jf("/Users", cfg)
    admin = next((u for u in users if u.get("Policy", {}).get("IsAdministrator")), None)
    if not admin:
        raise RuntimeError("No administrator metadata user found")
    return admin["Id"]


def all_items(cfg, types="Movie,Episode", fields="Path,MediaSources,ProviderIds", user=None):
    user = user or admin_id(cfg)
    start = 0
    items = []
    while start < 15_000:
        params = urllib.parse.urlencode({
            "Recursive": "true", "IncludeItemTypes": types,
            "StartIndex": start, "Limit": "500", "Fields": fields,
        })
        page = jf("/Users/" + user + "/Items?" + params, cfg)
        batch = page.get("Items") or []
        items.extend(batch)
        if not batch or start + len(batch) >= page.get("TotalRecordCount", len(items)):
            break
        start += len(batch)
    return items


def series_imdb_ids(cfg, user):
    """Series Jellyfin id -> numeric IMDb id (episodes are indexed by their show's IMDb id)."""
    return {s["Id"]: imdb_number((s.get("ProviderIds") or {}).get("Imdb"))
            for s in all_items(cfg, types="Series", fields="ProviderIds", user=user)}


def approved_video(item):
    raw = item.get("Path") or ""
    if not isinstance(raw, str):
        return None
    p = Path(raw)
    if p.suffix.lower() not in VIDEO_EXT:
        return None
    try:
        resolved = p.resolve(strict=True)
    except OSError:
        return None
    if not resolved.is_file():
        return None
    if not any(str(resolved).startswith(root) for root in MEDIA_ROOTS):
        return None
    if time.time() - resolved.stat().st_mtime < 1800:
        return None
    return resolved


def has_romanian(item, path):
    sources = item.get("MediaSources") or []
    for source in sources:
        for stream in source.get("MediaStreams") or []:
            if stream.get("Type") == "Subtitle" and str(stream.get("Language") or "").lower() in LANG_CODES:
                return True
    for suffix in (".ro.srt", ".ron.srt", ".rum.srt", ".ro.vtt", ".ron.vtt", ".ro.ass"):
        candidate = path.with_name(path.stem + suffix)
        if candidate.exists() and candidate.stat().st_size > 500:
            return True
    return False


def timestamp_seconds(value):
    h, m, sec = value.replace(".", ",").split(":")
    seconds, ms = sec.split(",")
    return int(h) * 3600 + int(m) * 60 + int(seconds) + int(ms) / 1000


def validate_srt(contents, duration):
    if len(contents) < 2000 or len(contents) > 2_000_000:
        return False, "subtitle length outside expected range"
    try:
        text = contents.decode("utf-8-sig")
    except UnicodeDecodeError:
        for enc in ("cp1250", "iso-8859-2"):
            try:
                text = contents.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            return False, "cannot decode Romanian subtitle"
    blocks = SRT_TIMES.findall(text)
    if len(blocks) < 55:
        return False, "too few timed subtitle cues"
    last = timestamp_seconds(blocks[-1][1])
    if not 240 <= last <= 18_000:
        return False, "subtitle duration implausible"
    if duration and not 0.5 * duration <= last <= 1.15 * duration:
        return False, "subtitle duration does not match media"
    if len(KEYWORDS.findall(text[:100_000])) < 12:
        return False, "Romanian language could not be verified"
    # Need monotonic cue start times; allow overlapping adjacent lines.
    last_start = -1
    for start, end in blocks:
        a, b = timestamp_seconds(start), timestamp_seconds(end)
        if b <= a or a < last_start - 0.1:
            return False, "invalid/out-of-order timing"
        last_start = a
    return text.encode("utf-8"), f"{len(blocks)} valid cues"


def subliminal_candidate(video, duration):
    if not Path(SOURCE).is_file():
        return None, "community provider binary unavailable"
    with tempfile.TemporaryDirectory(prefix="cf-romanian-") as folder:
        args = [
            SOURCE, "download", "-l", "ro",
            "-p", "podnapisi", "-p", "tvsubtitles",
            "-m", "73", "--skip-wrong-fps",
            "-d", folder, str(video)
        ]
        try:
            result = subprocess.run(args, capture_output=True, text=True, timeout=75)
        except subprocess.TimeoutExpired:
            return None, "community sources timed out"
        files = sorted(Path(folder).glob("*.srt"), key=lambda p: p.stat().st_size, reverse=True)
        for f in files[:3]:
            valid, desc = validate_srt(f.read_bytes(), duration)
            if valid:
                return valid, "Podnapisi/TVSubtitles · " + desc
        if "error" in result.stderr.lower() or "error" in result.stdout.lower():
            return None, "community providers unavailable"
        return None, "no verified Romanian subtitle available"


# --- Local OpenSubtitles.org dataset (no network, no daily quota) -------------------------
# Uses a local copy of the published opensubtitles.org dump (github.com/milahu/opensubtitles-scraper):
#   OPENSUBS_METADATA_DB  subtitles_all.db built from the official subtitles_all.txt.gz export
#                         (table subz_metadata: IDSubtitle, ImdbID, ISO639, SeriesIMDBParent, ...)
#   OPENSUBS_DUMP_DIRS    folders separated by ':' (';' on Windows) holding release/shard SQLite files whose
#                         `zipfiles(num, name, content)` rows are individually zipped subtitles.
ROMANIAN_ISO = ("ro", "rum", "ron")
DUMP_NAME = re.compile(r"^(\d+)(x+)\.db$")
MAX_ZIP_MEMBER = 5_000_000
ONLINE_RETRY = 7 * 86400    # online providers: retry a title weekly
LOCAL_RETRY = 30 * 86400    # local dataset: changes only when new dump releases are added


def readonly_sqlite(path):
    """Open a SQLite file read-only; as_uri() escapes '?', '#' and '%' in the path."""
    return sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)


class LocalDataset:
    """Romanian subtitle lookups against a local opensubtitles.org dump."""

    def __init__(self, metadata_db, dump_dirs):
        self.metadata = readonly_sqlite(metadata_db)
        self.ranged, self.unranged = [], []
        for folder in dump_dirs:
            for path in sorted(Path(folder).rglob("*.db")):
                match = DUMP_NAME.match(path.name)
                if match:  # e.g. 95xxxxx.db covers 9500000-9599999, 9512xxx.db covers 9512000-9512999
                    size = 10 ** len(match.group(2))
                    base = int(match.group(1)) * size
                    self.ranged.append((base, base + size, path))
                elif path.resolve() != Path(metadata_db).resolve():
                    self.unranged.append(path)
        self._connections = {}

    @classmethod
    def from_config(cls, cfg):
        metadata = cfg.get("OPENSUBS_METADATA_DB", "").strip()
        dirs = [d for d in cfg.get("OPENSUBS_DUMP_DIRS", "").split(os.pathsep) if d.strip()]
        if not metadata or not dirs or not Path(metadata).is_file():
            return None
        return cls(metadata, [d.strip() for d in dirs if Path(d.strip()).is_dir()])

    def candidates(self, imdb=None, series_imdb=None, season=None, episode=None):
        """Romanian subtitle IDs for a movie (IMDb) or an episode (series IMDb + S/E)."""
        marks = ",".join("?" * len(ROMANIAN_ISO))
        rows = []
        if series_imdb and season is not None and episode is not None:
            rows += self.metadata.execute(
                f"SELECT IDSubtitle, MovieReleaseName, SubSumCD, SubAddDate FROM subz_metadata "
                f"WHERE SeriesIMDBParent=? AND SeriesSeason=? AND SeriesEpisode=? AND ISO639 IN ({marks})",
                (series_imdb, season, episode, *ROMANIAN_ISO)).fetchall()
        if imdb:
            rows += self.metadata.execute(
                f"SELECT IDSubtitle, MovieReleaseName, SubSumCD, SubAddDate FROM subz_metadata "
                f"WHERE ImdbID=? AND ISO639 IN ({marks})", (imdb, *ROMANIAN_ISO)).fetchall()
        seen, unique = set(), []
        for row in rows:
            if row[0] not in seen:
                seen.add(row[0])
                unique.append(row)
        return unique

    def _connection(self, path):
        if path not in self._connections:
            self._connections[path] = readonly_sqlite(path)
        return self._connections[path]

    def zipped(self, num):
        """The zipped subtitle for an opensubtitles.org ID, or None if no local file has it."""
        files = [p for lo, hi, p in self.ranged if lo <= num < hi] + self.unranged
        for path in files:
            try:
                row = self._connection(path).execute("SELECT content FROM zipfiles WHERE num=?", (num,)).fetchone()
            except sqlite3.Error:
                continue
            if row and row[0]:
                return bytes(row[0])
        return None


def release_tokens(name):
    return {t for t in re.split(r"[^a-z0-9]+", (name or "").lower()) if len(t) > 1}


def rank_candidates(rows, video_name):
    """Prefer single-file subtitles whose release name shares tokens with the video, then newest."""
    wanted = release_tokens(Path(video_name).stem)
    def score(row):
        _, release, cds, added = row
        return (len(wanted & release_tokens(release)), 1 if (cds or 1) == 1 else 0, str(added or ""))
    return sorted(rows, key=score, reverse=True)


def srt_from_zip(blob):
    """Largest .srt inside a subtitle zip, with size/entry limits against malformed archives."""
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            entries = [e for e in archive.infolist()[:20]
                       if e.filename.lower().endswith(".srt") and 0 < e.file_size <= MAX_ZIP_MEMBER]
            if not entries:
                return None
            best = max(entries, key=lambda e: e.file_size)
            with archive.open(best) as member:
                return member.read(MAX_ZIP_MEMBER + 1)[:MAX_ZIP_MEMBER]
    except Exception:  # BadZipFile, zlib.error, EOFError, NotImplementedError (e.g. deflate64), ...
        # One damaged archive in the dump must not stop the whole scan.
        return None


def imdb_number(value):
    match = re.fullmatch(r"(?:tt)?0*(\d{1,10})", str(value or "").strip())
    return int(match.group(1)) if match else None


def dataset_candidate(dataset, item, series_imdb, video, duration, tries=6):
    """A validated Romanian subtitle from the local dataset, or (None, reason)."""
    imdb = imdb_number((item.get("ProviderIds") or {}).get("Imdb"))
    episode = item.get("Type") == "Episode"
    rows = dataset.candidates(imdb=imdb, series_imdb=series_imdb if episode else None,
                              season=item.get("ParentIndexNumber"), episode=item.get("IndexNumber"))
    if not rows:
        return None, "not in local dataset index" if (imdb or series_imdb) else "no IMDb id in Jellyfin"
    missing = 0
    for num, *_ in rank_candidates(rows, video.name)[:tries]:
        blob = dataset.zipped(num)
        if blob is None:
            missing += 1
            continue
        srt = srt_from_zip(blob)
        if not srt:
            continue
        valid, desc = validate_srt(srt, duration)
        if valid:
            return valid, f"local OpenSubtitles dataset #{num} · {desc}"
    if missing == min(len(rows), tries):
        return None, "indexed, but not in the downloaded dump releases"
    return None, "local dataset matches failed validation"


def load_state():
    try:
        state = json.loads(STATE_PATH.read_text())
        if not isinstance(state, dict):
            raise ValueError
        return state
    except (OSError, ValueError):
        return {"attempts": {}}


def save_state(state):
    DATA.mkdir(parents=True, exist_ok=True)
    # Retry timestamps past their cooldown carry no information; dropping them keeps the
    # file small (the gateway's admin status page reads it).
    now = time.time()
    for key, keep in (("attempts", ONLINE_RETRY), ("localAttempts", LOCAL_RETRY)):
        log = state.get(key)
        if isinstance(log, dict):
            state[key] = {k: v for k, v in log.items() if isinstance(v, (int, float)) and now - v < keep}
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.chmod(0o600)
    os.replace(tmp, STATE_PATH)


def refresh_jellyfin(item, cfg):
    if re.fullmatch(r"[0-9a-fA-F-]{32,36}", str(item.get("Id", ""))):
        query = "Recursive=false&MetadataRefreshMode=ValidationOnly&ImageRefreshMode=None"
        try:
            jf(f'/Items/{item["Id"]}/Refresh?{query}', cfg, method="POST")
        except Exception as exc:
            print("  Jellyfin refresh deferred:", type(exc).__name__)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Add validated human-provider subtitles that are missing")
    parser.add_argument("--limit", type=int, default=4, help="Maximum online provider lookups per scan (1-10)")
    parser.add_argument("--local-limit", type=int, default=200,
                        help="Maximum local OpenSubtitles dataset lookups per scan (no network, 1-5000)")
    options = parser.parse_args()
    limit = min(10, max(1, options.limit))
    local_limit = min(5000, max(1, options.local_limit))
    cfg = environment()
    user = admin_id(cfg)
    items = all_items(cfg, user=user)
    dataset = LocalDataset.from_config(cfg)
    series_imdb = series_imdb_ids(cfg, user) if dataset else {}
    if dataset:
        print(f"Local OpenSubtitles dataset: {len(dataset.ranged) + len(dataset.unranged)} dump file(s)")
    state = load_state()
    attempts = state.setdefault("attempts", {})            # online providers
    local_attempts = state.setdefault("localAttempts", {})  # local dataset
    summary = {"checked": 0, "haveRomanian": 0, "possiblyMissing": 0, "attempted": 0, "installed": 0}
    pending = []
    for item in items:
        path = approved_video(item)
        if not path:
            continue
        summary["checked"] += 1
        if has_romanian(item, path):
            summary["haveRomanian"] += 1
            continue
        summary["possiblyMissing"] += 1
        online_due = time.time() - attempts.get(item.get("Id"), 0) >= ONLINE_RETRY
        local_due = bool(dataset) and time.time() - local_attempts.get(item.get("Id"), 0) >= LOCAL_RETRY
        if online_due or local_due:
            pending.append((item, path, online_due, local_due))
    # Newer items get a chance first; exhausted providers are retried weekly.
    pending.sort(key=lambda row: row[1].stat().st_mtime, reverse=True)
    try:
        if options.apply:
            apply_pending(pending, dataset, series_imdb, attempts, local_attempts, summary, cfg, limit, local_limit)
    finally:
        # Saved even if a scan fails part-way, so finished lookups are not repeated.
        state["lastScanUtc"] = dt.datetime.now(dt.timezone.utc).isoformat()
        state["lastSummary"] = summary
        save_state(state)
    print(json.dumps(summary))
    print("No machine translation is performed; existing subtitles are never overwritten.")


def apply_pending(pending, dataset, series_imdb, attempts, local_attempts, summary, cfg, limit, local_limit):
    # The local dataset is tried first (no network, no daily quota); online providers keep
    # their small per-scan limit and only run for titles the dataset could not cover.
    local_used = online_used = 0
    for item, path, online_due, local_due in pending:
        if (not dataset or local_used >= local_limit) and online_used >= limit:
            break
        # Embedded Romanian captions require no external file.
        if has_romanian(item, path):
            continue
        duration = (item.get("RunTimeTicks") or 0) / 10_000_000
        content, result = None, ""
        # Each source has its own cooldown: a local miss must not hold a title back from
        # the online providers (or the other way round).
        if local_due and dataset and local_used < local_limit:
            local_used += 1
            local_attempts[item["Id"]] = time.time()
            content, result = dataset_candidate(dataset, item, series_imdb.get(item.get("SeriesId")), path, duration)
        if not content and online_due and online_used < limit:
            online_used += 1
            attempts[item["Id"]] = time.time()
            content, online_result = subliminal_candidate(path, duration)
            result = f"{result} · {online_result}" if result else online_result
        if not result:
            continue
        summary["attempted"] += 1
        print(f'  {item.get("SeriesName") or item.get("Name")} : {result}')
        if not content:
            continue
        target = path.with_name(path.stem + ".ro.srt")
        # "xb" refuses to overwrite user-managed or other services' files.
        try:
            with target.open("xb") as file:
                file.write(content)
        except FileExistsError:
            continue
        summary["installed"] += 1
        refresh_jellyfin(item, cfg)


if __name__ == "__main__":
    main()
