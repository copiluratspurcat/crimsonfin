import { createHash } from 'node:crypto';
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
function normalized(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[._\-\[\]()]+/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function parseFilelistRss(xml, query) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 2_000_000) {
    throw new Error('Invalid FileList RSS response');
  }
  const document = parser.parse(xml);
  const channel = document?.rss?.channel;
  if (!channel || !channel.item) return { configured: true, source: 'rss', results: [] };
  const entries = Array.isArray(channel.item) ? channel.item : [channel.item];
  const terms = normalized(query).split(' ').filter(Boolean);
  const results = entries.map(entry => {
    const name = safeTitle(entry?.title?.['#text'] ?? entry?.title);
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
