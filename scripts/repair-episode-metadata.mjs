import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const env = Object.fromEntries(readFileSync(resolve(ROOT, '.env'), 'utf8')
  .split(/\r?\n/).filter(line => /^[_A-Z][_A-Z0-9]*=/.test(line))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const apply = process.argv.includes('--apply');
const maxUpdates = 100;
const apiKey = env.JELLYFIN_METADATA_API_KEY;
if (!apiKey) { console.error('Dedicated Jellyfin metadata API key is not configured'); process.exit(1); }
const base = new URL(env.JELLYFIN_URL || 'http://127.0.0.1:8096');
if (!['127.0.0.1', 'localhost', '::1'].includes(base.hostname)) {
  console.error('Metadata writes require the Jellyfin upstream on local loopback');
  process.exit(1);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
const auth = `MediaBrowser Client="CrimsonFinMetadata", Device="Server", DeviceId="crimsonfin-episode-metadata", Version="2.0.0", Token="${apiKey}"`;
async function jf(pathname, options = {}) {
  const response = await fetch(new URL(pathname, base), {
    ...options, headers: { authorization: auth, accept: 'application/json', ...options.headers },
    redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Jellyfin HTTP ' + response.status);
  if (response.status === 204) return null;
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}
async function tvmaze(pathname) {
  const url = new URL(pathname, 'https://api.tvmaze.com');
  if (url.hostname !== 'api.tvmaze.com') throw new Error('Unexpected metadata provider host');
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'CrimsonFin-Metadata/2.0' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Episode metadata provider HTTP ' + response.status);
  return response.json();
}
function normalized(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '').toLowerCase();
}
function incomplete(name, count) {
  const title = String(name || '').trim();
  return !title || /^episode[\s.\-_]*(?:\d+|unknown)?$/i.test(title) ||
    /^(?:Netflix|Netflix Rip|Pray for nZk|H\.264\/AVC Video|Unknown|Untitled|WEB[- ]?Rip|WEB[- ]?DL|BDRip)$/i.test(title) ||
    count >= 2;
}
const users = await jf('/Users');
const admin = Array.isArray(users) ? users.find(x => x.Policy?.IsAdministrator) : null;
if (!admin) throw new Error('No Jellyfin admin account available to the metadata service');
const response = await jf(`/Users/${admin.Id}/Items?Recursive=true&IncludeItemTypes=Episode&Limit=10000&Fields=ProviderIds,Path`);
const episodes = response?.Items || [];
const groups = new Map();
for (const ep of episodes) {
  if (!ep.SeriesId || !Number.isInteger(ep.IndexNumber) || !Number.isInteger(ep.ParentIndexNumber)) continue;
  const group = groups.get(ep.SeriesId) || [];
  group.push(ep);
  groups.set(ep.SeriesId, group);
}
const proposed = [];
let reviewed = 0, unmatched = 0, failed = 0;
for (const [seriesId, group] of groups) {
  const repeated = new Map();
  for (const ep of group) {
    const key = `${ep.ParentIndexNumber}:${normalized(ep.Name)}`;
    repeated.set(key, (repeated.get(key) || 0) + 1);
  }
  const bad = group.filter(ep => incomplete(ep.Name, repeated.get(`${ep.ParentIndexNumber}:${normalized(ep.Name)}`) || 0));
  if (!bad.length) continue;
  let show;
  try { show = await jf('/Users/' + admin.Id + '/Items/' + seriesId); } catch { failed++; continue; }
  const tvdbId = show?.ProviderIds?.Tvdb;
  if (!/^\d{1,10}$/.test(String(tvdbId || ''))) { unmatched += bad.length; continue; }
  try {
    const remoteShow = await tvmaze('/lookup/shows?thetvdb=' + encodeURIComponent(tvdbId));
    if (!remoteShow || normalized(remoteShow.name) !== normalized(show.Name)) { unmatched += bad.length; continue; }
    await sleep(300);
    const online = await tvmaze('/shows/' + remoteShow.id + '/episodes');
    if (!Array.isArray(online)) { unmatched += bad.length; continue; }
    const indexed = new Map(online.filter(e => e.season && e.number && e.name)
      .map(e => [e.season + ':' + e.number, String(e.name).trim()]));
    const localSorted = group.filter(e => e.ParentIndexNumber > 0 && e.IndexNumber > 0)
      .sort((a, b) => a.ParentIndexNumber - b.ParentIndexNumber || a.IndexNumber - b.IndexNumber);
    const remoteSorted = online.filter(e => e.season > 0 && e.number > 0 && e.name)
      .sort((a, b) => a.season - b.season || a.number - b.number);
    const matchesInPlace = localSorted.reduce((n, e) =>
      n + Number(normalized(e.Name) === normalized(indexed.get(e.ParentIndexNumber + ':' + e.IndexNumber))), 0);
    const matchesInOrder = localSorted.reduce((n, e, i) =>
      n + Number(normalized(e.Name) === normalized(remoteSorted[i]?.name)), 0);
    const useAbsoluteOrder = localSorted.length === remoteSorted.length &&
      matchesInOrder >= 3 && matchesInOrder > matchesInPlace + 2;
    const aligned = new Map(useAbsoluteOrder
      ? localSorted.map((e, i) => [e.Id, String(remoteSorted[i]?.name || '').trim()])
      : []);
    for (const ep of bad) {
      const title = (useAbsoluteOrder ? aligned.get(ep.Id) : indexed.get(ep.ParentIndexNumber + ':' + ep.IndexNumber));
      if (!title || title.length > 180 || normalized(title) === normalized(ep.Name)) continue;
      proposed.push({ id: ep.Id, show: show.Name, season: ep.ParentIndexNumber, episode: ep.IndexNumber,
        before: ep.Name, after: title });
    }
    reviewed++;
  } catch (error) {
    failed++;
    console.warn('Metadata provider unavailable:', error.name, String(error.message).slice(0,120), error.cause?.code || '');
  }
  await sleep(350);
}
const changes = proposed.slice(0, maxUpdates);
console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', episodesScanned: episodes.length,
  seriesReviewed: reviewed, unmatched, lookupFailures: failed, proposed: proposed.length,
  limit: maxUpdates, samples: changes.slice(0, 12).map(x => ({show:x.show,season:x.season,
    episode:x.episode, before:x.before, after:x.after})) }, null, 2));
if (!apply || !changes.length) process.exit(0);
const backups = [];
for (const p of changes) {
  const full = await jf('/Users/' + admin.Id + '/Items/' + p.id);
  if (!full || full.Type !== 'Episode' || full.Name !== p.before) continue;
  backups.push({ id: p.id, old: full, newName: p.after });
}
if (!backups.length) process.exit(0);
const dir = resolve(ROOT, 'data', 'metadata-backups');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const backupFile = resolve(dir, 'episode-names-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
writeFileSync(backupFile, JSON.stringify({created: new Date().toISOString(), backups}, null, 2),
  { mode: 0o600, flag: 'wx' });
let changed = 0, rejected = 0;
for (const entry of backups) {
  try {
    const body = { ...entry.old, Name: entry.newName };
    await jf('/Items/' + entry.id, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const check = await jf('/Users/' + admin.Id + '/Items/' + entry.id);
    if (check.Name === entry.newName) changed++; else rejected++;
  } catch { rejected++; }
}
console.log('Jellyfin episodes updated:', changed, 'rejected:', rejected, 'backup stored privately.');
if (rejected) process.exitCode = 1;
