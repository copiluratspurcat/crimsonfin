import { buildFilelistApiUrl, parseFilelistApiResults, privateDownloadUrl } from './filelist-api.mjs';
import { validateFilelistRssUrl, parseFilelistRss } from './filelist-rss.mjs';
import { parseTorrentSizeBytes } from './download-manager.mjs';

export function createFilelistService({ env, db, crypto, downloadManager, fetchImpl = fetch }) {
  const searchCache = new Map();
  const downloadLinks = new Map();
  const quota = new Map();

  const getSetting = key => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
  const putSetting = (key, value) => db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, value);

  function rssPasskey() {
    try { return env.FILELIST_RSS_URL ? validateFilelistRssUrl(env.FILELIST_RSS_URL).searchParams.get('passkey') || '' : ''; }
    catch { return ''; }
  }
  function getCredentials() {
    let stored = '';
    try {
      const encrypted = getSetting('filelist_passkey');
      if (encrypted) stored = crypto.decrypt(encrypted);
    } catch {}
    return {
      username: getSetting('filelist_username') || env.FILELIST_USERNAME || '',
      passkey: stored || env.FILELIST_PASSKEY || rssPasskey()
    };
  }
  function status() {
    const cred = getCredentials();
    return {
      apiConfigured: Boolean(cred.username && cred.passkey),
      rssConfigured: Boolean(env.FILELIST_RSS_URL),
      username: cred.username,
      rssPasskeyAvailable: Boolean(rssPasskey()),
      downloaderConfigured: Boolean(env.QBIT_URL && env.QBIT_USERNAME && env.QBIT_PASSWORD)
    };
  }
  function configure({ username, passkey }) {
    if (typeof username !== 'string' || username.length > 100 ||
        (passkey !== undefined && (typeof passkey !== 'string' || passkey.length > 256))) {
      throw Object.assign(new Error('Invalid tracker credentials'), { status: 400 });
    }
    putSetting('filelist_username', username.trim());
    if (passkey?.trim()) putSetting('filelist_passkey', crypto.encrypt(passkey.trim()));
    searchCache.clear();
    downloadLinks.clear();
    return status();
  }
  function useQuota(userId) {
    const now = Date.now();
    const u = (quota.get(userId) || []).filter(t => t + 3600000 > now);
    const g = (quota.get('__global__') || []).filter(t => t + 3600000 > now);
    if (u.length >= 30 || g.length >= 120) throw Object.assign(new Error('FileList search limit reached'), { status: 429 });
    quota.set(userId, [...u, now]);
    quota.set('__global__', [...g, now]);
  }
  async function search(query, userId, category = '') {
    const { username, passkey } = getCredentials();
    const api = Boolean(username && passkey);
    if (!api && !env.FILELIST_RSS_URL) return { configured: false, source: 'none', results: [] };
    const key = (api ? 'api:' : 'rss:') + query.toLowerCase() + ':' + category;
    const cached = searchCache.get(key);
    if (cached && cached.until > Date.now()) {
      // Authenticated admins still need link ownership for the subsequent torrent download.
      if (cached.links) for (const [id, link] of cached.links) {
        downloadLinks.set(userId + ':' + id, { link, until: cached.until, sizeBytes: parseTorrentSizeBytes(cached.value.results.find(x => x.id === id)?.size) });
      }
      return cached.value;
    }
    useQuota(userId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      if (!api) {
        const response = await fetchImpl(validateFilelistRssUrl(env.FILELIST_RSS_URL), {
          signal: controller.signal, redirect: 'error', headers: { accept: 'application/rss+xml, application/xml, text/xml' }
        });
        if (!response.ok) throw Object.assign(new Error('FileList RSS unavailable'), { status: 502 });
        const value = parseFilelistRss(await response.text(), query);
        searchCache.set(key, { until: Date.now() + 300000, value });
        return value;
      }
      const requestUrl = buildFilelistApiUrl(query, category);
      const authorization = 'Basic ' + Buffer.from(username + ':' + passkey).toString('base64');
      const response = await fetchImpl(requestUrl, {
        signal: controller.signal, redirect: 'error',
        headers: { accept: 'application/json', authorization }
      });
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error('FileList API credentials were rejected'), { status: 502 });
      }
      if (response.status === 429) throw Object.assign(new Error('FileList API rate limit reached'), { status: 429 });
      if (!response.ok) throw Object.assign(new Error('FileList API unavailable'), { status: 502 });
      const data = await response.json();
      const parsed = parseFilelistApiResults(data);
      const until = Date.now() + 300000;
      const value = { configured: true, source: 'api', results: parsed.results };
      searchCache.set(key, { value, until, links: parsed.links });
      for (const [id, link] of parsed.links) downloadLinks.set(userId + ':' + id, { link, until, sizeBytes: parseTorrentSizeBytes(parsed.results.find(x => x.id === id)?.size) });
      if (downloadLinks.size > 500) {
        for (const [id, val] of downloadLinks) if (val.until < Date.now()) downloadLinks.delete(id);
      }
      return value;
    } finally { clearTimeout(timeout); }
  }
  async function torrentFor(userId, torrentId) {
    if (!/^\d{1,12}$/.test(String(torrentId))) throw Object.assign(new Error('Invalid torrent ID'), { status: 400 });
    const found = downloadLinks.get(userId + ':' + torrentId);
    if (!found || found.until < Date.now()) {
      throw Object.assign(new Error('Search for this release again first'), { status: 404 });
    }
    const url = privateDownloadUrl(found.link);
    if (!url) throw Object.assign(new Error('Invalid private tracker download URL'), { status: 502 });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error',
        headers: { accept: 'application/x-bittorrent,*/*' } });
      if (!response.ok) throw Object.assign(new Error('Torrent download failed'), { status: 502 });
      if (Number(response.headers.get('content-length')) > 5_000_000) throw Object.assign(new Error('Torrent file too large'), { status: 502 });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > 5_000_000 || buffer[0] !== 0x64) {
        throw Object.assign(new Error('Tracker did not return a valid torrent file'), { status: 502 });
      }
      return buffer;
    } finally { clearTimeout(timeout); }
  }
  async function queueTorrent(userId, torrentId, kind = 'movie') {
    if (!downloadManager) throw Object.assign(new Error('qBittorrent download manager unavailable'), { status: 503 });
    if (!['movie', 'series'].includes(kind)) {
      throw Object.assign(new Error('Choose Movie or TV Show'), { status: 400 });
    }
    // Validate and obtain the tracker torrent before writing anything.
    const torrent = await torrentFor(userId, torrentId);
    const metadata = downloadLinks.get(userId + ':' + torrentId);
    return downloadManager.queueTorrentFile(torrent, kind, metadata?.sizeBytes || 0);
  }
  return { status, configure, search, torrentFor, queueTorrent };
}
