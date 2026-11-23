import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server/index.mjs';

const xml = '<rss><channel><item><title>Example.Movie.2026.1080p</title>' +
  '<guid>https://filelist.io/download.php?passkey=never-send-this</guid>' +
  '</item></channel></rss>';
const user = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';

test('authenticated RSS search works with only a private feed URL', async t => {
  let rssFetches = 0;
  const gateway = createAppServer({
    dbPath: ':memory:',
    env: {
      NODE_ENV: 'development',
      JELLYFIN_URL: 'http://127.0.0.1:8096',
      SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      FILELIST_RSS_URL: 'https://filelist.io/rss.php?feed=dl&passkey=test'
    },
    fetchImpl: async url => {
      const value = String(url);
      if (value.includes('/Users/AuthenticateByName')) {
        return Response.json({ AccessToken: 'sample-private-jellyfin-token',
          User: { Id: user, Name: 'friend', Policy: { IsAdministrator: false } } });
      }
      if (value.startsWith('https://filelist.io/rss.php')) {
        rssFetches++;
        return new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } });
      }
      throw new Error('Unexpected URL in test');
    }
  });
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  t.after(async () => {
    await new Promise(resolve => gateway.server.close(resolve));
    gateway.db.close();
  });
  const base = 'http://127.0.0.1:' + gateway.server.address().port;
  assert.equal((await fetch(base + '/api/filelist/search?q=example')).status, 401);
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'friend', password: 'test' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(base + '/api/filelist/search?q=example%20movie', { headers: { cookie } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.source, 'rss');
  assert.equal(payload.results.length, 1);
  assert.match(payload.results[0].name, /Example.Movie/);
  assert.doesNotMatch(JSON.stringify(payload), /never-send-this|passkey|download.php/);
  await fetch(base + '/api/filelist/search?q=example%20movie', { headers: { cookie } });
  assert.equal(rssFetches, 1, 'cached feed results prevent repeated tracker requests');
});
