import test from 'node:test';
import assert from 'node:assert/strict';
import { describeFileListName, bestSeedCount } from '../web/src/filelist-presentation.ts';

test('FileList names preserve numeric titles and distinguish episodes and quality', () => {
  assert.deepEqual(describeFileListName('1917.2019.2160p.BluRay.REMUX-GROUP'), {
    title: '1917', tags: ['2019', '4K', 'Blu-ray', 'Remux']
  });
  assert.deepEqual(describeFileListName('The.Show.S02E07.720p.WEB-DL-GROUP'), {
    title: 'The Show', tags: ['S02E07', '720p', 'WEB-DL']
  });
  assert.deepEqual(describeFileListName('Ordinary Title'), { title: 'Ordinary Title', tags: [] });
});

test('weak and unknown swarms never receive the best seeded badge', () => {
  assert.equal(bestSeedCount([{ seeders: 2 }, { seeders: null }]), null);
  assert.equal(bestSeedCount([{ seeders: 2 }, { seeders: 18 }, { seeders: 43 }]), 43);
});
