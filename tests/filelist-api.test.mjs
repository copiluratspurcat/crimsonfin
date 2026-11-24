import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createFilelistService } from '../server/filelist-service.mjs';
import { buildFilelistApiUrl, parseFilelistApiResults, privateDownloadUrl } from '../server/filelist-api.mjs';

test('FileList API uses an authenticated GET without a passkey in the URL', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  let apiCalls = 0, torrentCalls = 0, queuedKind = '';
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/api.php') {
      apiCalls++;
      assert.equal(u.searchParams.get('action'), 'search-torrents');
      assert.equal(u.searchParams.get('type'), 'name');
      assert.equal(u.searchParams.get('query'), 'Example Film');
      assert.deepEqual(new Set(u.searchParams.get('category').split(',')),
        new Set(['1','2','3','4','6','19','20','25','26','21','23','27','24','15','16']));
      assert.equal(u.searchParams.has('passkey'), false);
      assert.equal(init.headers.authorization, 'Basic ' + Buffer.from('sample-user:sample-passkey').toString('base64'));
      return Response.json([{ id: 42, name: 'Example.Film.2026.1080p', size: '1 GB', seeders: 14, category: '4',
        download_link: 'https://filelist.io/download.php?id=42&passkey=never-expose-this' }, { id: 43, name: 'Example.Game', category: '9' }]);
    }
    if (u.hostname === 'filelist.io' && u.pathname === '/download.php') {
      torrentCalls++;
      return new Response(Buffer.from('d3:foo3:bare'), { status: 200, headers: { 'content-type': 'application/x-bittorrent' } });
    }
    throw new Error('Unexpected URL: ' + u.pathname);
  };
  const app = createFilelistService({
    env: {
      FILELIST_RSS_URL: 'https://filelist.io/rss.php?feed=dl&passkey=sample-passkey',
      QBIT_URL: 'http://127.0.0.1:8877', QBIT_USERNAME: 'crimsonfin', QBIT_PASSWORD: 'sample-qbit-password'
    },
    db, crypto: { encrypt: value => 'enc:' + value, decrypt: value => value.slice(4) },
    fetchImpl,
    downloadManager: { queueTorrentFile: async (torrent, kind, size) => {
      assert.equal(torrent[0], 0x64);
      queuedKind = kind;
      assert.ok(size > 0);
      return {ok:true,queued:true,kind,drive:'ADATA',folder:'/mnt/ADATA/Movies'};
    } }
  });
  const settings = app.configure({ username: 'sample-user' });
  assert.equal(settings.apiConfigured, true);
  assert.equal(settings.downloaderConfigured, true);
  const search = await app.search('Example Film', 'admin-user');
  assert.equal(search.source, 'api');
  assert.equal(search.results[0].name, 'Example.Film.2026.1080p');
  assert.equal(search.results[0].downloadable, true);
  assert.equal(search.results.length, 1);
  assert.deepEqual((await app.search('Example Film', 'admin-user', '9')).results, []);
  assert.doesNotMatch(JSON.stringify(search), /never-expose|sample-passkey|download.php/);
  const found = await app.search('Example Film', 'admin-user');
  assert.deepEqual(found, search);
  assert.equal(apiCalls, 1, 'Search result cached');
  const torrent = await app.torrentFor('admin-user', '42');
  assert.equal(torrent.toString(), 'd3:foo3:bare');
  assert.equal(torrentCalls, 1);
  await assert.rejects(() => app.torrentFor('different-user', '42'), /Search for this release again/);
  const queued = await app.queueTorrent('admin-user', '42');
  assert.equal(queued.queued, true);
  assert.equal(queuedKind, 'movie');
  db.close();
});

test('Torrent link allowlist blocks private network and foreign hosts', () => {
  assert.equal(privateDownloadUrl('https://filelist.io/download.php?id=42&passkey=private')?.hostname, 'filelist.io');
  for (const url of ['http://filelist.io/download.php?id=1',
    'https://evil.test/download.php?id=1','https://127.0.0.1/download.php?id=1',
    'https://filelist.io/api.php?foo=x', 'https://filelist.io.evil.test/download.php?id=1']) {
    assert.equal(privateDownloadUrl(url), null);
  }
  assert.throws(() => buildFilelistApiUrl('Example', '5,invalid'));
  assert.equal(buildFilelistApiUrl('tt4719744').searchParams.get('type'), 'imdb');
  const parsed = parseFilelistApiResults([{ id: 42, name: 'Film', download_link: 'https://evil.test/download.php?id=1' }]);
  assert.equal(parsed.results[0].downloadable, false);
});
