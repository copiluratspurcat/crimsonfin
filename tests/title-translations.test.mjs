import assert from 'node:assert/strict';
import test from 'node:test';
import { createTitleTranslations } from '../server/title-translations.mjs';

test('title translations keep movie and show IDs separate and reuse in-flight requests', async () => {
  const calls = [];
  const translations = createTitleTranslations('test-token', async url => {
    calls.push(url);
    return Response.json({ translations: [
      { iso_639_1: 'en', iso_3166_1: 'US', data: { title: 'The Harbour', name: 'Northbound' } },
      { iso_639_1: 'ro', iso_3166_1: 'RO', data: { title: ' Portul ' } }
    ] });
  });
  const ids = { ProviderIds: { Tmdb: '42' } };
  const movie = { ...ids, Type: 'Movie' };
  const expected = { en: 'The Harbour', ro: 'Portul' };
  assert.deepEqual(await Promise.all([translations(movie), translations(movie)]), [expected, expected]);
  assert.deepEqual(await translations({ ...ids, Type: 'Series' }), { en: 'Northbound' });
  assert.deepEqual(await translations({ Type: 'Movie' }), {});
  assert.deepEqual(calls, [
    'https://api.themoviedb.org/3/movie/42/translations',
    'https://api.themoviedb.org/3/tv/42/translations'
  ]);
});
