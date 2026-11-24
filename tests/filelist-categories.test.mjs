import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedFilelistCategories, isFilelistMediaCategory } from '../server/filelist-categories.mjs';
import { parseFilelistApiResults } from '../server/filelist-api.mjs';
import { parseFilelistRss } from '../server/filelist-rss.mjs';

test('animation (Desene) and documentaries (Docs) are media categories', () => {
  const all = allowedFilelistCategories('').split(',');
  assert.ok(all.includes('15') && all.includes('16'));
  assert.equal(isFilelistMediaCategory('Desene'), true);
  assert.equal(isFilelistMediaCategory('16'), true);
});

test('requested categories are trimmed, filtered, and malformed ids are rejected', () => {
  assert.equal(allowedFilelistCategories('4, 6'), '4,6');
  assert.equal(allowedFilelistCategories(' 4 ,4,'), '4');
  assert.equal(allowedFilelistCategories('7'), '');
  assert.throws(() => allowedFilelistCategories('abc'), error => error.status === 400);
  assert.throws(() => allowedFilelistCategories('4,1x'), error => error.status === 400);
});

test('API rows with a blank category are kept like rows without one', () => {
  const parsed = parseFilelistApiResults([
    { id: 42, name: 'Film.2026.1080p', category: '' },
    { id: 43, name: 'Film.2026.720p', category: '   ' },
    { id: 44, name: 'Some.Game', category: '9' }
  ], allowedFilelistCategories(''));
  assert.deepEqual(parsed.results.map(r => r.id), ['42', '43']);
});

test('RSS feeds without category tags are searchable; mixed feeds still drop untagged items', () => {
  const untagged = '<rss><channel><item><title>Inside.Out.2.2024.1080p</title></item>' +
    '<item><title>Inside.Job.S01.720p</title><category></category></item></channel></rss>';
  assert.equal(parseFilelistRss(untagged, 'inside out').results.length, 1);
  assert.equal(parseFilelistRss(untagged, 'inside').results.length, 2);
  const mixed = '<rss><channel><item><title>Inside.Out.2.2024.1080p</title><category>Desene</category></item>' +
    '<item><title>Inside.Unknown</title></item><item><title>Inside.Game</title><category>9</category></item></channel></rss>';
  assert.deepEqual(parseFilelistRss(mixed, 'inside').results.map(r => r.name), ['Inside.Out.2.2024.1080p']);
});

test('untagged RSS feeds keep only video releases', () => {
  const feed = '<rss><channel>' + ['Inside.Out.2.2024.1080p.WEB-DL', 'Inside.Job.S01E02.HDTV.x264',
    'Inside.Game.v1.2-CODEX', 'Inside.Software.Pro.2026.Multilingual', 'Inside.OST.FLAC']
    .map(t => `<item><title>${t}</title></item>`).join('') + '</channel></rss>';
  assert.deepEqual(parseFilelistRss(feed, 'inside').results.map(r => r.name),
    ['Inside.Out.2.2024.1080p.WEB-DL', 'Inside.Job.S01E02.HDTV.x264']);
});
