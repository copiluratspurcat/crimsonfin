import { createTitleTranslations } from './title-translations.mjs';
import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync, mkdirSync, createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { validateFilelistRssUrl, parseFilelistRss } from './filelist-rss.mjs';
import { createLanDiscovery } from './local-discovery.mjs';
import { createFilelistService } from './filelist-service.mjs';
import { createDownloadManager } from './download-manager.mjs';
import { initRequestJobs, createRequestFulfillment } from './request-fulfillment.mjs';

import { createSubtitleSync } from './subtitle-sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_JSON = 16 * 1024;
const MEDIA_ID = /^[a-f\d-]{32,36}$/i;
const SESSION_MS = 14 * 864e5;
const REMEMBER_MS = 30 * 864e5;

export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const parsed = line.match(/^\s*([A-Z_][A-Z_\d]*)\s*=\s*(.*)\s*$/);
    if (parsed && !Object.hasOwn(process.env, parsed[1])) process.env[parsed[1]] = parsed[2].replace(/^['"]|['"]$/g, '');
  }
}
function json(res, code, object, extra = {}) {
  const output = Buffer.from(JSON.stringify(object));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': output.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(output);
}
function failure(message, status = 400) { const err = new Error(message); err.status = status; throw err; }
async function bodyJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) failure('JSON body required', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON) failure('Request body is too large', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { failure('Malformed JSON'); }
}
function secureString(value) { return typeof value === 'string' && value.length < 1024; }
function safeId(value) { if (!MEDIA_ID.test(value || '')) failure('Invalid item ID'); return value; }
function baseUrl(raw) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('Invalid upstream Jellyfin URL');
  return u.href.replace(/\/$/, '');
}
function hideSecrets(err) { return err?.status ? err.message : 'The server could not complete this request'; }
function getPath(urlString) { return new URL(urlString, 'http://gateway.internal'); }
function makeCookie(id, secure, remember) {
  return `cf_session=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}${remember ? `; Max-Age=${REMEMBER_MS / 1000}` : ''}`;
}
function deleteCookie(secure) { return `cf_session=; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0`; }
export function allowedLocalHttpsOrigin(req, origin, port = 9443) {
  if (!req.socket?.encrypted || !origin || !req.headers.host) return false;
  try {
    const incoming = new URL(origin);
    const expected = new URL('https://' + req.headers.host);
    if (incoming.origin !== expected.origin || incoming.port !== String(port)) return false;
    const hostname = incoming.hostname.toLowerCase();
    const isPrivate = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname)
      || hostname.endsWith('.local');
    const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const privatePeer = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.)/.test(peer);
    return isPrivate && privatePeer;
  } catch { return false; }
}
function parseCookie(header, name) {
  return String(header || '').split(';').map(v => v.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
function initDb(db) {
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
      is_admin INTEGER NOT NULL, device_id TEXT NOT NULL, token_enc TEXT NOT NULL,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
      title TEXT NOT NULL, kind TEXT NOT NULL, year INTEGER, notes TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS request_user_date ON requests (user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS last_played_episode (
      user_id TEXT NOT NULL, series_id TEXT NOT NULL, item_id TEXT NOT NULL,
      playback_id TEXT NOT NULL, played_at INTEGER NOT NULL, position_ticks INTEGER NOT NULL,
      PRIMARY KEY (user_id, series_id)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
}
function makeCrypto(key) {
  return {
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
    },
    decrypt(value) {
      const b = Buffer.from(value, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      decipher.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
}
const hash = value => createHash('sha256').update(value).digest('hex');
function authHeader(deviceId, token = '') {
  // Jellyfin 12+ requires a current MediaBrowser Authorization header, not legacy api_key URL parameters.
  return `MediaBrowser Client="CrimsonFin", Device="CrimsonFin Gateway", DeviceId="${deviceId}", Version="0.1.0"${token ? `, Token="${token}"` : ''}`;
}

const allowedMediaPath = pathname => {
  const p = decodeURIComponent(pathname);
  if (p.includes('..') || p.includes('\\') || p.includes('\0')) return false;
  return /^\/Items\/[a-f\d-]{32,36}\/Images\/(Primary|Backdrop|Thumb|Logo|Banner)(\/\d+)?$/i.test(p)
    || /^\/Videos\/[a-f\d-]{32,36}\/(master|main)\.m3u8$/i.test(p)
    || /^\/Videos\/[a-f\d-]{32,36}\/stream(\.(mp4|mkv|webm|ts))?$/i.test(p)
    || /^\/Videos\/[a-f\d-]{32,36}\/(hls\d*|hls)\/[a-z\d_.\/-]+$/i.test(p)
    || /^\/Videos\/[a-f\d-]{32,36}\/Subtitles\/[\w.\/-]+$/i.test(p)
    || /^\/Videos\/[a-f\d-]{32,36}\/[a-f\d-]{32,36}\/Subtitles\/\d{1,3}\/(?:0\/)?Stream\.vtt$/i.test(p)
    || /^\/Audio\/[a-f\d-]{32,36}\/[\w.\/-]+$/i.test(p);
};
function removeTokenQuery(uri) {
  const u = new URL(uri);
  for (const key of [...u.searchParams.keys()]) {
    if (/^(api_key|apikey|access_token|token)$/i.test(key)) u.searchParams.delete(key);
  }
  return u;
}
export function rewriteM3u8(playlist, sourceUrl, upstreamBase) {
  const upstreamOrigin = new URL(upstreamBase).origin;
  function proxied(raw) {
    const resolved = removeTokenQuery(new URL(raw, sourceUrl).href);
    if (resolved.origin !== upstreamOrigin || !allowedMediaPath(resolved.pathname)) {
      throw new Error('Playlist contains a disallowed upstream resource');
    }
    return '/jellyfin' + resolved.pathname + resolved.search;
  }
  return playlist.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_all, uri) => `URI="${proxied(uri)}"`);
    return proxied(line.trim());
  }).join('\n');
}

export function createAppServer(options = {}) {
  const env = { ...process.env, ...options.env };
  const jellyfinBase = baseUrl(env.JELLYFIN_URL || 'http://127.0.0.1:8096');
  const secure = env.NODE_ENV === 'production';
  if (secure && !env.PUBLIC_ORIGIN) throw new Error('Set PUBLIC_ORIGIN before running in production');
  const publicOrigin = env.PUBLIC_ORIGIN ? new URL(env.PUBLIC_ORIGIN).origin : '';
  const localOrigin = env.LOCAL_ORIGIN ? new URL(env.LOCAL_ORIGIN).origin : '';
  const secret = env.SESSION_ENCRYPTION_KEY ? Buffer.from(env.SESSION_ENCRYPTION_KEY, 'base64') : randomBytes(32);
  if (secret.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes');
  if (secure && !env.SESSION_ENCRYPTION_KEY) throw new Error('Set SESSION_ENCRYPTION_KEY in production');
  const crypt = makeCrypto(secret);
  const dbPath = options.dbPath || path.resolve(ROOT, env.DATA_DIR || './data', 'crimsonfin.sqlite');
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  initDb(db);
  initRequestJobs(db);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  const limiter = new Map();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const titleToken = env.TMDB_READ_ACCESS_TOKEN?.trim();
  const titleTranslations = createTitleTranslations(titleToken, fetchImpl);
  const downloadManager = createDownloadManager({ env, fetchImpl });
  const filelist = createFilelistService({ env, db, crypto: crypt, downloadManager, fetchImpl });
  const requestsFlow = createRequestFulfillment({ db, filelist, downloadManager });
  const subtitleSync = createSubtitleSync(env);
  let lastDownloadSync = 0;

  async function jellyfin(relative, session, init = {}) {
    const headers = { accept: 'application/json', authorization: authHeader(session.deviceId, session.token), ...init.headers };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetchImpl(jellyfinBase + relative, { ...init, headers, signal: controller.signal, redirect: 'manual' });
      if (response.status === 401) {
        db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(session.sessionHash);
        failure('Your Jellyfin session expired. Sign in again.', 401);
      }
      if (response.status === 403) failure('Jellyfin denied access to this resource', 403);
      if (response.status === 404) failure('This item is no longer in your Jellyfin library', 404);
      if (!response.ok) failure('Jellyfin is temporarily unavailable', 502);
      if (response.status === 204 || response.headers.get('content-length') === '0') return { ok: true };
      const raw = await response.text();
      return raw ? JSON.parse(raw) : { ok: true };
    } finally { clearTimeout(timeout); }
  }
  /** Try each Jellyfin path in turn. A refused, missing or failing route moves on; an expired session does not. */
  async function jellyfinEither(paths, session, init) {
    let lastError;
    for (const relative of paths) {
      try { return await jellyfin(relative, session, init); }
      catch (error) { if (![403, 404, 502].includes(error?.status)) throw error; lastError = error; }
    }
    throw lastError;
  }
  async function requireSession(req) {
    const raw = decodeURIComponent(parseCookie(req.headers.cookie, 'cf_session'));
    if (!raw || raw.length > 128) failure('Please sign in', 401);
    const session = db.prepare('SELECT * FROM sessions WHERE id_hash = ? AND expires_at > ?').get(hash(raw), Date.now());
    if (!session) failure('Session expired. Please sign in again', 401);
    let token;
    try { token = crypt.decrypt(session.token_enc); }
    catch {
      db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(session.id_hash);
      failure('Session expired. Please sign in again', 401);
    }
    return { userId: session.user_id, userName: session.user_name, isAdmin: Boolean(session.is_admin),
      deviceId: session.device_id, token, sessionHash: session.id_hash };
  }
  function requireAdmin(session) { if (!session.isAdmin) failure('Administrator access required', 403); }
  function verifyMutation(req) {
    const origin = req.headers.origin;
    if (origin) {
      const current = secure ? publicOrigin : new URL(`http://${req.headers.host || '127.0.0.1:8099'}`).origin;
      const devOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
      if (origin !== current && origin !== localOrigin && !allowedLocalHttpsOrigin(req, origin, Number(env.LOCAL_TLS_PORT || 9443)) && !( !secure && devOrigins.includes(origin))) failure('Origin not allowed', 403);
    }
    if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') failure('Cross-site requests are denied', 403);
  }
  async function streamJellyfin(req, res, session, pathname, query) {
    if (!['GET', 'HEAD'].includes(req.method)) failure('Method not allowed', 405);
    if (!allowedMediaPath(pathname)) failure('Requested stream path is not allowed', 403);
    const uri = new URL(jellyfinBase + pathname + query);
    // No user-supplied upstream auth identifiers are passed through.
    ['ApiKey', 'api_key', 'AccessToken', 'token'].forEach(x => uri.searchParams.delete(x));
    const controller = new AbortController();
    let completed = false;
    res.on('close', () => { if (!completed) controller.abort(); });
    const h = { authorization: authHeader(session.deviceId, session.token), accept: req.headers.accept || '*/*',
      'accept-encoding': 'identity' };
    if (req.headers.range) h.range = req.headers.range;
    if (req.headers['if-range']) h['if-range'] = req.headers['if-range'];
    const upstream = await fetchImpl(uri, { method: req.method, headers: h, signal: controller.signal, redirect: 'manual' });
    if (upstream.status >= 300 && upstream.status < 400) failure('Upstream redirect blocked', 502);
    const passHeaders = {};
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control']) {
      const value = upstream.headers.get(name);
      if (value) passHeaders[name] = value;
    }
    passHeaders['x-content-type-options'] = 'nosniff';
    // Artwork may be cached by the viewer's browser (never shared caches). A `tag` query
    // pins the exact image version, so a new tag means new artwork: safe to keep for a week.
    // Streams, playlists and subtitles stay uncached.
    const isImage = /^\/Items\/[\w-]+\/Images\//i.test(pathname) && upstream.ok;
    passHeaders['cache-control'] = !isImage ? 'private, no-store'
      : uri.searchParams.has('tag') ? 'private, max-age=604800, immutable' : 'private, max-age=3600';
    if (/\.m3u8(?:\?|$)/i.test(uri.pathname) && upstream.ok && req.method === 'GET') {
      const raw = await upstream.text();
      if (raw.length > 2 * 1024 * 1024) failure('Playlist too large', 502);
      let payload;
      try { payload = rewriteM3u8(raw, uri.href, jellyfinBase); }
      catch { failure('Unsafe media playlist blocked', 502); }
      delete passHeaders['content-length'];
      delete passHeaders['content-range'];
      passHeaders['content-type'] = 'application/vnd.apple.mpegurl';
      res.writeHead(upstream.status, passHeaders);
      res.end(payload);
      completed = true;
      return;
    }
    res.writeHead(upstream.status, passHeaders);
    if (req.method === 'HEAD' || !upstream.body) { completed = true; res.end(); return; }
    try { await pipeline(Readable.fromWeb(upstream.body), res, { signal: controller.signal }); }
    catch (err) { if (!controller.signal.aborted) console.error('[media proxy] stream failed:', err?.message); }
    finally { completed = true; }
  }
  function staticAsset(req, res, pathname) {
    if (!['GET', 'HEAD'].includes(req.method)) return false;
    const distDir = path.join(ROOT, 'dist');
    if (!existsSync(path.join(distDir, 'index.html'))) return false;
    const safe = pathname === '/' ? '/index.html' : pathname;
    const requested = path.resolve(distDir, '.' + safe);
    if (!requested.startsWith(distDir + path.sep) && requested !== path.join(distDir, 'index.html')) return false;
    const actual = existsSync(requested) && statSync(requested).isFile() ? requested : path.join(distDir, 'index.html');
    const ext = path.extname(actual);
    const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
    const headers = { 'content-type': contentTypes[ext] || 'application/octet-stream', 'content-length': statSync(actual).size,
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'", 'cache-control': actual.endsWith('index.html') ? 'no-store' : 'public, max-age=3600' };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end(); else createReadStream(actual).pipe(res);
    return true;
  }

  const server = http.createServer(async (req, res) => {
    const now = Date.now();
    const url = getPath(req.url || '/');
    const pathname = url.pathname;
    try {
      if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, service: 'CrimsonFin' });
      if (req.method === 'POST' && pathname === '/api/auth/login') {
        verifyMutation(req);
        const form = await bodyJson(req);
        if (!secureString(form.username) || !form.username.trim() || form.username.length > 100 || !secureString(form.password) || !form.password) failure('Enter a valid username and password');
        const recent = key => (limiter.get(key) || []).filter(t => t + 15 * 60e3 > now);
        const userKey = 'user:' + form.username.trim().toLowerCase();
        if (recent(userKey).length >= 8 || recent('*').length >= 100) failure('Too many login attempts. Try later.', 429);
        const failed = () => {
          if (limiter.size > 1000) for (const [key, times] of limiter) if (!times.some(t => t + 15 * 60e3 > now)) limiter.delete(key);
          limiter.set(userKey, [...recent(userKey), now]);
          limiter.set('*', [...recent('*'), now]);
        };
        const deviceId = 'crimsonfin-' + randomUUID();
        const response = await fetchImpl(jellyfinBase + '/Users/AuthenticateByName', {
          method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json',
            authorization: authHeader(deviceId) }, body: JSON.stringify({ Username: form.username, Pw: form.password })
        });
        if (response.status === 401 || response.status === 403) { failed(); failure('Invalid username or password', 401); }
        if (!response.ok) failure('Jellyfin is unreachable or rejected this login', 502);
        const result = await response.json();
        const token = result.AccessToken;
        const user = result.User;
        if (!user?.Id || !token) failure('Jellyfin returned an invalid login response', 502);
        const id = randomBytes(32).toString('base64url');
        db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(hash(id), user.Id,
          String(user.Name || form.username), Number(Boolean(user.Policy?.IsAdministrator)), deviceId,
          crypt.encrypt(token), now + (form.remember ? REMEMBER_MS : SESSION_MS), now);
        limiter.delete(userKey);
        return json(res, 200, { user: { id: user.Id, name: user.Name, isAdmin: Boolean(user.Policy?.IsAdministrator) } },
          { 'set-cookie': makeCookie(id, secure, Boolean(form.remember)) });
      }
      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        verifyMutation(req);
        const raw = decodeURIComponent(parseCookie(req.headers.cookie, 'cf_session'));
        if (raw) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash(raw));
        return json(res, 200, { ok: true }, { 'set-cookie': deleteCookie(secure) });
      }
      if (pathname.startsWith('/api/') || pathname.startsWith('/jellyfin/')) {
        const user = await requireSession(req);
        if (pathname.startsWith('/jellyfin/')) return await streamJellyfin(req, res, user, pathname.slice('/jellyfin'.length), url.search);
        if (pathname === '/api/auth/me' && req.method === 'GET') {
          await jellyfin('/Users/Me', user);
          return json(res, 200, { user: { id: user.userId, name: user.userName, isAdmin: user.isAdmin }, titleTranslations: !!titleToken });
        }
        if (pathname === '/api/library' && req.method === 'GET') {
          // Paged, sorted and filtered by Jellyfin so libraries of any size stay complete.
          const q = url.searchParams;
          const type = q.get('type') === 'series' ? 'Series' : q.get('type') === 'all' ? 'Movie,Series' : 'Movie';
          const sorts = { added: ['DateCreated', 'Descending'], name: ['SortName', 'Ascending'],
            year: ['ProductionYear,SortName', 'Descending,Ascending'], rating: ['CommunityRating,SortName', 'Descending,Ascending'],
            played: ['DatePlayed', 'Descending'] };
          const [sortBy, sortOrder] = Object.hasOwn(sorts, q.get('sort') || '') ? sorts[q.get('sort')] : sorts.added;
          const filters = { favorite: 'IsFavorite', played: 'IsPlayed' };
          const start = Math.max(0, Math.min(100000, Number.parseInt(q.get('start') || '0', 10) || 0));
          const limit = Math.max(1, Math.min(200, Number.parseInt(q.get('limit') || '60', 10) || 60));
          const genre = String(q.get('genre') || '').trim().slice(0, 80);
          const params = new URLSearchParams({
            Recursive: 'true', IncludeItemTypes: type, Fields: 'Overview,Genres,PrimaryImageAspectRatio,ChildCount,OriginalTitle',
            SortBy: sortBy, SortOrder: sortOrder, StartIndex: String(start), Limit: String(limit), EnableTotalRecordCount: 'true'
          });
          if (genre) params.set('Genres', genre);
          if (Object.hasOwn(filters, q.get('filter') || '')) params.set('Filters', filters[q.get('filter')]);
          return json(res, 200, await jellyfin(`/Users/${user.userId}/Items?${params}`, user));
        }
        if (pathname === '/api/genres' && req.method === 'GET') {
          const type = url.searchParams.get('type') === 'series' ? 'Series' : 'Movie';
          const data = await jellyfin(`/Genres?${new URLSearchParams({ UserId: user.userId, IncludeItemTypes: type, Recursive: 'true', SortBy: 'SortName' })}`, user);
          return json(res, 200, { genres: (data?.Items || []).map(g => String(g?.Name || '')).filter(Boolean).slice(0, 200) });
        }
        if (pathname === '/api/continue' && req.method === 'GET') {
          const fields = 'Overview,Genres,OriginalTitle';
          const resume = await jellyfin(`/Users/${user.userId}/Items/Resume?Limit=80&Fields=${fields}`, user);
          const recent = db.prepare('SELECT * FROM last_played_episode WHERE user_id = ? ORDER BY played_at DESC LIMIT 80').all(user.userId);
          if (!recent.length) return json(res, 200, resume);
          const ids = recent.map(row => row.item_id).filter(Boolean);
          const supplements = ids.length ? await jellyfin(`/Users/${user.userId}/Items?${new URLSearchParams({
            Ids: ids.join(','), Recursive: 'true', IncludeItemTypes: 'Episode', Fields: fields, Limit: String(ids.length)
          })}`, user).catch(error => {
            if (error?.status === 401) throw error;
            return { Items: [] };
          }) : { Items: [] };
          const items = new Map((supplements.Items || []).map(item => [item.Id, item]));
          const bySeries = new Map(recent.map(row => [row.series_id, row]));
          const result = (resume.Items || []).filter(item => {
            const row = item.Type === 'Episode' && bySeries.get(item.SeriesId);
            return !row || (row.item_id && !items.has(row.item_id));
          });
          for (const row of recent) {
            const item = items.get(row.item_id);
            if (!item || item.Type !== 'Episode' || item.SeriesId !== row.series_id) continue;
            const atEnd = item.RunTimeTicks > 0 && row.position_ticks >= item.RunTimeTicks - 10_000_000;
            result.push({ ...item, UserData: { ...item.UserData, LastPlayedDate: new Date(row.played_at).toISOString(),
              PlaybackPositionTicks: atEnd ? 0 : row.position_ticks,
              PlayedPercentage: !atEnd && item.RunTimeTicks ? Math.min(100, 100 * row.position_ticks / item.RunTimeTicks) : 0 } });
          }
          result.sort((a, b) => (Date.parse(b.UserData?.LastPlayedDate || '') || 0) - (Date.parse(a.UserData?.LastPlayedDate || '') || 0));
          return json(res, 200, { Items: result, TotalRecordCount: result.length });
        }
        if (pathname === '/api/nextup' && req.method === 'GET') return json(res, 200,
          await jellyfin(`/Shows/NextUp?UserId=${encodeURIComponent(user.userId)}&Limit=30`, user));
        if (pathname === '/api/search' && req.method === 'GET') {
          const term = String(url.searchParams.get('q') || '').trim().slice(0, 100);
          if (term.length < 2) return json(res, 200, { Items: [], TotalRecordCount: 0 });
          return json(res, 200, await jellyfin(`/Users/${user.userId}/Items?${new URLSearchParams({ Recursive: 'true', IncludeItemTypes: 'Movie,Series', SearchTerm: term, Limit: '75', Fields: 'OriginalTitle' })}`, user));
        }
        const sync = pathname.match(/^\/api\/subtitle-sync\/([a-f\d-]{32,36})\/([a-f\d-]{32,36})\/(\d{1,3})\/(\d{1,3})$/i);
        if (sync && req.method === 'GET') {
          if (!env.SUBTITLE_SYNC_COMMAND) return res.writeHead(204, { 'cache-control': 'no-store' }).end();
          const [, itemId, sourceId, subtitleIndex, audioIndex] = sync;
          const details = await jellyfin(`/Users/${user.userId}/Items/${itemId}?Fields=MediaSources,Path`, user);
          const source = details.MediaSources?.find(source => source.Id === sourceId);
          const result = await subtitleSync(source, Number(subtitleIndex), Number(audioIndex), () =>
            fetchImpl(`${jellyfinBase}/Videos/${itemId}/${sourceId}/Subtitles/${subtitleIndex}/Stream.vtt`, {
              headers: { authorization: authHeader(user.deviceId, user.token) },
              redirect: 'manual', signal: AbortSignal.timeout(20000)
            }));
          return res.writeHead(result.status, {
            'cache-control': 'no-store', 'content-type': 'text/vtt; charset=utf-8'
          }).end(result.captions);
        }
        const titleItem = pathname.match(/^\/api\/items\/([\w-]+)\/titles$/);
        if (titleItem && req.method === 'GET') {
          if (!titleToken) return json(res, 200, {});
          const id = safeId(titleItem[1]);
          const item = await jellyfin(`/Users/${user.userId}/Items/${id}?Fields=ProviderIds`, user);
          return json(res, 200, await titleTranslations(item));
        }
        const item = pathname.match(/^\/api\/items\/([\w-]+)$/);
        if (item && req.method === 'GET') return json(res, 200,
          await jellyfin(`/Users/${user.userId}/Items/${safeId(item[1])}?Fields=Overview,Genres,People,MediaSources,MediaStreams,OriginalTitle`, user));
        const seasons = pathname.match(/^\/api\/series\/([\w-]+)\/seasons$/);
        if (seasons && req.method === 'GET') return json(res, 200,
          await jellyfin(`/Shows/${safeId(seasons[1])}/Seasons?UserId=${encodeURIComponent(user.userId)}`, user));
        const episodes = pathname.match(/^\/api\/series\/([\w-]+)\/episodes$/);
        if (episodes && req.method === 'GET') {
          const season = url.searchParams.get('seasonId');
          return json(res, 200, await jellyfin(`/Shows/${safeId(episodes[1])}/Episodes?${new URLSearchParams({
            UserId: user.userId, Fields: 'Overview', ...(season ? { SeasonId: safeId(season) } : {})
          })}`, user));
        }
        const favorite = pathname.match(/^\/api\/items\/([\w-]+)\/favorite$/);
        if (favorite && ['POST', 'DELETE'].includes(req.method)) {
          verifyMutation(req);
          await jellyfin(`/Users/${user.userId}/FavoriteItems/${safeId(favorite[1])}`, user, { method: req.method });
          return json(res, 200, { ok: true });
        }
        // Intro / credits markers for "Skip intro" and the next-episode prompt. Jellyfin 10.10+
        // exposes MediaSegments; older servers may have the Intro Skipper plugin. Neither is required.
        const segments = pathname.match(/^\/api\/items\/([\w-]+)\/segments$/);
        if (segments && req.method === 'GET') {
          const id = safeId(segments[1]);
          const span = (start, end) => Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
          const optional = async relative => {
            try { return await jellyfin(relative, user); }
            catch (error) { if (error?.status === 401) throw error; return null; }
          };
          const found = { intro: null, credits: null };
          const media = await optional(`/MediaSegments/${id}?includeSegmentTypes=Intro&includeSegmentTypes=Outro`);
          for (const s of Array.isArray(media?.Items) ? media.Items : []) {
            const value = span(Number(s?.StartTicks) / 1e7, Number(s?.EndTicks) / 1e7);
            if (s?.Type === 'Intro' && !found.intro) found.intro = value;
            if (s?.Type === 'Outro' && !found.credits) found.credits = value;
          }
          if (!found.intro || !found.credits) {
            const plugin = await optional(`/Episode/${id}/IntroSkipperSegments`);
            found.intro ||= span(Number(plugin?.Introduction?.IntroStart), Number(plugin?.Introduction?.IntroEnd));
            found.credits ||= span(Number(plugin?.Credits?.IntroStart), Number(plugin?.Credits?.IntroEnd));
          }
          return json(res, 200, found);
        }
        // Watch history. Jellyfin 10.9 moved these user-data endpoints; try the
        // classic route first and fall back to the newer one if it fails.
        const played = pathname.match(/^\/api\/items\/([\w-]+)\/played$/);
        if (played && ['POST', 'DELETE'].includes(req.method)) {
          verifyMutation(req);
          const id = safeId(played[1]);
          await jellyfinEither([`/Users/${user.userId}/PlayedItems/${id}`, `/UserPlayedItems/${id}?userId=${encodeURIComponent(user.userId)}`],
            user, { method: req.method });
          return json(res, 200, { ok: true });
        }
        const progress = pathname.match(/^\/api\/items\/([\w-]+)\/progress$/);
        if (progress && req.method === 'DELETE') {
          verifyMutation(req);
          const id = safeId(progress[1]);
          // A zero resume position removes the item from Continue watching without marking it watched.
          await jellyfinEither([`/Users/${user.userId}/Items/${id}/UserData`, `/UserItems/${id}/UserData?userId=${encodeURIComponent(user.userId)}`],
            user, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ PlaybackPositionTicks: 0 }) });
          db.prepare("UPDATE last_played_episode SET item_id = '', playback_id = '' WHERE user_id = ? AND item_id = ?").run(user.userId, id);
          return json(res, 200, { ok: true });
        }
        if (pathname === '/api/playback' && req.method === 'POST') {
          verifyMutation(req);
          const data = await bodyJson(req);
          if (!['Playing', 'Progress', 'Stopped'].includes(data.event)) failure('Unknown playback event');
          safeId(data.itemId);
          const rawTicks = Number(data.positionTicks);
          const ticks = Number.isFinite(rawTicks) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(rawTicks))) : 0;
          const payload = { ItemId: data.itemId, PositionTicks: ticks, IsPaused: Boolean(data.isPaused),
            PlayMethod: data.method === 'DirectPlay' ? 'DirectPlay' : 'Transcode' };
          await jellyfin(`/Sessions/Playing${data.event === 'Playing' ? '' : '/' + data.event}`, user,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
          if (typeof data.playbackId === 'string' && /^[a-f0-9-]{36}$/i.test(data.playbackId)) {
            if (data.event === 'Playing') {
              const item = await jellyfin(`/Users/${user.userId}/Items/${data.itemId}`, user).catch(() => null);
              if (item?.Type === 'Episode' && item.SeriesId && item.Id === data.itemId) {
                db.prepare(`INSERT INTO last_played_episode VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT(user_id, series_id) DO UPDATE SET item_id=excluded.item_id,
                    playback_id=excluded.playback_id, played_at=excluded.played_at, position_ticks=excluded.position_ticks
                  WHERE excluded.played_at >= last_played_episode.played_at`)
                  .run(user.userId, item.SeriesId, item.Id, data.playbackId, now, ticks);
              }
            } else {
              db.prepare('UPDATE last_played_episode SET position_ticks = ? WHERE user_id = ? AND item_id = ? AND playback_id = ?')
                .run(ticks, user.userId, data.itemId, data.playbackId);
            }
          }
          return json(res, 200, { ok: true });
        }
        if (pathname === '/api/requests' && req.method === 'GET') {
          if (now - lastDownloadSync > 15_000) {
            lastDownloadSync = now;
            await requestsFlow.syncProgress().catch(() => {});
          }
          return json(res, 200, { requests: requestsFlow.listRows(user) });
        }
        if (pathname === '/api/requests' && req.method === 'POST') {
          verifyMutation(req);
          const data = await bodyJson(req);
          const title = String(data.title || '').trim();
          if (title.length < 2 || title.length > 180 || !['movie', 'series'].includes(data.kind)) failure('Valid movie/series title and type are required');
          const year = data.year === '' || data.year == null ? null : Number(data.year);
          if (year !== null && (!Number.isInteger(year) || year < 1888 || year > 2100)) failure('Invalid year');
          const notes = String(data.notes || '').trim().slice(0, 500);
          const count = db.prepare("SELECT COUNT(*) AS n FROM requests WHERE user_id = ? AND created_at > ?").get(user.userId, now - 864e5).n;
          if (count >= 20) failure('Daily request limit reached', 429);
          const id = randomUUID();
          db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, user.userId,
            user.userName, title, data.kind, year, notes, 'pending', now, now);
          return json(res, 201, { id, status: 'pending' });
        }
        const requestManage = pathname.match(/^\/api\/requests\/([\w-]+)$/);
        if (requestManage && req.method === 'DELETE') {
          verifyMutation(req); requireAdmin(user);
          requestsFlow.deleteRequest(requestManage[1]);
          return json(res, 200, { ok: true });
        }
        if (requestManage && req.method === 'PATCH') {
          verifyMutation(req); requireAdmin(user);
          const form = await bodyJson(req);
          if (!['approved', 'rejected', 'fulfilled', 'pending'].includes(form.status)) failure('Invalid status');
          const existing = db.prepare('SELECT * FROM requests WHERE id=?').get(requestManage[1]);
          if (!existing) failure('Request not found', 404);
          if (form.kind !== undefined) {
            if (!['movie','series'].includes(form.kind)) failure('Invalid media type');
            const job = requestsFlow.get(requestManage[1]);
            if (job && ['queued','downloading','completed'].includes(job.state)) failure('Cannot reclassify a request that is already downloading', 409);
            db.prepare('UPDATE requests SET kind=? WHERE id=?').run(form.kind, requestManage[1]);
            if (form.kind !== existing.kind) requestsFlow.save(requestManage[1],{state:'needs_review',detail:'Media type corrected. Retry release search.'});
          }
          const update = db.prepare('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?').run(form.status, now, requestManage[1]);
          if (!update.changes) failure('Request not found', 404);
          if (form.status === 'approved') {
            // Approval explicitly authorizes trying an exact FileList match.
            // Ambiguous matches remain queued for admin review, not blind downloads.
            const outcome = await requestsFlow.process(requestManage[1], user.userId);
            return json(res, 200, { ok: true, downloadState: outcome.state, detail: outcome.detail });
          }
          return json(res, 200, { ok: true });
        }
        const processApproved = pathname.match(/^\/api\/requests\/([\w-]+)\/process$/);
        if (processApproved && req.method === 'POST') {
          verifyMutation(req); requireAdmin(user);
          const outcome = await requestsFlow.process(processApproved[1], user.userId);
          return json(res, 200, { state: outcome.state, detail: outcome.detail });
        }
        const optionsApproved = pathname.match(/^\/api\/requests\/([\w-]+)\/releases$/);
        if (optionsApproved && req.method === 'GET') {
          requireAdmin(user);
          return json(res, 200, await requestsFlow.options(optionsApproved[1], user.userId));
        }
        const selectedApproved = pathname.match(/^\/api\/requests\/([\w-]+)\/queue$/);
        if (selectedApproved && req.method === 'POST') {
          verifyMutation(req); requireAdmin(user);
          const body = await bodyJson(req);
          if (!/^\d{1,12}$/.test(String(body.releaseId||''))) failure('Invalid FileList release');
          const outcome = await requestsFlow.select(selectedApproved[1], user.userId, String(body.releaseId));
          return json(res, 200, { state: outcome.state, detail: outcome.detail });
        }
        if (pathname === '/api/filelist/search' && req.method === 'GET') {
          const query = String(url.searchParams.get('q') || '').trim();
          const category = String(url.searchParams.get('category') || '').trim();
          if (query.length < 2 || query.length > 100) failure('Search must have 2 to 100 characters');
          return json(res, 200, await filelist.search(query, user.userId, category));
        }
        if (pathname === '/api/admin/filelist/settings' && req.method === 'GET') {
          requireAdmin(user);
          return json(res, 200, filelist.status());
        }
        if (pathname === '/api/admin/filelist/settings' && req.method === 'POST') {
          verifyMutation(req); requireAdmin(user);
          const settings = await bodyJson(req);
          return json(res, 200, filelist.configure(settings));
        }
        const torrent = pathname.match(/^\/api\/admin\/filelist\/torrent\/(\d+)$/);
        if (torrent && req.method === 'GET') {
          requireAdmin(user);
          const body = await filelist.torrentFor(user.userId, torrent[1]);
          res.writeHead(200, { 'content-type': 'application/x-bittorrent',
            'content-disposition': 'attachment; filename="filelist-' + torrent[1] + '.torrent"',
            'content-length': body.length, 'cache-control': 'no-store',
            'x-content-type-options': 'nosniff' });
          res.end(body);
          return;
        }
        if (pathname === '/api/admin/downloads' && req.method === 'GET') {
          requireAdmin(user);
          return json(res, 200, await downloadManager.status());
        }
        const download = pathname.match(/^\/api\/admin\/downloads\/([\w-]+)$/);
        if (download && req.method === 'DELETE') {
          verifyMutation(req); requireAdmin(user);
          const hash = download[1].toLowerCase();
          await downloadManager.deleteTorrent(hash);
          requestsFlow.markDownloadDeleted(hash);
          return json(res, 200, { ok: true });
        }
        const queue = pathname.match(/^\/api\/admin\/filelist\/queue\/(\d+)$/);
        if (queue && req.method === 'POST') {
          verifyMutation(req); requireAdmin(user);
          const body = await bodyJson(req);
          return json(res, 200, await filelist.queueTorrent(user.userId, queue[1], body.kind));
        }
        if (pathname === '/api/admin/subtitles/status' && req.method === 'GET') {
          requireAdmin(user);
          let snapshot = null;
          try {
            const file = path.resolve(ROOT, env.DATA_DIR || './data', 'romanian-subtitle-audit.json');
            if (existsSync(file) && statSync(file).size <= 4_000_000) {
              const raw = JSON.parse(readFileSync(file, 'utf8'));
              const summary = raw?.lastSummary || {};
              const safeInt = v => Math.max(0, Math.min(100_000, Math.round(Number(v) || 0)));
              snapshot = {
                lastScanUtc: /^\d{4}-\d\d-\d\dT/.test(raw?.lastScanUtc || '') ? raw.lastScanUtc : '',
                checked: safeInt(summary.checked),
                haveRomanian: safeInt(summary.haveRomanian),
                possiblyMissing: safeInt(summary.possiblyMissing),
                attempted: safeInt(summary.attempted),
                installed: safeInt(summary.installed)
              };
            }
          } catch {}
          return json(res, 200, { enabled: Boolean(snapshot), summary: snapshot });
        }
        if (pathname === '/api/admin/status' && req.method === 'GET') {
          requireAdmin(user);
          let reachable = false;
          try { await jellyfin('/System/Info/Public', user); reachable = true; } catch {}
          return json(res, 200, { jellyfinReachable: reachable, filelistConfigured: filelist.status().apiConfigured || filelist.status().rssConfigured,
            pendingRequests: db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status='pending'").get().n });
        }
        return json(res, 404, { error: 'Endpoint not found' });
      }
      if (!staticAsset(req, res, pathname)) json(res, 404, { error: 'Build the web app with npm run build' });
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      if (err.name === 'AbortError') return json(res, 504, { error: 'Upstream connection timed out' });
      // No token, passkey, full upstream URL or internal path is ever returned to users.
      json(res, err.status || 502, { error: hideSecrets(err) });
    }
  });
  if (env.QBIT_FORCE_START_DOWNLOADS !== 'false' && env.QBIT_USERNAME && env.QBIT_PASSWORD) {
    const forceDownloads = () => void downloadManager.forceStartDownloads().catch(() => {});
    server.on('listening', forceDownloads);
    const timer = setInterval(forceDownloads, 15_000);
    timer.unref();
    server.on('close', () => clearInterval(timer));
  }
  return { server, db };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  const { server } = createAppServer();
  const port = Number(process.env.PORT || 8099);
  server.listen(port, process.env.BIND_HOST || '127.0.0.1', () => {
    console.log('[CrimsonFin] remote gateway listening on loopback');
  });
  // Optional pinned-certificate HTTPS listener for desktop clients on the LAN.
  // Remote Funnel remains on the separate loopback listener above.
  if (process.env.LOCAL_TLS_KEY_PATH && process.env.LOCAL_TLS_CERT_PATH) {
    const handler = server.listeners('request')[0];
    const local = https.createServer({
      key: readFileSync(path.resolve(ROOT, process.env.LOCAL_TLS_KEY_PATH)),
      cert: readFileSync(path.resolve(ROOT, process.env.LOCAL_TLS_CERT_PATH))
    }, handler);
    local.on('error', err => console.error('[CrimsonFin] LAN TLS listener failed:', err.code || err.name));
    local.listen(Number(process.env.LOCAL_TLS_PORT || 9443), process.env.LOCAL_TLS_BIND || '0.0.0.0',
      () => console.log('[CrimsonFin] encrypted LAN endpoint ready'));
    createLanDiscovery(Number(process.env.LOCAL_DISCOVERY_PORT || 8098));
  }
}
