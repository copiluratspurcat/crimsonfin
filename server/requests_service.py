#!/usr/bin/env python3
"""CrimsonFin media request companion, Python 3.11+, standard library only.

RSS is a discovery feed, not a download transport. This service deliberately
accepts download links only from a server-configured allowlist and authenticates
every client action against Jellyfin. Use feeds/content you are authorized to use.
"""
from __future__ import annotations

import hashlib
import http.cookiejar
import ipaddress
import json
import logging
import os
from pathlib import Path
import re
import shutil
import socket
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener, urlopen
from xml.etree import ElementTree as ET

LOG = logging.getLogger('crimsonfin-requests')
APP_DIR = Path(__file__).resolve().parent

def env_bool(name: str, default=False):
    return os.getenv(name, 'true' if default else 'false').lower() in ('true', 'yes', '1', 'on')

class Config:
    jellyfin = os.getenv('JELLYFIN_URL', 'http://127.0.0.1:8096').rstrip('/')
    host = os.getenv('REQUEST_HOST', '127.0.0.1')
    port = int(os.getenv('REQUEST_PORT', '8787'))
    database = Path(os.getenv('REQUEST_DB', str(APP_DIR / 'requests.sqlite')))
    download_dir = Path(os.getenv('DOWNLOAD_DIR', str(APP_DIR / 'downloads')))
    rss = os.getenv('RSS_FEED_URL', '').strip()
    filelist_username = os.getenv('FILELIST_API_USERNAME', '').strip()
    filelist_passkey = os.getenv('FILELIST_API_PASSKEY', '').strip()
    # Empty passkey reuses the one embedded in the server-side RSS URL.
    filelist_api_enabled = env_bool('FILELIST_API_ENABLED', True)
    allowed_hosts = {x.strip().lower() for x in os.getenv('RSS_ALLOWED_HOSTS', '').split(',') if x.strip()}
    allow_private_download_hosts = env_bool('ALLOW_PRIVATE_DOWNLOAD_HOSTS', False)
    automatic = env_bool('AUTO_APPROVE', False)
    scan_seconds = max(15, int(os.getenv('RSS_CHECK_SECONDS', '90')))
    max_per_user = max(1, int(os.getenv('MAX_OPEN_REQUESTS_PER_USER', '8')))
    min_free_gb = max(0, float(os.getenv('MIN_FREE_GB', '5')))
    max_download_gb = max(1, float(os.getenv('MAX_DOWNLOAD_GB', '100')))
    tmdb_token = os.getenv('TMDB_READ_TOKEN', '').strip()
    qbit_url = os.getenv('QBITTORRENT_URL', '').rstrip('/')
    qbit_user = os.getenv('QBITTORRENT_USER', '')
    qbit_password = os.getenv('QBITTORRENT_PASSWORD', '')
    disks = os.getenv('STORAGE_PATHS', '')
    # NAME=/absolute/mountpoint;NAME2=/absolute/mountpoint. Empty keeps v1.1 compatibility.
    media_drives = os.getenv('MEDIA_DRIVES', '')
    require_mountpoints = env_bool('REQUIRE_MOUNTPOINTS', True)
    # Some private trackers serve torrent bytes via download.php?id=... not *.torrent.
    torrent_endpoints = {p.strip().lower() for p in os.getenv('TORRENT_ENDPOINT_PATHS', '/download.php').split(',') if p.strip()}
    movie_folder = os.getenv('MOVIES_FOLDER', 'Movies')
    shows_folder = os.getenv('SHOWS_FOLDER', 'TV Shows')

CFG = Config()
LOCK = threading.RLock()
FEED_CACHE: tuple[float, list] = (0, [])
DOWNLOAD_THREADS: set[str] = set()
API_CACHE: dict[tuple, tuple[float, list]] = {}
API_CALLS: list[float] = []


class ServiceError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status

@contextmanager
def database():
    con = sqlite3.connect(CFG.database, timeout=20)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()

def utc():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

