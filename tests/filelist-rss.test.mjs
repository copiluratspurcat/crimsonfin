import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFilelistRss, validateFilelistRssUrl } from '../server/filelist-rss.mjs';

const rss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>FileList</title>
<item><title>Example.Movie.2026.1080p</title>
<link>https://filelist.io/download.php?id=42&amp;passkey=do-not-expose</link>
<guid>https://filelist.io/download.php?id=42&amp;passkey=do-not-expose</guid>
<description>Download using passkey=do-not-expose</description></item>
<item><title>Another.Series.S01.720p</title><link>https://filelist.io/download.php?passkey=secret</link></item>
</channel></rss>`;

test('RSS catalog search matches only recent entry titles and hides tracker links', () => {
  const found = parseFilelistRss(rss, 'example movie');
  assert.equal(found.configured, true);
  assert.equal(found.source, 'rss');
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].name, 'Example.Movie.2026.1080p');
  assert.doesNotMatch(JSON.stringify(found), /do-not-expose|download.php|passkey=/);
  assert.equal(parseFilelistRss(rss, 'nonexistent').results.length, 0);
});

test('RSS configuration rejects arbitrary hosts, paths, credentials and plaintext HTTP', () => {
  const valid = 'https://filelist.io/rss.php?feed=dl&passkey=private';
  assert.equal(validateFilelistRssUrl(valid).hostname, 'filelist.io');
  for (const invalid of [
    'http://filelist.io/rss.php?passkey=private',
    'https://evil.test/rss.php?passkey=private',
    'https://filelist.io/other.php?passkey=private',
    'https://user:pass@filelist.io/rss.php?passkey=private'
  ]) assert.throws(() => validateFilelistRssUrl(invalid));
});
