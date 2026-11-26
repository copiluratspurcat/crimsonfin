import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createAppServer, rewriteM3u8 } from '../server/index.mjs';

const VIDEO = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const userData = [];
const itemQueries = [];
function upstream(isRevoked = () => false) {
  return http.createServer(async (req, res) => {
    const p = new URL(req.url, 'http://localhost');
    if (p.pathname === '/Users/AuthenticateByName') {
      let body = ''; for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      if (data.Pw !== 'testpass') { res.writeHead(401); res.end(); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ AccessToken: 'jellyfin-private-token-123', User: {
        Id: VIDEO, Name: data.Username, Policy: { IsAdministrator: data.Username === 'admin' }
      } })); return;
    }
    if (isRevoked() || !req.headers.authorization?.includes('Token="jellyfin-private-token-123"')) { res.writeHead(401); res.end(); return; }
    if (p.pathname.includes('/Subtitles/') && p.pathname.endsWith('/Stream.vtt')) { res.setHeader('content-type', 'text/vtt'); res.end('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nSalut!'); return; }
    if (p.pathname.includes('master.m3u8')) { res.setHeader('content-type', 'application/vnd.apple.mpegurl'); res.end(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=450000\n/Videos/${VIDEO}/hls1/main/0.ts?ApiKey=jellyfin-private-token-123\n`); return; }
    if (p.pathname.includes('/hls1/main/0.ts') || p.pathname.includes('/stream')) {
      res.setHeader('accept-ranges', 'bytes');
      if (req.headers.range === 'bytes=0-3') {
        res.writeHead(206, { 'content-type': 'video/mp2t', 'content-range': 'bytes 0-3/12', 'content-length': '4' });
        res.end('abcd'); return;
      }
      res.writeHead(200, { 'content-type': 'video/mp2t' }); res.end('abcdefghijkl'); return;
    }
    if (p.pathname === '/System/Info/Public') { res.setHeader('content-type', 'application/json'); res.end('{"ServerName":"Fake"}'); return; }
    if (p.pathname.startsWith('/Sessions/Playing') || p.pathname.includes('FavoriteItems')) { res.writeHead(204); res.end(); return; }
    // Simulate Jellyfin 10.9+: the classic PlayedItems route is gone, the new one works.
    if (p.pathname.startsWith('/Users/') && p.pathname.includes('/PlayedItems/')) { res.writeHead(404); res.end(); return; }
    if (p.pathname.startsWith('/UserPlayedItems/')) { userData.push(`${req.method} played ${p.searchParams.get('userId')}`); res.writeHead(204); res.end(); return; }
    if (p.pathname.endsWith('/UserData') && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      userData.push(`progress ${body}`); res.writeHead(204); res.end(); return;
    }
    res.setHeader('content-type', 'application/json');
    if (p.pathname.endsWith('/Items')) itemQueries.push(p.searchParams);
    if (p.pathname === `/MediaSegments/${VIDEO}`) { res.end(JSON.stringify({ Items: [
      { Type: 'Intro', StartTicks: 12e7, EndTicks: 92e7 }, { Type: 'Outro', StartTicks: 2500e7, EndTicks: 2600e7 }] })); return; }
    if (p.pathname.startsWith('/MediaSegments/') || p.pathname.includes('/IntroSkipperSegments')) { res.writeHead(404); res.end(); return; }
    if (p.pathname === '/Genres') { res.end(JSON.stringify({ Items: [{ Name: 'Drama' }, { Name: 'Comedie' }] })); return; }
    if (p.pathname.endsWith('/Items') || p.pathname.includes('/Items/')) { res.end(JSON.stringify({ Items: [{ Id: VIDEO, Name: 'Test Movie', Type: 'Movie' }], TotalRecordCount: 1 })); return; }
    res.end('{"Items":[],"TotalRecordCount":0}');
  });
}
async function begin(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
function end(server) { return new Promise(resolve => server.close(resolve)); }

async function fixture(t, isRevoked) {
  const jf = upstream(isRevoked); const jellyfinUrl = await begin(jf);
  const gateway = createAppServer({ dbPath: ':memory:', env: { JELLYFIN_URL: jellyfinUrl, NODE_ENV: 'development', SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64') } });
  const url = await begin(gateway.server);
  t.after(async () => { await end(gateway.server); await end(jf); gateway.db.close(); });
  async function login(name = 'friend') {
    const r = await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: 'testpass', remember: true }) });
    assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0];
  }
  const request = (path, cookie, init = {}) => fetch(url + path, { ...init, headers: { ...(cookie ? { cookie } : {}), ...init.headers } });
  return { url, request, login, gateway };
}

test('login uses per-user token, encrypted storage, cookies, and authorization boundaries', async t => {
  const { request, login, gateway } = await fixture(t);
  const noAuth = await request('/api/library'); assert.equal(noAuth.status, 401);
  const cookie = await login();
  const me = await (await request('/api/auth/me', cookie)).json();
  assert.equal(me.user.isAdmin, false);
  const library = await request('/api/library?type=movie', cookie);
  assert.equal(library.status, 200);
  assert.equal((await library.json()).Items[0].Name, 'Test Movie');
  // Paging, sorting and filtering are passed to Jellyfin (page size clamped to 200).
  assert.equal((await request('/api/library?type=series&start=120&limit=999&sort=name&genre=Drama&filter=favorite', cookie)).status, 200);
  const sent = itemQueries.at(-1);
  assert.deepEqual(Object.fromEntries(['IncludeItemTypes', 'StartIndex', 'Limit', 'SortBy', 'SortOrder', 'Genres', 'Filters'].map(k => [k, sent.get(k)])),
    { IncludeItemTypes: 'Series', StartIndex: '120', Limit: '200', SortBy: 'SortName', SortOrder: 'Ascending', Genres: 'Drama', Filters: 'IsFavorite' });
  assert.deepEqual(await (await request('/api/genres?type=movie', cookie)).json(), { genres: ['Drama', 'Comedie'] });
  // Intro/credits markers from MediaSegments (seconds); missing segments are simply null.
  assert.deepEqual(await (await request(`/api/items/${VIDEO}/segments`, cookie)).json(),
    { intro: { start: 12, end: 92 }, credits: { start: 2500, end: 2600 } });
  assert.deepEqual(await (await request('/api/items/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb/segments', cookie)).json(), { intro: null, credits: null });
  const record = gateway.db.prepare('SELECT token_enc FROM sessions LIMIT 1').get();
  assert.doesNotMatch(record.token_enc, /jellyfin-private-token-123/);
  assert.equal((await request('/api/admin/status', cookie)).status, 403);
  assert.equal((await request('/api/playback', cookie, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'Playing', itemId: VIDEO, positionTicks: 0 }) })).status, 200);
  assert.equal((await request(`/api/items/${VIDEO}/favorite`, cookie, { method: 'POST' })).status, 200);
  // Watch history: mark watched/unwatched (falls back to the 10.9+ route) and clear the resume position.
  assert.equal((await request(`/api/items/${VIDEO}/played`, cookie, { method: 'POST' })).status, 200);
  assert.equal((await request(`/api/items/${VIDEO}/played`, cookie, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/items/${VIDEO}/progress`, cookie, { method: 'DELETE' })).status, 200);
  assert.deepEqual(userData, [`POST played ${VIDEO}`, `DELETE played ${VIDEO}`, 'progress {"PlaybackPositionTicks":0}']);
});