def setup_database():
    CFG.database.parent.mkdir(parents=True, exist_ok=True)
    if not CFG.media_drives.strip():
        CFG.download_dir.mkdir(parents=True, exist_ok=True)
    with database() as con:
        con.execute('PRAGMA journal_mode=WAL')
        con.execute('''CREATE TABLE IF NOT EXISTS requests (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL,
          year INTEGER, season INTEGER, tmdb_id INTEGER,
          requester_id TEXT NOT NULL, requester_name TEXT NOT NULL,
          status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          entry_id TEXT, download_url TEXT, download_ref TEXT, download_name TEXT,
          download_kind TEXT, bytes_done INTEGER DEFAULT 0, bytes_total INTEGER DEFAULT 0,
          error TEXT DEFAULT '', save_path TEXT DEFAULT '', drive_name TEXT DEFAULT ''
        )''')
        # Migrate existing request databases without losing queued history.
        columns={r[1] for r in con.execute('PRAGMA table_info(requests)')}
        for key in ('save_path','drive_name'):
            if key not in columns:con.execute(f'ALTER TABLE requests ADD COLUMN {key} TEXT DEFAULT ''')
        # A crashed standalone HTTP download is not silently resumed with partial bytes.
        con.execute('''UPDATE requests SET status='failed',
          error='Download interrupted by server restart; ask an administrator to retry.',
          updated_at=? WHERE status='downloading' AND download_kind='http' ''', (utc(),))

def row_to_dict(row):
    if row is None:
        return None
    obj = dict(row)
    # Never expose private RSS URLs, magnet links, or download client references.
    for field in ('download_url', 'download_ref', 'entry_id', 'save_path'):
        obj.pop(field, None)
    total = obj.get('bytes_total') or 0
    obj['percent'] = round(min(100.0, max(0.0, (obj.get('bytes_done') or 0) / total * 100)), 1) if total else (100 if obj['status'] == 'completed' else None)
    return obj

def load_request(request_id):
    with database() as con:
        return con.execute('SELECT * FROM requests WHERE id=?', (request_id,)).fetchone()

def change(request_id, **fields):
    if not fields:
        return
    fields['updated_at'] = utc()
    keys = list(fields)
    with database() as con:
        con.execute('UPDATE requests SET ' + ','.join(k + '=?' for k in keys) + ' WHERE id=?', [fields[k] for k in keys] + [request_id])

def is_admin(user):
    return bool(user.get('Policy', {}).get('IsAdministrator'))

def validate_jellyfin_token(token):
    if not re.fullmatch(r'[A-Za-z0-9._~\-]{12,512}', token or ''):
        raise ServiceError('Jellyfin login required.', 401)
    req = Request(CFG.jellyfin + '/Users/Me', headers={
        'X-Emby-Token': token, 'Accept': 'application/json', 'User-Agent': 'CrimsonFin-Requests/1.1'})
    try:
        with urlopen(req, timeout=7) as resp:
            obj = json.load(resp)
    except Exception as exc:
        LOG.info('Jellyfin token check failed: %s', type(exc).__name__)
        raise ServiceError('Jellyfin session expired or server unavailable.', 401) from None
    if not obj.get('Id') or not obj.get('Name') or obj.get('Policy', {}).get('IsDisabled'):
        raise ServiceError('Account cannot access requests.', 403)
    return obj

def normalize_title(value):
    return ' '.join(re.findall(r'[a-z0-9]+', (value or '').casefold()))

def safe_filename(value):
    raw = re.sub(r'[^a-zA-Z0-9 ._()\-]+', '_', value)
    raw = re.sub(r'\s+', ' ', raw).strip(' ._')[:130]
    return raw or 'media-download'

def validate_download_url(url):
    """Only admin-approved feed domains may supply HTTP downloads.

    An allowlist is still required; avoid pointing this service at untrusted feeds.
    """
    if url.startswith('magnet:?'):
        if not CFG.qbit_url:
            raise ServiceError('A qBittorrent backend is required for magnet links.')
        return 'torrent'
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ServiceError('The RSS entry has an invalid download link.')
    host = parsed.hostname.lower()
    if host not in CFG.allowed_hosts:
        raise ServiceError('Download host is not in RSS_ALLOWED_HOSTS.')
    if not CFG.allow_private_download_hosts:
        try:
            ips = [info[4][0] for info in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)]
        except OSError:
            raise ServiceError('Download host cannot be resolved.') from None
        if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
            raise ServiceError('Private/reserved download address blocked.')
    extension = Path(parsed.path).suffix.lower()
    if extension == '.torrent' or parsed.path.lower() in CFG.torrent_endpoints:
        if not CFG.qbit_url:
            raise ServiceError('A qBittorrent backend is required for .torrent entries.')
        return 'torrent'
    if extension not in ('.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.ts'):
        raise ServiceError('Feed entry must link to a direct media file or .torrent.')
    return 'http'

class CheckedRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_download_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def rss_entries(force=False):
    global FEED_CACHE
    if not CFG.rss:
        raise ServiceError('RSS_FEED_URL has not been configured on the server.', 503)
    now = time.monotonic()
    with LOCK:
        if not force and now - FEED_CACHE[0] < 30:
            return FEED_CACHE[1]
    parsed = urlparse(CFG.rss)
    if parsed.scheme not in ('https', 'http') or not parsed.hostname:
        raise ServiceError('RSS_FEED_URL must be HTTP or HTTPS.', 503)
    try:
        with urlopen(Request(CFG.rss, headers={'User-Agent':'CrimsonFin-Requests/1.1'}), timeout=14) as response:
            data = response.read(3_000_001)
        if len(data) > 3_000_000:
            raise ServiceError('RSS feed is larger than 3 MB.', 502)
        root = ET.fromstring(data)
    except ServiceError:
        raise
    except Exception as exc:
        LOG.warning('RSS fetch error: %s', type(exc).__name__)
        raise ServiceError('RSS feed could not be read; check server configuration.', 502) from None
    entries = []
    def strip_ns(tag): return tag.rsplit('}', 1)[-1].lower()
    for node in root.iter():
        if strip_ns(node.tag) not in ('item', 'entry'):
            continue
        title = next((sub.text.strip() for sub in node if strip_ns(sub.tag) == 'title' and sub.text), '')
        if not title:
            continue
        candidates = []
        for sub in node:
            tag = strip_ns(sub.tag)
            if tag == 'enclosure': candidates.append(sub.attrib.get('url', ''))
            elif tag == 'link':
                if sub.attrib.get('rel') == 'enclosure': candidates.append(sub.attrib.get('href', ''))
                elif sub.text: candidates.append(sub.text.strip())
                elif sub.attrib.get('href'): candidates.append(sub.attrib['href'])
        for link in candidates:
            if not link:
                continue
            try:
                kind = validate_download_url(link)
            except ServiceError:
                continue
            entry_id = hashlib.sha256((title + '\n' + link).encode()).hexdigest()[:24]
            entries.append({'entry_id':entry_id, 'title':title[:300], 'url':link, 'kind':kind})
            break
        if len(entries) >= 300:
            break
    with LOCK:
        FEED_CACHE = (time.monotonic(), entries)
    return entries

def score_entry(req, entry):
    title = normalize_title(req['title'])
    candidate = normalize_title(entry['title'])
    if not title or not candidate or not (candidate == title or candidate.startswith(title + ' ')):
        return 0
    kind = req['kind']
    if kind == 'Movie':
        year = req['year']
        if year and not re.search(r'(?<!\d)' + str(year) + r'(?!\d)', entry['title']):
            return 0
        return 100 if year else 80
    season = req['season']
    if season is not None:
        # Season pack or specific episode from the requested season.
        if not re.search(r'(?i)\bS0*' + str(season) + r'(?:\b|E\d)', entry['title']):
            return 0
        # A season request can match a season pack automatically. Individual
        # episode entries are offered for manual review, never auto-selected.
        if re.search(r'(?i)\bS0*' + str(season) + r'E\d+', entry['title']):
            return 65
        return 90
    return 50  # Unspecified series season requires human selection.

def filelist_api_entries(req):
    """Search the tracker on demand; never expose authenticated URLs to clients.

    The v1.1.1 companion still uses the RSS feed as a fallback. Cache results
    for 30 minutes and cap outbound calls to avoid the tracker rate limit.
    """
    if not CFG.filelist_api_enabled or not CFG.filelist_username:
        return []
    rss_params = parse_qs(urlparse(CFG.rss).query)
    passkey = CFG.filelist_passkey or (rss_params.get('passkey') or [''])[0]
    if not passkey:
        raise ServiceError('FileList API needs a passkey in the server configuration.', 503)
    key = (req['title'].casefold(), req['kind'], req['year'], req['season'])
    now = time.monotonic()
    with LOCK:
        cached = API_CACHE.get(key)
        if cached and now - cached[0] < 1800:
            return list(cached[1])
        API_CALLS[:] = [x for x in API_CALLS if now - x < 3600]
        if len(API_CALLS) >= 100:
            raise ServiceError('FileList API hourly search budget reached; retry later.', 429)
        API_CALLS.append(now)
    params = {
        'username': CFG.filelist_username,
        'passkey': passkey,
        'action': 'search-torrents',
        'type': 'name',
        'query': req['title'],
        'output': 'json'
    }
    category = (rss_params.get('cat') or [''])[0]
    if category and re.fullmatch(r'[0-9,]+', category):
        params['category'] = category
    url = 'https://filelist.io/api.php?' + urlencode(params)
    try:
        with urlopen(Request(url, headers={'User-Agent': 'CrimsonFin-Requests/1.2.6', 'Accept': 'application/json'}), timeout=14) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('API response too large')
        payload = json.loads(raw)
        if isinstance(payload, dict):
            if payload.get('error'):
                raise ValueError('API reported an error')
            rows = payload.get('torrents', payload.get('results', payload.get('data', [])))
        else:
            rows = payload
        if not isinstance(rows, list):
            raise ValueError('Unexpected API response format')
        found = []
        for item in rows[:150]:
            if not isinstance(item, dict):
                continue
            title = item.get('name') or item.get('title')
            link = item.get('download_link') or item.get('download_url')
            if not isinstance(title, str) or not isinstance(link, str):
                continue
            try:
                kind = validate_download_url(link)
            except ServiceError:
                continue
            entry_id = hashlib.sha256((title + '\n' + link).encode()).hexdigest()[:24]
            found.append({'entry_id': entry_id, 'title': title[:300], 'url': link, 'kind': kind})
    except Exception as exc:
        LOG.warning('FileList API search failed: %s', type(exc).__name__)
        raise ServiceError('FileList API search failed; verify username, passkey, and service access.', 502) from None
    with LOCK:
        API_CACHE[key] = (time.monotonic(), found)
        if len(API_CACHE) > 250:
            oldest = min(API_CACHE, key=lambda x: API_CACHE[x][0])
            API_CACHE.pop(oldest, None)
    return list(found)


