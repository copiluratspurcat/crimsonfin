import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueWatchEntries } from '../web/src/continue-watching.ts';

test('resume entries win over identical Next Up episodes and alternate copies', () => {
  const resume = {
    Id: 'resume', Type: 'Episode', SeriesId: 'baki', ParentIndexNumber: 1,
    IndexNumber: 2, UserData: { PlaybackPositionTicks: 123456 }
  };
  const otherSeason = { ...resume, Id: 'season2', ParentIndexNumber: 2 };
  const otherSeries = { ...resume, Id: 'another', SeriesId: 'another' };
  const combined = { ...resume, Id: 'multi', IndexNumberEnd: 3 };
  const noMetadata = { Id: 'none', Type: 'Episode' };
  assert.deepEqual(uniqueWatchEntries([resume], [
    { ...resume, UserData: {} }, { ...resume, Id: 'copy' }, otherSeason, otherSeries, combined, noMetadata
  ]), [resume, otherSeason, otherSeries, combined, noMetadata]);
});
