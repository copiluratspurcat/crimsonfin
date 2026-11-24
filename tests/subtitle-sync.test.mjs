import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { createSubtitleSync } from '../server/subtitle-sync.mjs';
import { spawnSync } from 'node:child_process';

test('automatic subtitle sync queues one job and serves corrected WebVTT', {
  // The fake aligner below is a #!/bin/sh script, which Windows cannot execute.
  skip: process.platform === 'win32' ? 'needs a POSIX shell for the fake aligner'
    : spawnSync('ffmpeg', ['-version']).status !== 0
}, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'crimsonfin-subtitle-test-'));
  try {
    const video = path.join(folder, 'video.mkv');
    const command = path.join(folder, 'align');
    await writeFile(video, '');
    await writeFile(command, `#!/bin/sh
[ "$6" = "--reference-stream" ] && [ "$7" = "2" ] || exit 1
sed "s/00:00:01,/00:00:03,/; s/00:00:02,/00:00:04,/" "$3" > "$5"
`, { mode: 0o700 });
    const sync = createSubtitleSync({ SUBTITLE_SYNC_COMMAND: command, MEDIA_MOVIE_DIRS: folder });
    const source = { Path: video, Id: 'test', MediaStreams: [
      { Type: 'Audio', Index: 2 }, { Type: 'Subtitle', Index: 3 }
    ] };
    let requests = 0;
    const original = () => {
      requests++;
      return new Response('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nTest dialogue\n');
    };
    assert.deepEqual(await sync(source, 3, 1, original), { status: 204 });
    assert.deepEqual(await sync(source, 3, 2, original), { status: 202 });
    let result;
    for (let i = 0; i < 100; i++) {
      result = await sync(source, 3, 2, original);
      if (result.status !== 202) break;
      await sleep(50);
    }
    assert.equal(result.status, 200);
    assert.match(result.captions, /00:03\.000 --> 00:04\.000/);
    assert.match(result.captions, /Test dialogue/);
    assert.equal(requests, 1);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