def matching_entries(req):
    """Prefer searchable API results, supplement with recent RSS entries."""
    results = []
    seen = set()
    if CFG.filelist_api_enabled and CFG.filelist_username:
        try:
            for entry in filelist_api_entries(req):
                if entry['entry_id'] not in seen:
                    results.append(entry)
                    seen.add(entry['entry_id'])
        except ServiceError as exc:
            LOG.warning('API search unavailable; using RSS fallback (%s)', exc.status)
    try:
        for entry in rss_entries():
            if entry['entry_id'] not in seen:
                results.append(entry)
                seen.add(entry['entry_id'])
    except ServiceError:
        if not results:
            raise
    return results


def feed_matches(req):
    matches = []
    for entry in matching_entries(req):
        score = score_entry(req, entry)
        if score:
            matches.append({**entry, 'score': score})
    return sorted(matches, key=lambda x: (-x['score'], x['title']))[:30]

def disk_info():
    configured = []
    for entry in CFG.disks.split(';'):
        if not entry.strip(): continue
        label, sep, path = entry.partition('=')
        if sep and path.strip(): configured.append((label.strip()[:45], Path(path.strip())))
    if not configured: configured = [('Downloads', CFG.download_dir)]
    result = []
    for label, directory in configured[:8]:
        try:
            # Never report OS-root free space as an offline USB/external disk.
            if CFG.require_mountpoints and CFG.media_drives.strip():
                if not directory.is_dir() or not os.path.ismount(directory):
                    result.append({'name':label,'error':'Drive is not mounted'});continue
            usage=shutil.disk_usage(directory)
            result.append({'name':label, 'total':usage.total, 'free':usage.free, 'used':usage.used})
        except OSError:
            result.append({'name':label, 'error':'Drive is unavailable'})
    return result

def media_mounts():
    """Configured drive roots only; never choose the OS root if a drive went offline."""
    out=[]
    for section in CFG.media_drives.split(';'):
        label, sep, raw = section.partition('=')
        if not sep or not label.strip() or not raw.strip():continue
        root=Path(raw.strip()).expanduser()
        if not root.is_absolute():continue
        if not root.is_dir():continue
        if CFG.require_mountpoints and not os.path.ismount(root):continue
        out.append((label.strip()[:45],root.resolve()))
    return out

def destination_for(req, required=0):
    """Pick the mounted/writable drive with most free space; organize for Jellyfin."""
    if not CFG.media_drives.strip():
        # Backward-compatible path for a single test/demo download directory.
        return 'Downloads', CFG.download_dir
    limit=int(CFG.min_free_gb*1024**3)+max(0,required)
    candidates=[]
    for name, root in media_mounts():
        try:
            free=shutil.disk_usage(root).free
            if free>limit and os.access(root,os.W_OK):candidates.append((free,name,root))
        except OSError:continue
    if not candidates:
        raise ServiceError('No configured ADATA/WD drive is mounted, writable, and has enough free space.',409)
    _,name,root=max(candidates,key=lambda x:x[0])
    folder=CFG.movie_folder if req['kind']=='Movie' else CFG.shows_folder
    folder=safe_filename(folder)
    title=safe_filename(req['title'])
    year=req['year'] if 'year' in req.keys() else None
    if year:title+=f' ({year})'
    dest=root/folder/title
    if req['kind']=='Series' and req['season'] is not None:dest/=f"Season {int(req['season']):02d}"
    if not dest.resolve().is_relative_to(root):raise ServiceError('Invalid media path.',400)
    return name,dest

