import path from 'node:path';
import { createHash } from 'node:crypto';

// Parse only the untrusted bencoded torrent metadata, never execute or fetch
// anything from the torrent itself. A strict size/depth/item limit avoids DoS.
export function parseTorrentInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.length > 5_000_000) {
    throw new Error('Invalid torrent metadata');
  }
  let pos = 0, nodes = 0, infoBytes = null;
  function read(depth = 0) {
    if (++nodes > 120_000 || depth > 20 || pos >= buffer.length) throw new Error('Malformed torrent metadata');
    const lead = buffer[pos];
    if (lead === 0x69) { // i<n>e
      pos++;
      const end = buffer.indexOf(0x65, pos);
      if (end < 0 || end - pos > 20) throw new Error('Invalid torrent integer');
      const raw = buffer.toString('ascii', pos, end);
      if (!/^-?(0|[1-9]\d*)$/.test(raw)) throw new Error('Invalid torrent integer');
      pos = end + 1;
      const n = Number(raw);
      if (!Number.isSafeInteger(n)) throw new Error('Torrent integer out of range');
      return n;
    }
    if (lead === 0x6c) { // list
      pos++;
      const list = [];
      while (pos < buffer.length && buffer[pos] !== 0x65) list.push(read(depth + 1));
      if (pos >= buffer.length) throw new Error('Unclosed torrent list');
      pos++;
      return list;
    }
    if (lead === 0x64) { // dict
      pos++;
      const dict = Object.create(null);
      while (pos < buffer.length && buffer[pos] !== 0x65) {
        const key = read(depth + 1);
        if (!Buffer.isBuffer(key) || key.length > 180) throw new Error('Invalid torrent key');
        const name = key.toString('utf8');
        if (depth === 0 && name === 'info') {
          const start = pos;
          dict[name] = read(depth + 1);
          infoBytes = buffer.subarray(start,pos);
        } else dict[name] = read(depth + 1);
      }
      if (pos >= buffer.length) throw new Error('Unclosed torrent dictionary');
      pos++;
      return dict;
    }
    if (lead < 0x30 || lead > 0x39) throw new Error('Invalid torrent bencode');
    const colon = buffer.indexOf(0x3a, pos);
    if (colon < 0 || colon - pos > 10) throw new Error('Invalid torrent byte count');
    const n = Number(buffer.toString('ascii', pos, colon));
    if (!Number.isSafeInteger(n) || n < 0 || n > 5_000_000 || colon + 1 + n > buffer.length) {
      throw new Error('Oversized torrent byte string');
    }
    pos = colon + 1 + n;
    return buffer.subarray(colon + 1, pos);
  }
  const root = read();
  if (pos !== buffer.length || !root || !root.info || typeof root.info !== 'object') {
    throw new Error('Torrent missing info dictionary');
  }
  const info = root.info;
  const text = b => Buffer.isBuffer(b) ? b.toString('utf8') : '';
  const files = Array.isArray(info.files)
    ? info.files.map(f => Array.isArray(f?.path) ? f.path.map(text).join('/') : '')
    : [text(info.name)];
  return { rootName: text(info['name.utf-8'] || info.name), files,
    infoHash: infoBytes ? createHash('sha1').update(infoBytes).digest('hex') : '' };
}
const EXT = /\.(?:mkv|mp4|m4v|avi|webm|ts)$/i;
const EPISODE = /(?:^|[. _\-])s\d{1,2}[. _\-]?e\d{1,3}(?:\D|$)/i;
const SEASON = /(?:^|[. _\-])(?:s\d{1,2}|season[. _\-]?\d{1,2})(?:\D|$)/i;
const QUALITY = /(?:[. _\-](?:s\d{1,2}(?:e\d{1,3})?|season[. _\-]?\d+|19\d\d|20\d\d|2160p|1080p|720p|480p|x264|x265|h264|h265|hevc|web[-. ]?dl|bluray|nf|amzn|crunchyroll|multi|complete|complet|aac\d*|ddp\d*|dd\+\d*|repack|proper)(?:[. _\-]|$)).*/i;
const SOURCE = /^\s*(?:\[[^\]]{1,25}\]\s*)+/;
function safeTitle(raw) {
  const clean = String(raw || '').replace(SOURCE, '')
    .replace(/\([^)]*translated[^)]*\)/ig, '')
    .replace(QUALITY, '')
    .replace(/\s+-\s+(?:Complete|Complet)(?:\s+\[.*?\])?$/i, '')
    .replace(/[._]+/g, ' ').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ').replace(/[. \-]+$/g, '').trim().slice(0, 96);
  if (!clean || clean === '.' || clean === '..' || !/[\p{L}\p{N}]/u.test(clean)) {
    throw new Error('Cannot determine safe TV series folder name');
  }
  return clean;
}
export function classifyTorrent(torrent, releaseName = '', requestedKind = 'movie') {
  if (!['movie', 'series'].includes(requestedKind)) throw new Error('Invalid media type');
  const info = parseTorrentInfo(torrent);
  const videos = info.files.filter(f => EXT.test(f));
  const episodic = videos.filter(f => EPISODE.test(path.basename(f))).length;
  const numbered = videos.filter(f => /(?:^|[\s._-])(?:ep(?:isode)?[\s._-]?)?0?[1-9]\d?(?:[\s._-]|\[|\.)/i.test(path.basename(f))).length;
  const pack = SEASON.test(releaseName) || SEASON.test(info.rootName);
  // Detect series from episode filenames, season packs, or numbered anime packs
  // (do not reclassify ordinary two-movie bundles as TV).
  const isShow = episodic > 0 || (videos.length >= 2 && pack) ||
    (videos.length >= 3 && numbered >= 3 && /complete|complet|season|s\d{1,2}/i.test(info.rootName + ' ' + releaseName));
  const kind = isShow ? 'series' : requestedKind;
  let title = null;
  if (kind === 'series') {
    const candidate = releaseName || info.rootName;
    title = safeTitle(candidate);
  }
  const seasons = new Set();
  for (const filename of videos) {
    const match = filename.match(/(?:^|[._\/\s-])s(\d{1,2})[.\s_-]?e\d{1,3}(?:\D|$)/i);
    if (match) seasons.add(Number(match[1]));
  }
  if (!seasons.size && kind === 'series') {
    const packSeason = (releaseName + ' ' + info.rootName).match(/(?:^|[._\s-])s(\d{1,2})(?:[._\s-]|$)/i);
    seasons.add(packSeason ? Number(packSeason[1]) : 1);
  }
  return { kind, title, detectedSeries: isShow, videoFiles: videos.length,
    seasonNumber: seasons.size === 1 ? [...seasons][0] : null,
    multipleSeasons: seasons.size > 1 };
}
export function safeSeriesDestination(library, title) {
  const root = path.resolve(library);
  const name = safeTitle(title);
  const dest = path.resolve(root, name);
  if (path.dirname(dest) !== root) throw new Error('Unsafe TV series folder');
  return dest;
}
