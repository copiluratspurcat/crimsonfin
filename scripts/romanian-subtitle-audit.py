#!/usr/bin/env python3
"""Non-AI Romanian subtitle auditor for CrimsonFin.

Scans Jellyfin media metadata for missing Romanian captions. On --apply, tries
community subtitle providers, validates SRT timing, and installs *only* missing
sidecars atomically. Never translates English, never replaces an existing file,
and never downloads a torrent or modifies a video file.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

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


def all_items(cfg):
    users = jf("/Users", cfg)
    admin = next((u for u in users if u.get("Policy", {}).get("IsAdministrator")), None)
    if not admin:
        raise RuntimeError("No administrator metadata user found")
    start = 0
    items = []
    while start < 15_000:
        params = urllib.parse.urlencode({
            "Recursive": "true", "IncludeItemTypes": "Movie,Episode",
            "StartIndex": start, "Limit": "500", "Fields": "Path,MediaSources",
        })
        page = jf("/Users/" + admin["Id"] + "/Items?" + params, cfg)
        batch = page.get("Items") or []
        items.extend(batch)
        if not batch or start + len(batch) >= page.get("TotalRecordCount", len(items)):
            break
        start += len(batch)
    return items


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
    parser.add_argument("--limit", type=int, default=4, help="Maximum provider lookups per scan (1-10)")
    options = parser.parse_args()
    limit = min(10, max(1, options.limit))
    cfg = environment()
    items = all_items(cfg)
    state = load_state()
    attempts = state.setdefault("attempts", {})
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
        last = attempts.get(item.get("Id"), 0)
        if not last or time.time() - last >= 7 * 86400:
            pending.append((item, path))
    # Newer items get a chance first; exhausted providers are retried weekly.
    pending.sort(key=lambda row: row[1].stat().st_mtime, reverse=True)
    if options.apply:
        for item, path in pending[:limit]:
            # Embedded Romanian captions require no external file.
            if has_romanian(item, path):
                continue
            duration = (item.get("RunTimeTicks") or 0) / 10_000_000
            summary["attempted"] += 1
            attempts[item["Id"]] = time.time()
            content, result = subliminal_candidate(path, duration)
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
    state["lastScanUtc"] = dt.datetime.now(dt.timezone.utc).isoformat()
    state["lastSummary"] = summary
    save_state(state)
    print(json.dumps(summary))
    print("No machine translation is performed; existing subtitles are never overwritten.")


if __name__ == "__main__":
    main()