def enough_disk(bytes_needed=0, location=None):
    path=Path(location) if location else CFG.download_dir
    if CFG.media_drives.strip():
        # If a drive vanished after selection, do not fall back to the root disk.
        if not any(path.resolve().is_relative_to(root) for _,root in media_mounts()):
            return False
    # A new destination subfolder might not exist yet; check its nearest parent.
    while not path.exists():
        if path == path.parent:break
        path=path.parent
    free=shutil.disk_usage(path).free
    minimum=int(CFG.min_free_gb*1024**3)
    return free>minimum+max(0,bytes_needed)

# qBittorrent is optional. Never expose these credentials in desktop builds.
class Qbit:
    def __init__(self):
        if not CFG.qbit_url: raise ServiceError('qBittorrent not configured.', 503)
        p=urlparse(CFG.qbit_url)
        if p.scheme != 'http' or p.hostname not in ('127.0.0.1','localhost','::1'):
            raise ServiceError('QBITTORRENT_URL must point to localhost over HTTP.', 503)
        self.opener=build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        data=urlencode({'username':CFG.qbit_user,'password':CFG.qbit_password}).encode()
        res=self.fetch('/api/v2/auth/login', data)
        if res.strip() != 'Ok.': raise ServiceError('qBittorrent credentials rejected.', 502)
    def fetch(self, path, data=None):
        req=Request(CFG.qbit_url + path, data=data, headers={'User-Agent':'CrimsonFin-Requests/1.1', 'Referer':CFG.qbit_url+'/'})
        with self.opener.open(req,timeout=8) as response: return response.read(2_000_000).decode()
    def add(self, link, tag, savepath):
        """Submit torrent metainfo or magnet to qBittorrent and start downloading."""
        savepath=Path(savepath)
        if not enough_disk(location=savepath):
            raise ServiceError('Target drive is offline or does not have enough free space.',409)
        savepath.mkdir(parents=True,exist_ok=True)
        fields={'tags':tag,'savepath':str(savepath),'contentLayout':'NoSubfolder'}
        if link.startswith('magnet:?'):
            data=urlencode({**fields,'urls':link}).encode()
            result=self.fetch('/api/v2/torrents/add',data)
        else:
            # Fetch authenticated, PHP-style torrent link on the server rather than
            # asking qBittorrent to browse a private tracker without its RSS passkey.
            validate_download_url(link)
            opener=build_opener(CheckedRedirects())
            with opener.open(Request(link,headers={'User-Agent':'CrimsonFin-Requests/1.1'}),timeout=15) as response:
                torrent=response.read(4_000_001)
            if len(torrent)>4_000_000 or not torrent.startswith(b'd') or b'4:info' not in torrent:
                raise ServiceError('Tracker link did not return a valid .torrent file.')
            boundary='----CrimsonFin'+uuid.uuid4().hex
            parts=[]
            for name,value in fields.items():
                parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode())
            parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="requested.torrent"\r\nContent-Type: application/x-bittorrent\r\n\r\n').encode()+torrent+b'\r\n')
            parts.append((f'--{boundary}--\r\n').encode())
            body=b''.join(parts)
            req=Request(CFG.qbit_url+'/api/v2/torrents/add',data=body,headers={
                'User-Agent':'CrimsonFin-Requests/1.1','Referer':CFG.qbit_url+'/',
                'Content-Type':f'multipart/form-data; boundary={boundary}'})
            with self.opener.open(req,timeout=15) as response:result=response.read(2000).decode()
        if not result.startswith('Ok.'):
            raise ServiceError('qBittorrent did not accept the torrent.',502)
    def by_tag(self, tag):
        items=json.loads(self.fetch('/api/v2/torrents/info?' + urlencode({'tag':tag})))
        return items[0] if items else None
    def stop(self, torrent_hash):
        data=urlencode({'hashes':torrent_hash}).encode()
        try: self.fetch('/api/v2/torrents/stop', data)
        except Exception: self.fetch('/api/v2/torrents/pause', data)  # qBittorrent 4.x

def start_entry(req, entry):
    kind = validate_download_url(entry['url'])
    drive,target=destination_for(req)
    if not enough_disk(location=target):raise ServiceError('Not enough free space to start downloads.',409)
    change(req['id'], save_path=str(target), drive_name=drive, status='queued', download_url=entry['url'], entry_id=entry['entry_id'],
           download_ref='', download_name=entry['title'], download_kind=kind, bytes_done=0, bytes_total=0, error='')

