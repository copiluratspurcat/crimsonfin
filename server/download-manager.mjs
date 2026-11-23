import { accessSync, constants, realpathSync, statSync, statfsSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { classifyTorrent, safeSeriesDestination } from './media-layout.mjs';

const GiB = 1024 ** 3;
const SAFE_MARGIN = 2 * GiB;
const DEFAULT_FOLDERS = {
  movie: ['/mnt/ADATA/Movies', '/mnt/WD1TBLU/movies'],
  series: ['/mnt/ADATA/Shows', '/mnt/ADATA/TV Shows', '/mnt/WD1TBLU/shows']
};
const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
const num = x => Number.isFinite(Number(x)) ? Math.max(0, Number(x)) : 0;
const clamp = (x, max) => Math.min(max, num(x));

export function parseTorrentSizeBytes(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return 0;
  const s = value.trim().replace(/,/g, '');
  if (/^\d{1,15}$/.test(s)) return Number(s);
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/i);
  if (!match) return 0;
  const units = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
    kib: 1024, mib: 1024 ** 2, gib: GiB, tib: 1024 ** 4 };
  return Math.round(Number(match[1]) * units[match[2].toLowerCase()]);
}

function configuredDirs(value, kind) {
  if (value === undefined || value === '') return DEFAULT_FOLDERS[kind];
  return value.split(',').map(x => x.trim()).filter(Boolean);
}
function folderRoot(folder) {
  const parts = path.resolve(folder).split(path.sep).filter(Boolean);
  // Download locations are explicitly limited to configured media drives,
  // never arbitrary web-requested paths or the server's home drive.
  if (parts[0] !== 'mnt' || parts.length < 3) return null;
  return path.join('/', parts[0], parts[1]);
}
function allowedChild(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}
function validateFolder(folder) {
  try {
    const real = realpathSync(folder);
    const drive = folderRoot(real);
    if (!drive || !allowedChild(realpathSync(drive), real) || !statSync(real).isDirectory()) return null;
    accessSync(real, constants.W_OK);
    const stat = statfsSync(real, { bigint: true });
    return {
      folder: real, mount: realpathSync(drive),
      freeBytes: Number(stat.bavail * stat.bsize),
      totalBytes: Number(stat.blocks * stat.bsize)
    };
  } catch { return null; }
}

export function getStorageReport(env) {
  const byMount = new Map();
  for (const [kind, key] of [['movie', 'MEDIA_MOVIE_DIRS'], ['series', 'MEDIA_SERIES_DIRS']]) {
    for (const folder of configuredDirs(env[key], kind)) {
      const stats = validateFolder(folder);
      if (!stats) continue;
      let device = byMount.get(stats.mount);
      if (!device) {
        device = {
          id: path.basename(stats.mount), name: path.basename(stats.mount),
          totalBytes: stats.totalBytes, freeBytes: stats.freeBytes,
          movieFolder: null, seriesFolder: null
        };
        byMount.set(stats.mount, device);
      }
      if (!device[kind + 'Folder']) device[kind + 'Folder'] = stats.folder;
    }
  }
  // Show the system drive too, but never download there: it isn't a Jellyfin library.
  try {
    const stat = statfsSync('/', { bigint: true });
    byMount.set('/', { id: 'SYSTEM', name: 'System SSD',
      totalBytes: Number(stat.blocks * stat.bsize),
      freeBytes: Number(stat.bavail * stat.bsize),
      movieFolder: null, seriesFolder: null });
  } catch {}
  return [...byMount.values()].sort((a, b) => b.freeBytes - a.freeBytes);
}

export function chooseStorage(drives, kind, requiredBytes = 0, reserved = {}) {
  if (!['movie', 'series'].includes(kind)) throw invalid('Choose Movie or TV Show for this download');
  const size = clamp(requiredBytes, 10 ** 15);
  const candidates = drives.filter(d => !!d[kind + 'Folder'])
    .map(d => ({ ...d, usableBytes: Math.max(0, d.freeBytes - num(reserved[d.id]) - SAFE_MARGIN) }))
    .sort((a, b) => b.usableBytes - a.usableBytes);
  const best = candidates.find(d => d.usableBytes >= size);
  if (!best) throw invalid('Not enough available space in your Jellyfin library drives', 507);
  return { drive: best.name, savePath: best[kind + 'Folder'], availableBytes: best.usableBytes };
}

