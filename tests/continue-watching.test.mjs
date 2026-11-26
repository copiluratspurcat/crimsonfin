import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueWatchEntries } from '../web/src/continue-watching.ts';

test('only the most recently played episode survives, even when it is earlier in the series', () => {
  const episode = (id, show, index, date) => ({
    Id: id, Type: 'Episode', SeriesId: show, IndexNumber: index,
    UserData: { LastPlayedDate: date }
  });
  const e17 = episode('e17', 'baki', 17, '2026-11-26T08:00:00Z');
  const e13 = episode('e13', 'baki', 13, '2026-11-26T09:00:00Z');
  const other = episode('e1', 'another', 1);
  const next = episode('e18', 'baki', 18);
  assert.deepEqual(uniqueWatchEntries([e17, e13], [next, other]), [e13, other]);
});