def process_pending():
    with database() as con:
        targets=con.execute("SELECT * FROM requests WHERE status IN ('searching','waiting_feed') ORDER BY created_at LIMIT 25").fetchall()
    if not targets:
        return
    for req in targets:
        try:
            matches=feed_matches(req)
            if not matches:
                change(req['id'], status='waiting_feed', error='No matching release found in FileList API or recent RSS.')
            elif len(matches)==1 and matches[0]['score'] >= 90:
                start_entry(req, matches[0])
            else:
                change(req['id'], status='awaiting_selection', error='Select a release from the matching results.')
        except ServiceError as exc:
            change(req['id'], status='waiting_feed', error=str(exc))

def http_download(request_id):
    try:
        req=load_request(request_id)
        if req is None or req['status']!='queued':return
        url=req['download_url'];validate_download_url(url)
        name=safe_filename(req['download_name'] or req['title'])
        suffix=Path(urlparse(url).path).suffix.lower()
        target=Path(req['save_path'] or CFG.download_dir)
        target.mkdir(parents=True,exist_ok=True)
        out=target / f'{name}-{request_id[:8]}{suffix}'
        partial=target / f'{name}-{request_id[:8]}{suffix}.part'
        opener=build_opener(CheckedRedirects())
        with opener.open(Request(url, headers={'User-Agent':'CrimsonFin-Requests/1.1'}), timeout=40) as response:
            content_type=(response.headers.get('Content-Type') or '').lower()
            if content_type.startswith(('text/html','text/xml','application/json')):
                raise ServiceError('The RSS download URL returned a web page, not a media file.')
            size=int(response.headers.get('Content-Length') or '0')
            if size < 0: raise ServiceError('Invalid file length from the download server.')
            limit=int(CFG.max_download_gb*1024**3)
            if size > limit: raise ServiceError('RSS file exceeds MAX_DOWNLOAD_GB.')
            if not enough_disk(size,target): raise ServiceError('Insufficient free disk space.')
            change(request_id,status='downloading',bytes_total=size,download_name=out.name,error='')
            current=0;last=time.monotonic()
            with partial.open('wb') as file:
                while True:
                    chunk=response.read(512*1024)
                    if not chunk:break
                    current+=len(chunk)
                    if current>limit or not enough_disk(location=target): raise ServiceError('Download stopped: quota or free-space limit reached.')
                    if load_request(request_id)['status']=='cancelled': raise ServiceError('Cancelled by administrator.')
                    file.write(chunk)
                    if time.monotonic()-last > 0.6:
                        change(request_id,bytes_done=current,bytes_total=size)
                        last=time.monotonic()
        if size and current != size: raise ServiceError('Download ended before the full file arrived.')
        os.replace(partial,out)
        change(request_id,status='completed',bytes_done=current,bytes_total=current,download_name=out.name,error='')
    except Exception as exc:
        LOG.warning('Download %s failed: %s',request_id,type(exc).__name__)
        change(request_id,status='failed',error=str(exc)[:240])
        try: partial.unlink(missing_ok=True)
        except (UnboundLocalError,OSError):pass
    finally:
        with LOCK:DOWNLOAD_THREADS.discard(request_id)

def process_downloads():
    with database() as con:
        queued=con.execute("SELECT * FROM requests WHERE status='queued' ORDER BY created_at LIMIT 8").fetchall()
    for req in queued:
        if req['download_kind']=='torrent':
            try:
                tag='crimsonfin_'+req['id'][:12]
                change(req['id'],download_ref=tag, status='downloading')
                Qbit().add(req['download_url'],tag,req['save_path'] or CFG.download_dir)
            except Exception as exc:
                change(req['id'],status='failed',error=f'qBittorrent: {str(exc)[:180]}')
        elif req['download_kind']=='http':
            with LOCK:
                if req['id'] in DOWNLOAD_THREADS:continue
                DOWNLOAD_THREADS.add(req['id'])
            threading.Thread(target=http_download,args=(req['id'],),daemon=True).start()

def monitor_torrents():
    if not CFG.qbit_url:return
    with database() as con:
        jobs=con.execute("SELECT * FROM requests WHERE status='downloading' AND download_kind='torrent'").fetchall()
    if not jobs:return
    try:
        qbit=Qbit()
        for row in jobs:
            item=qbit.by_tag(row['download_ref'])
            if not item:continue
            total=int(item.get('total_size') or item.get('size') or 0)
            done=int(item.get('downloaded') or round(total*float(item.get('progress') or 0)))
            st=str(item.get('state') or '')
            # Stop oversized torrents before they can exhaust the media drive.
            remaining=max(0,total-done)
            if total>int(CFG.max_download_gb*1024**3) or not enough_disk(remaining,row['save_path'] or CFG.download_dir):
                try:qbit.stop(item.get('hash',''))
                except Exception:LOG.warning('Unable to pause oversized torrent')
                change(row['id'],status='failed',bytes_total=total,bytes_done=done,
                    error='Paused by CrimsonFin: torrent exceeds quota or disk space is too low.')
                continue
            if item.get('progress',0)>=1 and st not in ('checkingUP','checkingDL'):
                status='completed'
            elif st in ('error','missingFiles'):
                status='failed'
            else:status='downloading'
            change(row['id'],status=status,bytes_total=total,bytes_done=done,download_name=item.get('name','')[:240],error=st if status=='failed' else '')
    except Exception as exc:
        LOG.warning('qBittorrent progress unavailable: %s', type(exc).__name__)

