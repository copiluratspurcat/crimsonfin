import { createHash } from 'node:crypto';
import { isBlankCategory, isFilelistMediaCategory } from './filelist-categories.mjs';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  processEntities: true
});

export function validateFilelistRssUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'filelist.io' ||
      url.pathname !== '/rss.php' || url.username || url.password || url.hash ||
      !url.searchParams.has('passkey')) {
    throw new Error('Invalid FileList RSS configuration');
  }
  return url;
}

function safeTitle(value) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/passkey\s*[=:]\s*[^\s&]+/gi, '[redacted]')
    .trim().slice(0, 220);
}
const VIDEO_RELEASE = /(?:^|[\s._\-\[(])(?:2160p|1080[pi]|720p|576p|480p|4k|uhd|web[\s._-]?(?:dl|rip)|blu[\s._-]?ray|bdrip|brrip|dvd(?:rip|r)?|hdtv|hdrip|remux|[xh][\s._-]?26[45]|hevc|avc|s\d{1,2}(?:e\d{1,3})?)(?=$|[\s._\-\])])/i;
function normalized(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[._\-\[\]()]+/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function parseFilelistRss(xml, query, categories) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 2_000_000) {
    throw new Error('Invalid FileList RSS response');
  }
  const document = parser.parse(xml);
  const channel = document?.rss?.channel;
  if (!channel || !channel.item) return { configured: true, source: 'rss', results: [] };
  const entries = Array.isArray(channel.item) ? channel.item : [channel.item];
  const terms = normalized(query).split(' ').filter(Boolean);
  const categoriesOf = entry => (Array.isArray(entry?.category) ? entry.category : [entry?.category])
    .map(category => category?.['#text'] ?? category).filter(category => !isBlankCategory(category));
  // Feeds that never tag categories can't be filtered by category; for those, keep only
  // titles that carry video release tags (resolution, source, codec, season), so games,
  // software and similar uploads stay out. A specific category subset can't be enforced there.
  const feedHasCategories = entries.some(entry => categoriesOf(entry).length > 0);
  const results = entries.map(entry => {
    if (feedHasCategories && !categoriesOf(entry).some(category => isFilelistMediaCategory(category, categories))) return null;
    const name = safeTitle(entry?.title?.['#text'] ?? entry?.title);
    if (!feedHasCategories && !VIDEO_RELEASE.test(name)) return null;
    if (!name || !terms.every(term => normalized(name).includes(term))) return null;
    // Never return RSS enclosure URLs, GUIDs, or descriptions: they may contain
    // the private tracker passkey. Only sanitized public-facing title metadata.
    return {
      id: createHash('sha256').update(name).digest('hex').slice(0, 24),
      name, size: '', seeders: null, imdb: ''
    };
  }).filter(Boolean).slice(0, 35);
  return { configured: true, source: 'rss', results };
}