test('proxy supports video range requests without leaking Jellyfin token', async t => {
  const { request, login } = await fixture(t);
  const cookie = await login();
  const partial = await request(`/jellyfin/Videos/${VIDEO}/stream`, cookie, { headers: { range: 'bytes=0-3' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('cache-control'), 'private, no-store');
  // Artwork may be cached by the browser: a week when the version tag is pinned, an hour otherwise.
  const tagged = await request(`/jellyfin/Items/${VIDEO}/Images/Primary?maxWidth=400&tag=abc123`, cookie);
  assert.equal(tagged.headers.get('cache-control'), 'private, max-age=604800, immutable');
  const untagged = await request(`/jellyfin/Items/${VIDEO}/Images/Backdrop?maxWidth=1600`, cookie);
  assert.equal(untagged.headers.get('cache-control'), 'private, max-age=3600');
  assert.equal(partial.headers.get('content-range'), 'bytes 0-3/12');
  assert.equal(await partial.text(), 'abcd');
  const playlist = await request(`/jellyfin/Videos/${VIDEO}/master.m3u8`, cookie);
  assert.equal(playlist.status, 200);
  const text = await playlist.text();
  assert.match(text, new RegExp(`/jellyfin/Videos/${VIDEO}/hls1/main/0\\.ts`));
  assert.doesNotMatch(text, /jellyfin-private-token-123/);
  const denied = await request(`/jellyfin/System/Info/Public`, cookie);
  assert.equal(denied.status, 403);
});

test('subtitle WebVTT proxy allows only the authenticated media source path', async t => {
  const { request, login } = await fixture(t);
  const mediaSource = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const path = `/jellyfin/Videos/${VIDEO}/${mediaSource}/Subtitles/2/Stream.vtt`;
  assert.equal((await request(path)).status, 401);
  const cookie = await login();
  const accepted = await request(path, cookie);
  assert.equal(accepted.status, 200);
  assert.match(await accepted.text(), /WEBVTT/);
  assert.equal((await request('/jellyfin/Videos/' + VIDEO + '/' + mediaSource + '/Subtitles/2/../../System/Info', cookie)).status, 403);
});

test('request creation, owner visibility and admin review', async t => {
  const { request, login } = await fixture(t);
  const user = await login(); const admin = await login('admin');
  const posted = await request('/api/requests', user, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Big Movie', kind: 'movie', year: 2026, notes: 'test' }) });
  assert.equal(posted.status, 201);
  const { id } = await posted.json();
  assert.equal((await request(`/api/requests/${id}`, user, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) })).status, 403);
  const changed = await request(`/api/requests/${id}`, admin, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) });
  assert.equal(changed.status, 200);
  const listed = await (await request('/api/requests', user)).json();
  assert.equal(listed.requests[0].status, 'approved');
  assert.equal((await request('/api/requests', user, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.test' }, body: JSON.stringify({ title: 'Bad request', kind: 'movie' }) })).status, 403);
});

test('download progress and disk information require administrator access', async t => {
  const { request, login } = await fixture(t);
  assert.equal((await request('/api/admin/downloads')).status, 401);
  const friend = await login('friend');
  assert.equal((await request('/api/admin/downloads', friend)).status, 403);
  const admin = await login('admin');
  const reply = await request('/api/admin/downloads', admin);
  assert.equal(reply.status, 200);
  const value = await reply.json();
  assert.equal(typeof value.online, 'boolean');
  assert.ok(Array.isArray(value.drives));
  assert.ok(Array.isArray(value.downloads));
  assert.doesNotMatch(JSON.stringify(value), /QBIT_PASSWORD|FILELIST_PASSKEY|SESSION_ENCRYPTION_KEY/);
});

test('Romanian subtitle coverage is visible to admins only', async t => {
  const { request, login } = await fixture(t);
  assert.equal((await request('/api/admin/subtitles/status')).status, 401);
  const regular = await login('friend');
  assert.equal((await request('/api/admin/subtitles/status', regular)).status, 403);
  const admin = await login('admin');
  const response = await request('/api/admin/subtitles/status', admin);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(typeof data.enabled, 'boolean');
  assert.doesNotMatch(JSON.stringify(data), /JELLYFIN_METADATA_API_KEY|\.srt|passkey/);
});

test('playlist URL allowlist blocks external URLs', () => {
  assert.throws(() => rewriteM3u8('#EXTM3U\nhttps://example.com/evil.ts', 'http://localhost/Videos/' + VIDEO + '/master.m3u8', 'http://localhost'));
});

test('a revoked Jellyfin login is rejected and can be replaced by a new sign-in', async t => {
  let revoked = false;
  const { request, login, gateway } = await fixture(t, () => revoked);
  const cookie = await login();
  assert.equal((await request('/api/auth/me', cookie)).status, 200);
  revoked = true;
  assert.equal((await request('/api/auth/me', cookie)).status, 401);
  assert.equal(gateway.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  revoked = false;
  assert.equal((await request('/api/auth/me', cookie)).status, 401);
  assert.equal((await request('/api/auth/me', await login())).status, 200);
});

test('failed logins are throttled per username, not for everyone behind the same proxy', async t => {
  const { url, login } = await fixture(t);
  const attempt = (username, password) => fetch(url + '/api/auth/login', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  for (let i = 0; i < 8; i++) assert.equal((await attempt('victim', 'wrong')).status, 401);
  assert.equal((await attempt('victim', 'testpass')).status, 429);
  await login('friend'); // same socket address, other user: still able to sign in
});

test('a session the gateway can no longer decrypt signs the user out instead of failing', async t => {
  const { request, login, gateway } = await fixture(t);
  const cookie = await login();
  gateway.db.prepare("UPDATE sessions SET token_enc = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'").run();
  assert.equal((await request('/api/auth/me', cookie)).status, 401);
  assert.equal(gateway.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('library sort and filter ignore inherited object keys', async t => {
  const { request, login } = await fixture(t);
  const cookie = await login();
  for (const q of ['sort=__proto__', 'sort=constructor', 'filter=constructor', 'filter=__proto__']) {
    assert.equal((await request('/api/library?' + q, cookie)).status, 200, q);
    const sent = itemQueries.at(-1);
    assert.equal(sent.get('SortBy'), 'DateCreated');
    assert.equal(sent.get('Filters'), null);
  }
  await request('/api/library?sort=year', cookie);
  assert.equal(itemQueries.at(-1).get('SortOrder'), 'Descending,Ascending');
});

test('torrent deletion requires admin permissions, a trusted origin and a valid hash', async t => {
  const { request, login } = await fixture(t);
  const endpoint = '/api/admin/downloads/' + 'a'.repeat(40);
  assert.equal((await request(endpoint, null, { method: 'DELETE' })).status, 401);
  const member = await login();
  assert.equal((await request(endpoint, member, { method: 'DELETE' })).status, 403);
  const admin = await login('admin');
  assert.equal((await request(endpoint, admin, {
    method: 'DELETE', headers: { origin: 'https://untrusted.example' }
  })).status, 403);
  assert.equal((await request('/api/admin/downloads/all', admin, { method: 'DELETE' })).status, 400);
});

test('only admins can delete a request, and deletion leaves no review row', async t => {
  const { request, login } = await fixture(t);
  const member = await login();
  const response = await request('/api/requests', member, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Example Movie', kind: 'movie' })
  });
  assert.equal(response.status, 201);
  const list = async () => (await (await request('/api/requests', member)).json()).requests;
  const [item] = await list();
  const path = '/api/requests/' + item.id;
  assert.equal((await request(path, member, { method: 'DELETE' })).status, 403);
  const admin = await login('admin');
  assert.equal((await request(path, admin, { method: 'DELETE', headers: { origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await request(path, admin, { method: 'DELETE' })).status, 200);
  assert.deepEqual(await list(), []);
});