def background_loop(stop):
    last_scan=0
    while not stop.wait(5):
        try:
            process_downloads()
            monitor_torrents()
            if time.monotonic()-last_scan>=CFG.scan_seconds:
                process_pending();last_scan=time.monotonic()
        except Exception:
            LOG.exception('Worker iteration failed')

def catalog_search(text, kind):
    if not CFG.tmdb_token:
        return []
    path='/3/search/movie' if kind=='Movie' else '/3/search/tv'
    url='https://api.themoviedb.org'+path+'?'+urlencode({'query':text,'include_adult':'false','page':1})
    req=Request(url, headers={'Authorization':'Bearer '+CFG.tmdb_token,'Accept':'application/json'})
    try:
        with urlopen(req,timeout=10) as response: data=json.load(response)
    except Exception:
        raise ServiceError('Movie catalog search is unavailable.', 502) from None
    out=[]
    for row in data.get('results',[])[:12]:
        name=row.get('title') or row.get('name')
        date=row.get('release_date') or row.get('first_air_date') or ''
        year=int(date[:4]) if re.fullmatch(r'\d{4}',date[:4]) else None
        if name:out.append({'id':row.get('id'),'title':name,'year':year,'kind':kind,'overview':(row.get('overview') or '')[:260]})
    return out

class Handler(BaseHTTPRequestHandler):
    server_version='CrimsonFinRequests/1.1.1'
    def log_message(self, pattern, *args):
        LOG.info('%s %s', self.client_address[0], pattern%args)
    def send_json(self, code, obj):
        data=json.dumps(obj,ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers();self.wfile.write(data)
    def body(self):
        try: length=int(self.headers.get('Content-Length','0'))
        except ValueError:length=0
        if length<=0 or length>16_384:raise ServiceError('Invalid JSON payload size.', 413)
        try:return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError,UnicodeDecodeError):raise ServiceError('Invalid JSON payload.') from None
    def session(self):
        token=self.headers.get('X-Emby-Token', '').strip()
        if not token:
            # The desktop also supports a Jellyfin Authorization header.
            m=re.search(r'Token="([A-Za-z0-9._~\-]+)"',self.headers.get('Authorization',''))
            token=m.group(1) if m else ''
        return validate_jellyfin_token(token)
    def do_GET(self):
        self.dispatch('GET')
    def do_POST(self):
        self.dispatch('POST')
    def dispatch(self, method):
        try:
            path=urlparse(self.path).path.rstrip('/') or '/'
            if method=='GET' and path=='/health':return self.send_json(200, {'ok':True,'version':'1.1.1'})
            if not path.startswith('/api/') and path!='/api':raise ServiceError('Not found',404)
            user=self.session()
            if method=='GET' and path=='/api/status':
                with database() as con:
                    counts={r['status']:r['c'] for r in con.execute('SELECT status,COUNT(*) c FROM requests GROUP BY status')}
                return self.send_json(200, {'drives':disk_info(),'counts':counts,'auto_approve':CFG.automatic,'catalog_enabled':bool(CFG.tmdb_token), 'feed_configured':bool(CFG.rss), 'admin':is_admin(user)})
            if method=='GET' and path=='/api/requests':
                with database() as con:
                    rows=con.execute('SELECT * FROM requests ORDER BY created_at DESC LIMIT 150').fetchall()
                return self.send_json(200, {'items':[row_to_dict(r) for r in rows]})
            if method=='GET' and path=='/api/catalog':
                q=parse_qs(urlparse(self.path).query)
                title=(q.get('q') or [''])[0].strip()[:120]
                kind=(q.get('kind') or ['Movie'])[0]
                if len(title)<2 or kind not in ('Movie','Series'):raise ServiceError('Enter a title of at least 2 characters.')
                return self.send_json(200, {'items':catalog_search(title,kind)})
            if method=='POST' and path=='/api/requests':
                body=self.body()
                title=str(body.get('title','')).strip()
                kind=body.get('kind')
                try: year=int(body['year']) if body.get('year') else None
                except (TypeError,ValueError):raise ServiceError('Invalid release year.') from None
                try: season=int(body['season']) if body.get('season') else None
                except (TypeError,ValueError):raise ServiceError('Invalid season.') from None
                if not 2<=len(title)<=140 or not re.search(r'\w',title):raise ServiceError('Enter a title between 2 and 140 characters.')
                if kind not in ('Movie','Series'):raise ServiceError('Select movie or TV series.')
                if year is not None and not 1880<=year<=2100:raise ServiceError('Year is out of range.')
                if season is not None and (kind!='Series' or not 1<=season<=100):raise ServiceError('Season is out of range.')
                with database() as con:
                    existing=con.execute('''SELECT id FROM requests WHERE requester_id=? AND lower(title)=lower(?)
                       AND kind=? AND coalesce(year,0)=? AND coalesce(season,0)=? AND status NOT IN ('failed','cancelled')''',
                         (user['Id'],title,kind,year or 0,season or 0)).fetchone()
                    if existing:raise ServiceError('You have already requested this title.',409)
                    count=con.execute("SELECT COUNT(*) FROM requests WHERE requester_id=? AND status IN ('pending_approval','searching','waiting_feed','awaiting_selection','queued','downloading')",(user['Id'],)).fetchone()[0]
                    if count>=CFG.max_per_user:raise ServiceError('You have reached the open-request limit.',429)
                    ident=str(uuid.uuid4());now=utc()
                    status='searching' if CFG.automatic else 'pending_approval'
                    con.execute('''INSERT INTO requests (id,title,kind,year,season,tmdb_id,requester_id,requester_name,status,created_at,updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)''', (ident,title,kind,year,season,body.get('tmdb_id') if isinstance(body.get('tmdb_id'),int) else None,user['Id'],user['Name'],status,now,now))
                return self.send_json(201,{'id':ident,'status':status})
            m=re.fullmatch(r'/api/requests/([a-f0-9-]{36})(?:/(approve|cancel|matches|start|retry))?',path)
            if m:
                ident,action=m.groups();row=load_request(ident)
                if row is None:raise ServiceError('Request not found.',404)
                if action=='matches' and method=='GET':
                    if not is_admin(user):raise ServiceError('Only administrators can select releases.',403)
                    matches=feed_matches(row)
                    return self.send_json(200,{'items':[{'entry_id':r['entry_id'],'title':r['title'],'kind':r['kind'],'score':r['score']} for r in matches]})
                if method=='POST' and action in ('approve','retry','cancel','start'):
                    if not is_admin(user) and not (action=='cancel' and row['requester_id']==user['Id']):
                        raise ServiceError('Administrator approval required.',403)
                    if action=='approve' and row['status']=='pending_approval':
                        change(ident,status='searching',error='');return self.send_json(200,{'ok':True})
                    if action=='retry' and row['status'] in ('failed','waiting_feed','awaiting_selection'):
                        change(ident,status='searching',error='');return self.send_json(200,{'ok':True})
                    if action=='cancel' and row['status'] in ('pending_approval','searching','waiting_feed','awaiting_selection','queued'):
                        change(ident,status='cancelled');return self.send_json(200,{'ok':True})
                    if action=='start' and row['status'] in ('awaiting_selection','waiting_feed','searching','pending_approval','failed'):
                        if not is_admin(user):raise ServiceError('Administrator approval required.',403)
                        entry_id=str(self.body().get('entry_id',''))
                        entry=next((e for e in matching_entries(row) if e['entry_id']==entry_id),None)
                        if not entry or score_entry(row,entry)==0:raise ServiceError('The selected release is no longer available for this title.',409)
                        start_entry(row,entry);return self.send_json(200,{'ok':True})
                    raise ServiceError('This request cannot be changed in its current state.',409)
            raise ServiceError('Not found',404)
        except ServiceError as exc:
            self.send_json(exc.status,{'error':str(exc)})
        except Exception:
            LOG.exception('Request handler error')
            self.send_json(500,{'error':'Internal service error.'})

def main():
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    if not CFG.rss:LOG.warning('No RSS_FEED_URL configured: requests can be saved but not matched.')
    if not CFG.allowed_hosts:LOG.warning('RSS_ALLOWED_HOSTS empty: no HTTP RSS enclosures can be downloaded.')
    setup_database()
    stop=threading.Event()
    thread=threading.Thread(target=background_loop,args=(stop,),daemon=True);thread.start()
    server=ThreadingHTTPServer((CFG.host,CFG.port),Handler)
    LOG.info('CrimsonFin requests listening on %s:%s',CFG.host,CFG.port)
    try:server.serve_forever(poll_interval=.5)
    except KeyboardInterrupt:pass
    finally:stop.set();server.server_close()

if __name__=='__main__':main()
