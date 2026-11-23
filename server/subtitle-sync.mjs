import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const MAX_CAPTION_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 32;

export function createSubtitleSync(env) {
  const command = env.SUBTITLE_SYNC_COMMAND;
  const roots = [env.MEDIA_MOVIE_DIRS, env.MEDIA_SERIES_DIRS,
    '/mnt/ADATA/Movies,/mnt/ADATA/Shows,/mnt/ADATA/TV Shows,/mnt/WD1TBLU/movies,/mnt/WD1TBLU/shows']
    .filter(Boolean).flatMap(value => value.split(',').map(root => root.trim())).filter(root => path.isAbsolute(root));
  const cache = new Map();
  let busy = false;

  async function align(video, audioIndex, getOriginal) {
    const folder = await mkdtemp(path.join(tmpdir(), 'crimsonfin-sync-'));
    try {
      const original = path.join(folder, 'original.vtt');
      const input = path.join(folder, 'original.srt');
      const output = path.join(folder, 'aligned.srt');
      const aligned = path.join(folder, 'aligned.vtt');
      const response = await getOriginal();
      if (!response.ok || !response.body) return null;
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > MAX_CAPTION_BYTES) return null;
        chunks.push(chunk);
      }
      const captions = Buffer.concat(chunks);
      if (!/^\uFEFF?WEBVTT\b/u.test(captions.toString('utf8'))) return null;
      await writeFile(original, captions);
      const ffmpeg = ['-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file'];
      await run('ffmpeg', [...ffmpeg, '-i', original, input], { timeout: 15000 });
      await run(command, [video, '-i', input, '-o', output, '--reference-stream', String(audioIndex),
        '--max-offset-seconds', '12', '--skip-sync-on-low-quality'], { timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
      await run('ffmpeg', [...ffmpeg, '-i', output, aligned], { timeout: 15000 });
      if ((await stat(aligned)).size > MAX_CAPTION_BYTES) return null;
      const result = await readFile(aligned, 'utf8');
      return result.includes('-->') ? result : null;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  return async function sync(source, subtitleIndex, audioIndex, getOriginal) {
    if (!command || !path.isAbsolute(command) || !source || !path.isAbsolute(source.Path || '')) return { status: 204 };
    const subtitles = source.MediaStreams?.find(track => track.Type === 'Subtitle' && track.Index === subtitleIndex);
    const audio = source.MediaStreams?.find(track => track.Type === 'Audio' && track.Index === audioIndex);
    if (!subtitles || !audio) return { status: 204 };
    const video = await realpath(source.Path).catch(() => null);
    if (!video || !roots.some(root => video.startsWith(path.resolve(root) + path.sep))
      || !/\.(mkv|mp4|m4v|avi|webm)$/i.test(video)) return { status: 204 };
    const file = await stat(video).catch(() => null);
    if (!file?.isFile()) return { status: 204 };
    const key = createHash('sha256').update(JSON.stringify([
      video, file.mtimeMs, file.size, source.Id, subtitleIndex, subtitles.Path, audioIndex
    ])).digest('hex');
    const saved = cache.get(key);
    if (saved && saved.until > Date.now()) return saved;
    if (busy) return { status: 202 };
    busy = true;
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { status: 202, until: Infinity });
    void align(video, audioIndex, getOriginal).then(
      captions => cache.set(key, { status: captions ? 200 : 204, captions, until: Date.now() + (captions ? 1800000 : 120000) }),
      error => {
        console.warn('[subtitle sync] Alignment unavailable:', error.code || 'processing error');
        cache.set(key, { status: 204, until: Date.now() + 120000 });
      }
    ).finally(() => { busy = false; });
    return { status: 202 };
  };
}
