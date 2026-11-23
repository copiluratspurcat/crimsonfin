const FILELIST_API = 'https://filelist.io/api.php';

export function buildFilelistApiUrl(query, category = '') {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) {
    throw new Error('Invalid FileList search query');
  }
  const u = new URL(FILELIST_API);
  u.searchParams.set('action', 'search-torrents');
  u.searchParams.set('type', /^tt\d{6,10}$/.test(query.trim()) ? 'imdb' : 'name');
  u.searchParams.set('query', query.trim());
  u.searchParams.set('output', 'json');
  if (category) {
    if (!/^\d{1,3}(,\d{1,3})*$/.test(category)) throw new Error('Invalid categories');
    u.searchParams.set('category', category);
  }
  return u;
}

export function privateDownloadUrl(link) {
  if (typeof link !== 'string') return null;
  try {
    const u = new URL(link);
    if (u.protocol !== 'https:' || u.hostname !== 'filelist.io' ||
        !/^\/download(?:\.php|\/[\w.-]+)$/.test(u.pathname) ||
        u.username || u.password || u.hash) return null;
    return u;
  } catch { return null; }
}

export function parseFilelistApiResults(data) {
  const list = Array.isArray(data) ? data :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.torrents) ? data.torrents :
    Array.isArray(data?.results) ? data.results : [];
  const results = [], links = new Map();
  for (const item of list.slice(0, 70)) {
    const id = String(item?.id ?? '');
    const name = String(item?.name || item?.title || '').trim();
    if (!/^\d{1,12}$/.test(id) || !name || name.length > 230) continue;
    results.push({
      id, name: name.slice(0, 220),
      size: String(item.size || '').slice(0, 80),
      seeders: Number.isFinite(Number(item.seeders)) ? Number(item.seeders) : null,
      leechers: Number.isFinite(Number(item.leechers)) ? Number(item.leechers) : null,
      category: String(item.category ?? '').slice(0, 20),
      imdb: String(item.imdb || '').slice(0, 40),
      downloadable: Boolean(privateDownloadUrl(item.download_link))
    });
    const download = privateDownloadUrl(item.download_link);
    if (download) links.set(id, download.href);
    if (results.length >= 35) break;
  }
  return { results, links };
}
