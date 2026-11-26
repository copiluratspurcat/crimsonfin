import assert from 'node:assert/strict';
import test from 'node:test';
import { createTitleTranslations } from '../server/title-translations.mjs';

test('title translations keep movie and show IDs separate and reuse in-flight requests', async () => {
  const calls = [];
  const translations = createTitleTranslations('test-token', async url => {
    calls.push(url);
    return Response.json({ translations: { translations: [
      { iso_639_1: 'en', iso_3166_1: 'US', data: { title: 'The Harbour', name: 'Northbound' } },
      { iso_639_1: 'ro', iso_3166_1: 'RO', data: { title: ' Portul ' } }
    ] } });
  });
  const ids = { ProviderIds: { Tmdb: '42' } };
  const movie = { ...ids, Type: 'Movie' };
  const expected = { en: 'The Harbour', ro: 'Portul' };
  assert.deepEqual(await Promise.all([translations(movie), translations(movie)]), [expected, expected]);
  assert.deepEqual(await translations({ ...ids, Type: 'Series' }), { en: 'Northbound' });
  assert.deepEqual(await translations({ Type: 'Movie' }), {});
  assert.deepEqual(calls, [
    'https://api.themoviedb.org/3/movie/42?language=en-US&append_to_response=translations',
    'https://api.themoviedb.org/3/tv/42?language=en-US&append_to_response=translations'
  ]);
});


test('blank English translation uses the English original name without replacing Romanian', async () => {
  const lookup = createTitleTranslations('test-token', async () => Response.json({
    original_language: 'en',
    original_title: 'Dune: Part Two',
    translations: { translations: [
      { iso_639_1: 'en', iso_3166_1: 'US', data: { title: '' } },
      { iso_639_1: 'ro', iso_3166_1: 'RO', data: { title: 'Dune: Partea II' } }
    ] }
  }));
  assert.deepEqual(await lookup({ Type: 'Movie', ProviderIds: { Tmdb: '693134' } }),
    { en: 'Dune: Part Two', ro: 'Dune: Partea II' });
});
