// Mock CrimsonFin gateway for UI work and browser tests: serves the built app (dist/) with fake
// library data, so no Jellyfin server, account or media is needed. State (watched, favourites,
// Continue watching) lives in memory and resets on restart. Always signed in as an admin.
//
//   npm run build && npm run mock            -> http://127.0.0.1:8123
//   node tools/mock-server.mjs [dist] [art] [port]
//
// Extra endpoint: GET /__hits returns (and clears) the /api/library page requests seen so far.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export function createMockServer({ dist = path.join(ROOT, 'dist'), art = path.join(HERE, 'mock-art') } = {}) {
  const DIST = dist, IMG = art;
  const T = 600_000_000; // ticks per minute
  const id = n => n.toString(16).padStart(32, '0');
  const mk = (n, Name, Type, img, extra = {}) => ({ Id: id(n), Name, Type, _img: img, ImageTags: { Primary: 'x' }, ...extra });
  const movies = [
    mk(1, 'The Harbour at Night', 'Movie', 'harbour', { ProductionYear: 2019, CommunityRating: 8.4, RunTimeTicks: 118 * T, Genres: ['Drama', 'Mystery'], Overview: 'A ferry inspector returns to the town that drowned his brother, and finds the night shift still running on the old timetable.' }),
    mk(2, 'Neon Hours', 'Movie', 'neon', { ProductionYear: 2022, CommunityRating: 7.1, RunTimeTicks: 104 * T, Genres: ['Thriller'], UserData: { IsFavorite: true } }),
    mk(3, 'Red Country', 'Movie', 'canyon', { ProductionYear: 2016, CommunityRating: 7.6, RunTimeTicks: 131 * T, Genres: ['Western'], UserData: { Played: true } }),
    mk(4, 'Long Distance', 'Movie', 'kitchen', { ProductionYear: 1977, CommunityRating: 7.9, RunTimeTicks: 96 * T, Genres: ['Drama'] }),
    mk(5, 'The Keeper', 'Movie', 'lighthouse', { ProductionYear: 2019, CommunityRating: 6.9, RunTimeTicks: 109 * T, Genres: ['Drama'] }),
    mk(6, 'Paper Moon Motel', 'Movie', 'motel', { ProductionYear: 1998, CommunityRating: 7.6, RunTimeTicks: 111 * T, Genres: ['Road', 'Drama'], UserData: { PlaybackPositionTicks: 73 * T, PlayedPercentage: 65, IsFavorite: true } }),
    mk(7, 'Glass Orchard', 'Movie', 'orchard', { ProductionYear: 2017, CommunityRating: 7.2, RunTimeTicks: 124 * T, Genres: ['Drama'] }),
    mk(8, 'Our Man in Constanța', 'Movie', 'none', { ProductionYear: 2011, RunTimeTicks: 106 * T, Genres: ['Comedy'], ImageTags: {} }),
    mk(9, 'Rain Check', 'Movie', 'neon', { ProductionYear: 2021, RunTimeTicks: 93 * T, Genres: ['Romance'] }),
    mk(10, 'Dry Season', 'Movie', 'canyon', { ProductionYear: 2008, RunTimeTicks: 99 * T, Genres: ['Western'] }),
    mk(11, 'Cold Front', 'Movie', 'lighthouse', { ProductionYear: 2023, RunTimeTicks: 88 * T, Genres: ['Documentary'] }),
    mk(12, 'Party Line', 'Movie', 'kitchen', { ProductionYear: 1981, RunTimeTicks: 91 * T, Genres: ['Comedy'] }),
    mk(13, 'Low Water', 'Movie', 'harbour', { ProductionYear: 2015, RunTimeTicks: 102 * T, Genres: ['Drama'] }),
    mk(14, 'Vacancy', 'Movie', 'motel', { ProductionYear: 2003, RunTimeTicks: 97 * T, Genres: ['Thriller'] }),
  ];
  const series = [
    mk(101, 'Northbound', 'Series', 'train', { ProductionYear: 2020, CommunityRating: 7.9, Genres: ['Thriller'], ChildCount: 2, UserData: { IsFavorite: true }, Overview: 'A night train leaves Bucharest for the Arctic with forty passengers and one more name on the manifest than there are seats.' }),
    mk(102, 'The Lighthouse Keeper', 'Series', 'harbour', { ProductionYear: 2019, CommunityRating: 8.1, Genres: ['Mystery'], ChildCount: 2 }),
    mk(103, 'A Quiet Census', 'Series', 'lighthouse', { ProductionYear: 2018, Genres: ['Drama'], ChildCount: 3 }),
    mk(104, 'Afterhours', 'Series', 'neon', { ProductionYear: 2023, Genres: ['Crime'], ChildCount: 1 }),
    mk(105, 'Border Country', 'Series', 'canyon', { ProductionYear: 2021, Genres: ['Western'], ChildCount: 1 }),
    mk(106, 'Call Waiting', 'Series', 'kitchen', { ProductionYear: 1979, Genres: ['Comedy'], ChildCount: 4 }),
  ];
  const ep = (n, sid, s, e, Name, img, extra = {}) => mk(n, Name, 'Episode', img, { SeriesId: id(sid), SeriesName: series.find(x => x.Id === id(sid)).Name, ParentIndexNumber: s, IndexNumber: e, RunTimeTicks: 55 * T, Overview: 'A conductor finds a compartment that isn’t on any plan, and someone has been sleeping in it.', ...extra });
  const episodes = [
    ep(201, 101, 1, 1, 'Departure', 'train', { UserData: { Played: true } }),
    ep(202, 101, 1, 2, 'The Seventh Carriage', 'train', { RunTimeTicks: 58 * T, UserData: { PlaybackPositionTicks: 19 * T, PlayedPercentage: 33 } }),
    ep(203, 101, 1, 3, 'Border at Night', 'train'), ep(204, 101, 1, 4, 'Whiteout', 'train'),
  ];
  const resume = [
    ep(301, 102, 2, 5, 'Ferry Clock', 'harbour', { UserData: { PlaybackPositionTicks: 42 * T, PlayedPercentage: 73 } }),
    movies[5], episodes[1],
  ];
  const nextup = [ep(302, 102, 2, 6, 'Census of the Drowned', 'harbour'), ep(303, 105, 1, 4, 'Dust', 'canyon')];
  // Pad the movie library past the old 150-title cap to exercise paging.
  const pics = ['harbour', 'motel', 'train', 'orchard', 'lighthouse', 'neon', 'canyon', 'kitchen'];
  const extraMovies = Array.from({ length: 236 }, (_, i) => mk(1000 + i, `Archive Film ${String(i + 1).padStart(3, '0')}`, 'Movie', pics[i % 8],
    { ProductionYear: 1950 + (i % 70), RunTimeTicks: (85 + (i % 50)) * T, Genres: [['Drama', 'Comedy', 'Thriller', 'Western'][i % 4]] }));
  const libraryHits = [];
  const all = [...movies, ...extraMovies, ...series, ...episodes, ...resume, ...nextup];
  const page = Items => ({ Items, TotalRecordCount: Items.length });
  const requests = [
    { id: 'r1', user_name: 'ana', title: 'Dune: Part Two', kind: 'movie', year: 2024, notes: '', status: 'approved', created_at: Date.now() - 2 * 864e5, download_state: 'downloading', release_name: 'Dune.Part.Two.2024.2160p.WEB-DL' },
    { id: 'r2', user_name: 'mihai', title: 'Severance', kind: 'series', notes: 'Season 2', status: 'pending', created_at: Date.now() - 3 * 864e5 },
    { id: 'r3', user_name: 'guest', title: 'Past Lives', kind: 'movie', year: 2023, notes: '', status: 'fulfilled', created_at: Date.now() - 7 * 864e5 },
    { id: 'r4', user_name: 'guest', title: 'Anatomy of a Fall', kind: 'movie', year: 2023, notes: '', status: 'approved', created_at: Date.now() - 864e5, download_state: 'needs_review', download_detail: 'Several releases match; choose one.' },
    { id: 'r5', user_name: 'ana', title: 'Cats', kind: 'movie', year: 2019, notes: '', status: 'rejected', created_at: Date.now() - 14 * 864e5 },
  ];
  const TB = 1024 ** 4, GB = 1024 ** 3;
  const downloads = { online: true, active: 2, drives: [
    { id: 'a', name: 'ADATA', totalBytes: 4 * TB, freeBytes: 1.21 * TB, movieFolder: '/mnt/ADATA/Movies', seriesFolder: null },
    { id: 'b', name: 'WD Red', totalBytes: 6 * TB, freeBytes: 0.64 * TB, movieFolder: null, seriesFolder: '/mnt/WD/Shows' }],
    downloads: [
      { hash: 'h1', name: 'Dune.Part.Two.2024.2160p.WEB-DL', state: 'downloading', progress: 64.2, sizeBytes: 21.6 * GB, downloadedBytes: 13.9 * GB, remainingBytes: 7.7 * GB, downloadSpeedBytes: 12.4 * 1024 ** 2, uploadSpeedBytes: 1.1 * 1024 ** 2, etaSeconds: 480, drive: 'ADATA', folder: '/mnt/ADATA/Movies', seeding: false },
      { hash: 'h2', name: 'Severance.S02.1080p.WEB-DL', state: 'queuedDL', progress: 0, sizeBytes: 18.3 * GB, downloadedBytes: 0, remainingBytes: 18.3 * GB, downloadSpeedBytes: 0, uploadSpeedBytes: 0, etaSeconds: null, drive: 'WD Red', folder: '/mnt/WD/Shows', seeding: false }] };
  const details = item => ({ ...item, MediaSources: [{ Id: id(999), MediaStreams: [
    { Type: 'Video', DisplayTitle: '4K HDR · HEVC' }, { Type: 'Audio', DisplayTitle: 'English 5.1' }, { Type: 'Audio', DisplayTitle: 'Romanian 2.0' },
    { Type: 'Subtitle', DisplayTitle: 'Romanian', Index: 3, Language: 'rum', Codec: 'srt' }, { Type: 'Subtitle', DisplayTitle: 'English', Index: 4, Language: 'eng', Codec: 'srt' }] }] });

  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  if (!existsSync(path.join(DIST, 'index.html'))) throw new Error('No built app in ' + DIST + ': run npm run build first');
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    const img = p.match(/^\/jellyfin\/Items\/(\w+)\/Images\/(\w+)/);
    if (img) {
      const item = all.find(i => i.Id === img[1]);
      const file = item && item._img !== 'none' && path.join(IMG, item._img + '.jpg');
      if (!file || !existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' }); return res.end(readFileSync(file));
    }
    if (p === '/api/health') return json(res, 200, { ok: true });
    if (p === '/api/auth/me') return json(res, 200, { user: { id: 'u', name: 'guest', isAdmin: true }, titleTranslations: true });
    if (p === '/api/library') {
      const q = url.searchParams, t = q.get('type');
      let list = t === 'series' ? series : t === 'all' ? [...movies, ...extraMovies, ...series] : [...movies, ...extraMovies];
      if (q.get('genre')) list = list.filter(i => i.Genres?.includes(q.get('genre')));
      if (q.get('filter') === 'favorite') list = list.filter(i => i.UserData?.IsFavorite);
      if (q.get('filter') === 'played') list = list.filter(i => i.UserData?.Played);
      if (q.get('sort') === 'name') list = [...list].sort((a, b) => a.Name.localeCompare(b.Name));
      if (q.get('sort') === 'year') list = [...list].sort((a, b) => (b.ProductionYear || 0) - (a.ProductionYear || 0));
      const start = Number(q.get('start') || 0), limit = Number(q.get('limit') || 60);
      libraryHits.push(`${t}:${start}+${limit}`);
      return json(res, 200, { Items: list.slice(start, start + limit), TotalRecordCount: list.length });
    }
    if (p === '/api/genres') { const src = url.searchParams.get('type') === 'series' ? series : [...movies, ...extraMovies]; return json(res, 200, { genres: [...new Set(src.flatMap(i => i.Genres || []))].sort() }); }
    if (p === '/__hits') { const h = [...libraryHits]; libraryHits.length = 0; return json(res, 200, h); }
    if (p === '/api/continue') return json(res, 200, page(resume));
    if (p === '/api/nextup') return json(res, 200, page(nextup));
    if (p === '/api/search') { const q = (url.searchParams.get('q') || '').toLowerCase(); return json(res, 200, page([...movies, ...series].filter(i => i.Name.toLowerCase().includes(q)))); }
    let m;
    if ((m = p.match(/^\/api\/items\/(\w+)\/titles$/))) {
      return json(res, 200, m[1] === movies[0].Id ? { en: movies[0].Name, ro: 'Portul noaptea' } : {});
    }
    if ((m = p.match(/^\/api\/items\/(\w+)\/segments$/))) return json(res, 200, { intro: { start: 0, end: 75 }, credits: { start: 3000, end: 3300 } });
    if ((m = p.match(/^\/api\/items\/(\w+)\/(played|progress|favorite)$/))) {
      for (const it of all.filter(i => i.Id === m[1])) {
        it.UserData = { ...(it.UserData || {}) };
        if (m[2] === 'progress') { it.UserData.PlaybackPositionTicks = 0; it.UserData.PlayedPercentage = 0; }
        if (m[2] === 'played') { it.UserData.Played = req.method === 'POST'; if (it.UserData.Played) { it.UserData.PlaybackPositionTicks = 0; it.UserData.PlayedPercentage = 0; } }
        if (m[2] === 'favorite') it.UserData.IsFavorite = req.method === 'POST';
      }
      for (let i = resume.length - 1; i >= 0; i--) if (!resume[i].UserData?.PlaybackPositionTicks) resume.splice(i, 1);
      return json(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/items\/(\w+)$/))) return json(res, 200, details(all.find(i => i.Id === m[1]) || movies[0]));
    if ((m = p.match(/^\/api\/series\/(\w+)\/seasons$/))) return json(res, 200, page([{ Id: id(501), Name: 'Season 1', Type: 'Season' }, { Id: id(502), Name: 'Season 2', Type: 'Season' }]));
    if ((m = p.match(/^\/api\/series\/(\w+)\/episodes$/))) return json(res, 200, page(episodes));
    if (p === '/api/requests') return json(res, 200, { requests });
    if (p === '/api/admin/status') return json(res, 200, { jellyfinReachable: true, filelistConfigured: true, pendingRequests: 1 });
    if (p === '/api/admin/filelist/settings') return json(res, 200, { apiConfigured: true, rssConfigured: true, rssPasskeyAvailable: true, username: 'guest', downloaderConfigured: true });
    if (p === '/api/admin/subtitles/status') return json(res, 200, { enabled: true, summary: { checked: 1284, haveRomanian: 1168, possiblyMissing: 116, attempted: 40, installed: 12, lastScanUtc: new Date().toISOString() } });
    if (p === '/api/admin/downloads') return json(res, 200, downloads);
    if (p.startsWith('/api/')) return json(res, 404, { error: 'mock: not found' });
    let file = path.join(DIST, p === '/' ? 'index.html' : p);
    if (!existsSync(file) || !statSync(file).isFile()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , dist, art, port = '8123'] = process.argv;
  createMockServer({ dist: dist && path.resolve(dist), art: art && path.resolve(art) })
    .listen(Number(port), '127.0.0.1', () => console.log('CrimsonFin mock gateway on http://127.0.0.1:' + port));
}
