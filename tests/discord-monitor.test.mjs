import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboard, newLibraryItems } from '../server/discord-monitor.mjs';

test('library announcements exclude previously seen and duplicated entries', () => {
  const items = [{ Id: 'newer' }, { Id: 'newer' }, { Id: 'older' }, { Id: 'seen' }];
  assert.deepEqual(newLibraryItems(items, ['seen']), [{ Id: 'older' }, { Id: 'newer' }]);
});

test('status message distinguishes an outage from an empty download queue', () => {
  const data = { running: '2.5.2', latest: '2.5.3', downloads: [], libraryAvailable: true };
  assert.match(dashboard({ ...data, online: false }).embeds[0].description, /v2\.5\.2 \(last seen\)/);
  assert.match(dashboard({ ...data, online: true }).embeds[0].description, /No active downloads/);
  assert.match(dashboard({ ...data, online: true, downloads: null }).embeds[0].description, /Download service unavailable/);
  const active = [{ name: 'Test *Movie*', state: 'downloading', progress: 48.1, downloadSpeedBytes: 1048576, etaSeconds: 120 }];
  assert.match(dashboard({ ...data, online: true, downloads: active }).embeds[0].description, /48%.*1\.0 MiB\/s.*ETA 2 min/);
});
