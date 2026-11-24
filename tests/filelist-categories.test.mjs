import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedFilelistCategories, isFilelistMediaCategory } from '../server/filelist-categories.mjs';
import { parseFilelistApiResults } from '../server/filelist-api.mjs';
import { parseFilelistRss } from '../server/filelist-rss.mjs';

test('default search excludes separate Desene and Docs categories', () => {
  const all = allowedFilelistCategories('').split(',');
  assert.ok(!all.includes('15') && !all.includes('16'));
  assert.equal(isFilelistMediaCategory('Desene'), false);
  assert.equal(isFilelistMediaCategory('16'), false);
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

test('RSS results require an allowed category', () => {
  const untagged = '<rss><channel><item><title>Inside.Out.2.2024.1080p</title></item>' +
    '<item><title>Inside.Job.S01.720p</title><category></category></item></channel></rss>';
  assert.equal(parseFilelistRss(untagged, 'inside out').results.length, 0);
  assert.equal(parseFilelistRss(untagged, 'inside').results.length, 0);
  const mixed = '<rss><channel><item><title>Inside.Out.2.2024.1080p</title><category>Filme HD</category></item>' +
    '<item><title>Inside.Unknown</title></item><item><title>Inside.Game</title><category>9</category></item></channel></rss>';
  assert.deepEqual(parseFilelistRss(mixed, 'inside').results.map(r => r.name), ['Inside.Out.2.2024.1080p']);
});

test('English labels from the live API map to the same allowed category IDs', () => {
  const labels = ['Movies 4K', 'Movies HD', 'Movies Blu-Ray', 'Movies HD-RO',
    'Movies 4K Blu-Ray', 'Movies SD', 'TV-Series HD', 'TV-Series SD', 'Anime',
    'Games', 'Documentaries', 'Movies Other'];
  const rows = labels.map((category, index) => ({ id: index + 1, name: 'Release ' + index, category }));
  assert.deepEqual(parseFilelistApiResults(rows).results.map(row => row.category), labels.slice(0, 9));
  assert.deepEqual(parseFilelistApiResults(rows, '21').results.map(row => row.category), ['TV-Series HD']);
});