export function createDownloadManager({
  env, fetchImpl = fetch, storageProvider = getStorageReport,
  ensureSeriesFolder = target => {
    if (existsSync(target)) {
      if (realpathSync(target) !== target || !statSync(target).isDirectory()) {
        throw invalid('Unsafe existing TV series directory', 400);
      }
    } else mkdirSync(target, { recursive: true, mode: 0o775 });
  }
}) {
  const url = new URL(env.QBIT_URL || 'http://127.0.0.1:8877');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash) {
    throw invalid('qBittorrent must be hosted on loopback only', 503);
  }
  let sessionCookie = '';
  let sessionUntil = 0;
  async function login() {
    if (sessionCookie && sessionUntil > Date.now()) return sessionCookie;
    if (!env.QBIT_USERNAME || !env.QBIT_PASSWORD) throw invalid('qBittorrent is not configured', 503);
    const res = await fetchImpl(new URL('/api/v2/auth/login', url), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/x-www-form-urlencoded',
        'referer': url.origin + '/', 'origin': url.origin },
      body: new URLSearchParams({ username: env.QBIT_USERNAME, password: env.QBIT_PASSWORD })
    });
    const response = await res.text();
    const token = res.headers.get('set-cookie')?.split(';')[0] || '';
    if (!res.ok || response.trim() !== 'Ok.' || !/^SID=[^;]+$/.test(token)) {
      throw invalid('qBittorrent authentication failed', 502);
    }
    sessionCookie = token;
    sessionUntil = Date.now() + 10 * 60 * 1000;
    return sessionCookie;
  }
  async function api(endpoint, options = {}, retry = true) {
    const cookie = await login();
    const response = await fetchImpl(new URL(endpoint, url), {
      redirect: 'error', signal: AbortSignal.timeout(12000), ...options,
      headers: { referer: url.origin + '/', origin: url.origin, cookie, ...(options.headers || {}) }
    });
    if ((response.status === 401 || response.status === 403) && retry) {
      sessionCookie = ''; sessionUntil = 0;
      return api(endpoint, options, false);
    }
    if (!response.ok) throw invalid('qBittorrent request failed', 502);
    return response;
  }
  async function listRaw() {
    const res = await api('/api/v2/torrents/info?filter=all');
    const data = await res.json();
    if (!Array.isArray(data)) throw invalid('Invalid qBittorrent status response', 502);
    return data.slice(0, 500);
  }
  function driveForSavePath(p, drives) {
    if (typeof p !== 'string') return null;
    const resolved = path.resolve(p);
    return drives.find(d =>
      [d.movieFolder, d.seriesFolder].filter(Boolean).some(folder => allowedChild(folder, resolved))) || null;
  }
  async function downloads() {
    const drives = storageProvider(env);
    const raw = await listRaw();
    return raw.map(t => {
      const drive = driveForSavePath(t.save_path, drives);
      if (!drive) return null;
      return {
        hash: /^[0-9a-f]{40,64}$/i.test(String(t.hash)) ? t.hash : '',
        name: String(t.name || 'Download').slice(0, 230),
        state: String(t.state || 'unknown').slice(0, 40),
        progress: clamp(Math.round(num(t.progress) * 10000) / 100, 100),
        sizeBytes: clamp(t.size || t.total_size || 0, 10 ** 15),
        downloadedBytes: clamp(t.downloaded || 0, 10 ** 15),
        remainingBytes: clamp(t.amount_left || 0, 10 ** 15),
        downloadSpeedBytes: clamp(t.dlspeed || 0, 10 ** 12),
        uploadSpeedBytes: clamp(t.upspeed || 0, 10 ** 12),
        etaSeconds: num(t.eta) < 8640000 ? num(t.eta) : null,
        drive: drive.name,
        folder: t.save_path,
        seeding: /upload|seed/i.test(String(t.state || ''))
      };
    }).filter(Boolean).sort((a, b) => Number(a.progress === 100) - Number(b.progress === 100));
  }
  async function status() {
    const drives = storageProvider(env);
    try {
      const items = await downloads();
      return { online: true, drives, downloads: items, active: items.filter(x => x.progress < 100).length };
    } catch (err) {
      return { online: false, drives, downloads: [], active: 0,
        error: err.status === 503 ? 'qBittorrent is not configured' : 'qBittorrent is currently unavailable' };
    }
  }
  async function queueTorrentFile(torrent, kind, sizeBytes = 0, releaseName = '') {
    if (!Buffer.isBuffer(torrent) || torrent.length < 10 || torrent.length > 5_000_000 || torrent[0] !== 0x64) {
      throw invalid('Invalid torrent metadata', 400);
    }
    const classification = classifyTorrent(torrent, releaseName, kind);
    const listed=String(releaseName).match(/(?:^|[._\s-])S(\d{1,2})(?=[._\s-]|$)/i);
    if (listed && classification.seasonNumber != null && Number(listed[1]) !== classification.seasonNumber) {
      throw invalid('Tracker advertises Season '+Number(listed[1])+' but the torrent files contain Season '+classification.seasonNumber,409);
    }
    const drives = storageProvider(env);
    const raw = await listRaw();
    const reserved = Object.create(null);
    for (const t of raw) {
      const d = driveForSavePath(t.save_path, drives);
      if (d) reserved[d.id] = (reserved[d.id] || 0) + clamp(t.amount_left || 0, 10 ** 15);
    }
    const selected = chooseStorage(drives, classification.kind, sizeBytes, reserved);
    let savePath = selected.savePath;
    if (classification.kind === 'series') {
      if (classification.multipleSeasons || !Number.isInteger(classification.seasonNumber)) {
        throw invalid('This release contains multiple seasons. Queue individual seasons so Jellyfin can organize them correctly.', 400);
      }
      const showFolder = safeSeriesDestination(selected.savePath, classification.title);
      // Jellyfin explicitly requires Season 01/Season 02 under each series.
      savePath = path.join(showFolder, 'Season ' + String(classification.seasonNumber).padStart(2, '0'));
      ensureSeriesFolder(showFolder);
      ensureSeriesFolder(savePath);
    }
    const body = new FormData();
    body.append('torrents', new Blob([torrent], { type: 'application/x-bittorrent' }), 'release.torrent');
    body.append('savepath', savePath);
    // A TV pack's torrent root is a release folder; remove that extra layer
    // and place all episode files directly under Shows/Series Title.
    if (classification.kind === 'series') body.append('contentLayout', 'NoSubfolder');
    body.append('autoTMM', 'false');
    body.append('stopped', 'false');
    const response = await api('/api/v2/torrents/add', { method: 'POST', body });
    if ((await response.text()).trim() !== 'Ok.') throw invalid('qBittorrent rejected the torrent', 502);
    return { ok: true, queued: true, kind: classification.kind,
      classifiedAsShow: classification.detectedSeries,
      drive: selected.drive, folder: savePath, availableBytes: selected.availableBytes };
  }
  return { status, downloads, queueTorrentFile, listRaw };
}
