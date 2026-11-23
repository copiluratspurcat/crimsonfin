import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Player } from './player';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Clapperboard, Clock3, Film, Heart, Home, LogOut, Maximize, Menu, MonitorPlay, Pause, Play, Plus, Search, Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Tv2, Volume2, X } from 'lucide-react';
import './styles.css';

type Account = { id: string; name: string; isAdmin: boolean };
type Item = { ImageTags?: { Primary?: string; Thumb?: string }; Id: string; Name: string; Type: string; Overview?: string; ProductionYear?: number; CommunityRating?: number; RunTimeTicks?: number; Genres?: string[]; UserData?: { IsFavorite?: boolean; PlaybackPositionTicks?: number; PlayedPercentage?: number; Played?: boolean }; IndexNumber?: number; ParentIndexNumber?: number; SeriesName?: string; MediaSources?: { Container?: string; MediaStreams?: { Codec?: string; Type?: string; DisplayTitle?: string }[] }[] };
type PageResult = { Items: Item[]; TotalRecordCount: number };
type RequestEntry = { id: string; user_name: string; title: string; kind: 'movie' | 'series'; year?: number; notes: string; status: 'pending' | 'approved' | 'rejected' | 'fulfilled'; created_at: number };
type Tab = 'home' | 'movies' | 'series' | 'search' | 'continue' | 'favorites' | 'requests' | 'settings' | 'admin';

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init,
      signal: init.signal || AbortSignal.timeout(20000),
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('The server took too long to respond. Check your connection and try again.');
    }
    throw error;
  }
  let data: any;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data as T;
}
const q = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 40_000, refetchOnWindowFocus: false } } });
const art = (id: string, kind: 'Primary' | 'Backdrop' | 'Thumb' = 'Primary') => `/jellyfin/Items/${encodeURIComponent(id)}/Images/${kind}?maxWidth=${kind === 'Backdrop' ? 1600 : 540}&quality=84`;
const formatTime = (ticks?: number) => ticks ? `${Math.floor(ticks / 600000000)}m` : '';
// Never display LAN/Tailscale addresses in the app UI. The friendly label describes
// the route the user took; it does not conceal the network destination from the OS.
const connectionLabel = (() => {
  const host = window.location.hostname.toLowerCase();
  const local = host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.') ||
    host.endsWith('.local') || host.startsWith('192.168.') || host.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
  return local ? 'Local' : 'Remote';
})();

function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: Account }>('/api/auth/me'), retry: false });
  const [tab, setTab] = useState<Tab>('home');
  const [selected, setSelected] = useState<Item | null>(null);
  const [playing, setPlaying] = useState<Item | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 260); return () => clearTimeout(t); }, [query]);
  const movies = useQuery({ queryKey: ['movies'], queryFn: () => api<PageResult>('/api/library?type=movie'), enabled: !!me.data });
  const series = useQuery({ queryKey: ['series'], queryFn: () => api<PageResult>('/api/library?type=series'), enabled: !!me.data });
  const resume = useQuery({ queryKey: ['resume'], queryFn: () => api<PageResult>('/api/continue'), enabled: !!me.data });
  const nextup = useQuery({ queryKey: ['nextup'], queryFn: () => api<PageResult>('/api/nextup'), enabled: !!me.data });
  const search = useQuery({ queryKey: ['search', debounced], queryFn: () => api<PageResult>(`/api/search?q=${encodeURIComponent(debounced)}`), enabled: !!me.data && debounced.length > 1 });
  const logout = useMutation({ mutationFn: () => api('/api/auth/logout', { method: 'POST' }), onSuccess: () => { qc.clear(); setSelected(null); setPlaying(null); setTab('home'); qc.invalidateQueries({ queryKey: ['me'] }); } });
  const both = [...(movies.data?.Items || []), ...(series.data?.Items || [])];
  const hero = both.find(i => i.CommunityRating && i.CommunityRating >= 7) || both[0];
  const open = (item: Item) => setSelected(item);
  const play = (item: Item) => { setSelected(null); setPlaying(item); };
  if (me.isPending) return <div className="boot"><div className="logo-mark large">C<span>F</span></div><p>Connecting to your cinema…</p></div>;
  if (!me.data) return <Login onLogin={() => qc.invalidateQueries({ queryKey: ['me'] })} />;
  const user = me.data.user;
  const navigations: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'home', label: 'Discover', icon: Home }, { key: 'movies', label: 'Movies', icon: Film },
    { key: 'series', label: 'TV Shows', icon: Tv2 }, { key: 'search', label: 'Search', icon: Search },
    { key: 'continue', label: 'Continue watching', icon: Clock3 }, { key: 'favorites', label: 'Favorites', icon: Heart },
    { key: 'requests', label: 'Media requests', icon: Plus }, { key: 'settings', label: 'Settings', icon: Settings2 },
    ...(user.isAdmin ? [{ key: 'admin' as Tab, label: 'Admin panel', icon: ShieldCheck }] : [])
  ];
  const showShelf = (title: string, items: Item[] | undefined, subtitle?: string) => <Shelf key={title} title={title} subtitle={subtitle} items={items || []} onOpen={open} onPlay={play} />;
  return <div className={`app ${collapsed ? 'rail' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><div className="logo-mark">C<span>F</span></div>{!collapsed && <div><strong>CRIMSONFIN</strong><small>YOUR PERSONAL CINEMA</small></div>}</div>
      <button className="collapse" aria-label="Toggle navigation" onClick={() => setCollapsed(v => !v)}><Menu size={18} /></button>
      <p className="nav-label">EXPLORE</p>
      <nav aria-label="Main navigation">{navigations.map(x => <button key={x.key} title={x.label} className={`nav-link ${tab === x.key ? 'active' : ''}`} onClick={() => { setTab(x.key); setSelected(null); }}><x.icon size={19}/>{!collapsed && <span>{x.label}</span>}{tab === x.key && <i/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</div>{!collapsed && <div className="sidebar-name"><strong>{user.name}</strong><small>{user.isAdmin ? 'Administrator' : 'Jellyfin member'}</small></div>}{!collapsed && <button className="icon-button" title="Sign out" onClick={() => logout.mutate()}><LogOut size={18}/></button>}</div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><span>YOUR LIBRARY</span><ChevronDown size={13}/><b>{navigations.find(x => x.key === tab)?.label}</b></div><div className="top-right"><span className="online"><i/> Connected · {connectionLabel}</span><button title="Search" className="top-search" onClick={() => setTab('search')}><Search size={18}/></button><div className="header-avatar">{user.name.slice(0,1).toUpperCase()}</div></div></header>
      {tab === 'home' && <>
        {hero ? <div className="hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(9,13,22,.99) 0%, rgba(9,13,22,.83) 37%, rgba(9,13,22,.17) 100%), linear-gradient(0deg,#0b1019 1%,transparent 42%), url('${art(hero.Id, 'Backdrop')}')` }}><div className="hero-content"><div className="eyebrow"><Sparkles size={13}/> FEATURED IN YOUR LIBRARY</div><h1>{hero.Name}</h1><div className="meta"><span>{hero.ProductionYear || 'Movie & TV'}</span>{hero.CommunityRating && <span className="rating">★ {hero.CommunityRating.toFixed(1)}</span>}{hero.Genres?.slice(0,2).map(g => <span key={g}>{g}</span>)}</div><p>{hero.Overview || 'Discover something great from your own library.'}</p><div className="hero-actions"><button className="btn btn-primary" onClick={() => hero.Type === 'Series' ? open(hero) : play(hero)}><Play size={17} fill="currentColor"/>{hero.Type === 'Series' ? 'Explore episodes' : 'Watch now'}</button><button className="btn btn-ghost" onClick={() => open(hero)}>More details <ArrowRight size={17}/></button></div></div></div> : <div className="empty-feature"><h1>Your cinema starts here.</h1><p>There are no movies or TV shows available to this Jellyfin account yet.</p></div>}
        <div className="shelves">{showShelf('Continue watching', resume.data?.Items, 'Pick up right where you left off')}{showShelf('Just added', movies.data?.Items.slice(0, 15), 'Fresh arrivals to your library')}{showShelf('Series to discover', series.data?.Items.slice(0, 15))}{showShelf('Up next', nextup.data?.Items)}</div>
      </>}
      {tab === 'movies' && <Collection title="Movies" subtitle="Every film in your Jellyfin library" items={movies.data?.Items} loading={movies.isLoading} onOpen={open} onPlay={play} />}
      {tab === 'series' && <Collection title="TV Shows" subtitle="Seasons, stories, and your next favorite" items={series.data?.Items} loading={series.isLoading} onOpen={open} onPlay={play} />}
      {tab === 'continue' && <Collection title="Continue watching" subtitle="Resume from any device" items={[...(resume.data?.Items || []), ...(nextup.data?.Items || [])]} loading={resume.isLoading} onOpen={open} onPlay={play} />}
      {tab === 'favorites' && <Collection title="Your favorites" subtitle="Saved directly to your Jellyfin account" items={both.filter(i => i.UserData?.IsFavorite)} loading={movies.isLoading || series.isLoading} onOpen={open} onPlay={play} />}
      {tab === 'search' && <section className="content-section"><div className="heading"><p className="eyebrow">YOUR COLLECTION</p><h1>Search your library</h1><p>Find movies and television shows instantly.</p></div><div className="search-bar"><Search size={21}/><input autoFocus aria-label="Search library" placeholder="Movies, titles, series…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" title="Clear" onClick={() => setQuery('')}><X size={18}/></button>}</div>{debounced.length > 1 ? <Collection title="Results" subtitle={search.data?.TotalRecordCount ? `${search.data.TotalRecordCount} matches` : 'Live results from Jellyfin'} items={search.data?.Items} loading={search.isLoading} onOpen={open} onPlay={play} compact /> : <div className="empty-state">Start typing to search the media you have access to.</div>}</section>}
      {tab === 'requests' && <MediaRequests user={user} />}
      {tab === 'admin' && user.isAdmin && <Admin />}
      {tab === 'settings' && <section className="content-section"><div className="heading"><p className="eyebrow">YOUR EXPERIENCE</p><h1>Settings</h1><p>Manage your account and connection.</p></div><div className="setting-card"><div><h3>Account</h3><p>Signed in as <strong>{user.name}</strong>. Your history and favorites belong to this Jellyfin user.</p></div><button className="btn btn-ghost" onClick={() => logout.mutate()}><LogOut size={16}/> Sign out</button></div><div className="setting-card"><div><h3>Connection</h3><p>Connection type: <strong>{connectionLabel}</strong></p><small className="muted">Your server address is intentionally hidden from this interface.</small></div><button className="btn btn-ghost" onClick={() => qc.invalidateQueries()}><ArrowRight size={16}/> Refresh data</button></div><div className="setting-card"><div><h3>Motion & accessibility</h3><p>Animations honor your system's reduced motion setting.</p></div><span className="mini-label">SYSTEM CONTROLLED</span></div></section>}
      <footer className="footer">CRIMSONFIN · CONNECTED TO YOUR JELLYFIN SERVER</footer>
    </main>
    {selected && <Details key={selected.Id} item={selected} onClose={() => setSelected(null)} onPlay={play} onMutation={() => qc.invalidateQueries()} />}
    {playing && <Player key={playing.Id} item={playing} onClose={() => { setPlaying(null); qc.invalidateQueries({ queryKey: ['resume'] }); }} />}
  </div>;
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true); const [visible, setVisible] = useState(false);
  const login = useMutation({ mutationFn: () => api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password, remember }) }), onSuccess: onLogin });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api('/api/health'), retry: 0, refetchInterval: 30000 });
  return <div className="login-page"><div className="login-glow"/><div className="login-header"><div className="logo-mark">C<span>F</span></div><div><strong>CRIMSONFIN</strong><small>YOUR PERSONAL CINEMA</small></div></div><div className="login-card"><div className="eyebrow"><Sparkles size={13}/> WELCOME BACK</div><h1>Your world of cinema.</h1><p>Sign in with your existing Jellyfin account. No VPN, no extra accounts.</p><form onSubmit={e => { e.preventDefault(); login.mutate(); }}><label htmlFor="username">USERNAME</label><input id="username" autoComplete="username" placeholder="Your Jellyfin username" required value={username} onChange={e => setUsername(e.target.value)}/><label htmlFor="password">PASSWORD</label><div className="password-box"><input id="password" type={visible ? 'text' : 'password'} required autoComplete="current-password" placeholder="Your password" value={password} onChange={e => setPassword(e.target.value)}/><button type="button" onClick={() => setVisible(v => !v)}>{visible ? 'Hide' : 'Show'}</button></div><label className="remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/><span>Remember me</span></label><button className="btn btn-primary sign-in" disabled={login.isPending} type="submit">{login.isPending ? 'Connecting…' : 'Enter CrimsonFin'}<ArrowRight size={18}/></button></form>{login.error && <div role="alert" className="error">{login.error.message}</div>}<div className="login-status"><span className={health.isSuccess ? 'status-green' : 'status-red'}/>{health.isSuccess ? `${connectionLabel} connection ready` : 'Unable to reach server'}{health.isError && <button onClick={() => health.refetch()}>Retry</button>}</div></div><div className="login-note">PRIVATE LIBRARY · SECURE JELLYFIN LOGIN</div></div>;
}
function Poster({ item, onOpen, onPlay }: { item: Item; onOpen: (v: Item) => void; onPlay: (v: Item) => void }) {
  const [failed, setFailed] = useState(false);
  return <div className="poster" onClick={() => onOpen(item)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(item); }}><div className="poster-cover">{!failed && <img loading="lazy" draggable={false} src={art(item.Id)} alt="" onError={() => setFailed(true)}/>}<div className="poster-fallback"><Clapperboard size={37}/></div><button title={`Play ${item.Name}`} className="poster-play" onClick={e => { e.stopPropagation(); item.Type === 'Series' ? onOpen(item) : onPlay(item); }}><Play size={21} fill="currentColor"/></button></div><h3 title={item.Name}>{item.Name}</h3><div className="poster-meta"><span>{item.ProductionYear || item.SeriesName || 'In library'}</span>{item.CommunityRating ? <b>★ {item.CommunityRating.toFixed(1)}</b> : null}</div>{(item.UserData?.PlayedPercentage || 0) > 0 && <div className="progress"><span style={{ width: `${Math.min(100, item.UserData?.PlayedPercentage || 0)}%` }}/></div>}</div>;
}
function Shelf({ title, subtitle, items, onOpen, onPlay }: { title: string; subtitle?: string; items: Item[]; onOpen: (v: Item) => void; onPlay: (v: Item) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  return <section className="shelf"><div className="shelf-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><div className="shelf-controls"><button aria-label="Scroll shelf left" onClick={() => ref.current?.scrollBy({ left: -600, behavior: 'smooth' })}><ArrowLeft size={18}/></button><button aria-label="Scroll shelf right" onClick={() => ref.current?.scrollBy({ left: 600, behavior: 'smooth' })}><ArrowRight size={18}/></button></div></div><div ref={ref} className="poster-row">{items.map(i => <Poster key={i.Id} item={i} onOpen={onOpen} onPlay={onPlay}/>)}</div></section>;
}
function Collection({ title, subtitle, items = [], loading, onOpen, onPlay, compact }: { title: string; subtitle: string; items?: Item[]; loading?: boolean; onOpen: (v: Item) => void; onPlay: (v: Item) => void; compact?: boolean }) {
  const [genre, setGenre] = useState('All genres');
  const genres = useMemo(() => ['All genres', ...new Set(items.flatMap(i => i.Genres || []))].slice(0, 30), [items]);
  const result = genre === 'All genres' ? items : items.filter(i => i.Genres?.includes(genre));
  return <section className={`content-section ${compact ? 'collection-compact' : ''}`}><div className="heading"><p className="eyebrow">AVAILABLE TO YOU</p><h1>{title}</h1><p>{subtitle}</p></div>{!compact && items.length > 0 && <div className="filters"><SlidersHorizontal size={17}/><select aria-label="Filter by genre" value={genre} onChange={e => setGenre(e.target.value)}>{genres.map(g => <option key={g} value={g}>{g}</option>)}</select><span>{result.length} titles</span></div>}{loading ? <div className="empty-state">Loading your library…</div> : result.length ? <div className="poster-grid">{result.map(i => <Poster key={i.Id} item={i} onOpen={onOpen} onPlay={onPlay}/>)}</div> : <div className="empty-state">There are no titles to display here yet.</div>}</section>;
}
function EpisodeArtwork({ item, seriesId }: { item: Item; seriesId: string }) {
  const [attempt, setAttempt] = useState(0);
  const candidates = item.ImageTags?.Primary ? [art(item.Id), art(seriesId)] : [art(seriesId)];
  const source = candidates[attempt];
  return <span className="episode-art">{source && <img loading="lazy" src={source} alt="" onError={() => setAttempt(i => i + 1)}/>}<Tv2 size={23} className="episode-art-placeholder"/></span>;
}
function Details({ item, onClose, onPlay, onMutation }: { item: Item; onClose: () => void; onPlay: (i: Item) => void; onMutation: () => void }) {
  const details = useQuery({ queryKey: ['item', item.Id], queryFn: () => api<Item>(`/api/items/${item.Id}`) });
  const media = details.data || item;
  const seasons = useQuery({ queryKey: ['seasons', item.Id], queryFn: () => api<PageResult>(`/api/series/${item.Id}/seasons`), enabled: item.Type === 'Series' });
  const [seasonId, setSeasonId] = useState('');
  useEffect(() => { if (seasons.data?.Items?.length && !seasonId) setSeasonId(seasons.data.Items[0].Id); }, [seasons.data, seasonId]);
  const episodes = useQuery({ queryKey: ['episodes', item.Id, seasonId], queryFn: () => api<PageResult>(`/api/series/${item.Id}/episodes?seasonId=${encodeURIComponent(seasonId)}`), enabled: item.Type === 'Series' && !!seasonId });
  const favorite = useMutation({ mutationFn: () => api(`/api/items/${item.Id}/favorite`, { method: media.UserData?.IsFavorite ? 'DELETE' : 'POST' }), onSuccess: () => { details.refetch(); onMutation(); } });
  return <div className="modal-overlay" onMouseDown={e => { if (e.currentTarget === e.target) onClose(); }}><div className="details-panel" role="dialog" aria-modal="true" aria-label={item.Name}><div className="details-backdrop" style={{ backgroundImage: `linear-gradient(0deg, #111723 0%, rgba(17,23,35,.18) 90%), url('${art(item.Id,'Backdrop')}')` }}/><button className="modal-close" title="Close details" onClick={onClose}><X size={22}/></button><div className="details-body"><span className="eyebrow">{item.Type === 'Series' ? 'TELEVISION SERIES' : 'FEATURE FILM'}</span><h1>{item.Name}</h1><div className="meta"><span>{media.ProductionYear}</span>{media.CommunityRating && <span className="rating">★ {media.CommunityRating.toFixed(1)}</span>}<span>{formatTime(media.RunTimeTicks)}</span>{media.Genres?.slice(0, 3).map(g => <span key={g}>{g}</span>)}</div><p>{media.Overview || 'No synopsis is available for this title.'}</p><div className="details-actions">{item.Type !== 'Series' && <button className="btn btn-primary" onClick={() => onPlay(media)}><Play size={18} fill="currentColor"/>{media.UserData?.PlaybackPositionTicks ? 'Resume playback' : 'Play now'}</button>}<button className="btn btn-ghost" onClick={() => favorite.mutate()}><Heart size={18} fill={media.UserData?.IsFavorite ? 'currentColor' : 'none'}/>{media.UserData?.IsFavorite ? 'In favorites' : 'Add to favorites'}</button></div>{item.Type === 'Series' && <div className="episodes"><div className="episodes-heading"><h2>Episodes</h2><select aria-label="Choose season" value={seasonId} onChange={e => setSeasonId(e.target.value)}>{(seasons.data?.Items || []).map(s => <option key={s.Id} value={s.Id}>{s.Name}</option>)}</select></div>{episodes.isLoading ? <p>Loading episodes…</p> : episodes.data?.Items.length ? episodes.data.Items.map(ep => <button className="episode" key={ep.Id} onClick={() => onPlay(ep)}><EpisodeArtwork item={ep} seriesId={item.Id}/><span><strong>{ep.IndexNumber ?? '–'}. {ep.Name}</strong><small>{ep.Overview || 'Play this episode'}</small></span><Play size={18}/></button>) : <div className="empty-state">No episodes in this season.</div>}</div>}{media.MediaSources?.[0]?.MediaStreams && <div className="streams"><h3>Media information</h3><p>{media.MediaSources[0].MediaStreams?.filter(s => s.Type === 'Video' || s.Type === 'Audio').map(s => s.DisplayTitle || s.Codec).join(' · ')}</p></div>}</div></div></div>;
}

function MediaRequests({ user }: { user: Account }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'movie' | 'series'>('movie'); const [title, setTitle] = useState('');
  const [year, setYear] = useState(''); const [notes, setNotes] = useState(''); const [search, setSearch] = useState('');
  const [searchCommitted, setSearchCommitted] = useState('');
  const requests = useQuery({ queryKey: ['requests'], queryFn: () => api<{ requests: RequestEntry[] }>('/api/requests') });
  const filelistSettings = useQuery({ queryKey: ['filelistAdminSettings'], queryFn: () =>
    api<{ apiConfigured: boolean; downloaderConfigured: boolean }>('/api/admin/filelist/settings'),
    enabled: user.isAdmin });
  const queue = useMutation({ mutationFn: (id: string) =>
    api('/api/admin/filelist/queue/' + encodeURIComponent(id), { method: 'POST' }) });

  const catalog = useQuery({ queryKey: ['filelist', searchCommitted], queryFn: () => api<{ configured: boolean; results: { id: string; name: string; size: string; seeders: number | null; downloadable?: boolean }[]; source?: string }>(`/api/filelist/search?q=${encodeURIComponent(searchCommitted)}`), enabled: searchCommitted.length > 1, staleTime: 300000 });
  const create = useMutation({ mutationFn: () => api('/api/requests', { method: 'POST', body: JSON.stringify({ kind, title, year, notes }) }), onSuccess: () => { setTitle(''); setYear(''); setNotes(''); qc.invalidateQueries({ queryKey: ['requests'] }); } });
  return <section className="content-section"><div className="heading"><p className="eyebrow">YOUR VOICE, YOUR LIBRARY</p><h1>Media requests</h1><p>Suggest a movie or show. An administrator reviews every request.</p></div><div className="request-columns"><div className="panel"><h2><Plus size={21}/> New request</h2><form onSubmit={e => { e.preventDefault(); create.mutate(); }}><label>MEDIA TYPE</label><div className="segmented"><button type="button" className={kind === 'movie' ? 'selected' : ''} onClick={() => setKind('movie')}><Film size={16}/> Movie</button><button type="button" className={kind === 'series' ? 'selected' : ''} onClick={() => setKind('series')}><Tv2 size={16}/> TV Show</button></div><label htmlFor="request-title">TITLE</label><input id="request-title" required minLength={2} maxLength={180} placeholder="What would you like to watch?" value={title} onChange={e => setTitle(e.target.value)}/><label htmlFor="request-year">YEAR (OPTIONAL)</label><input id="request-year" type="number" min={1888} max={2100} value={year} onChange={e => setYear(e.target.value)} placeholder="2026"/><label htmlFor="request-note">NOTES (OPTIONAL)</label><textarea id="request-note" maxLength={500} rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Edition, language, season…"/><button className="btn btn-primary" type="submit" disabled={create.isPending}><Send size={17}/>{create.isPending ? 'Sending…' : 'Send request'}</button>{create.isSuccess && <p className="success"><Check size={16}/> Request saved.</p>}{create.error && <p className="error">{create.error.message}</p>}</form></div><div className="panel"><h2><Search size={21}/> FileList availability</h2><p className="muted">Search recent FileList RSS entries for metadata. Downloading is not automatic.</p><form className="tracker-search" onSubmit={e => { e.preventDefault(); setSearchCommitted(search.trim()); }}><input minLength={2} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title on FileList…"/><button className="btn btn-ghost" type="submit"><Search size={17}/></button></form>{catalog.isFetching && <div className="placeholder">Searching FileList…</div>}{catalog.isError && <p className="error">{catalog.error.message}</p>}{catalog.data && (!catalog.data.configured ? <div className="empty-state">FileList isn't configured on this server. You can still submit requests.</div> : catalog.data.results.length ? <div className="tracker-list">{catalog.data.results.map((r, index) => <div className="tracker-result" key={`${r.id}-${index}`}><button title="Use title for request" onClick={() => setTitle(r.name.replace(/\./g, ' '))}><span><strong>{r.name}</strong><small>{r.size ? `Size: ${r.size} · ` : ''}{r.seeders == null ? 'Recent RSS entry' : 'Seeders: ' + r.seeders}</small></span><Plus size={16}/></button>{user.isAdmin && catalog.data.source === 'api' && r.downloadable && <div className="torrent-actions"><a className="torrent-download" href={`/api/admin/filelist/torrent/${r.id}`} download>.torrent</a>{filelistSettings.data?.downloaderConfigured && <button className="queue-download" type="button" disabled={queue.isPending} onClick={() => queue.mutate(r.id)}>Download on server</button>}</div>}</div>)}</div> : <div className="empty-state">No matches in the recent FileList feed.</div>)}{queue.isSuccess && <p className="success">Download queued in qBittorrent on the server.</p>}{queue.error && <p className="error">{queue.error.message}</p>}</div></div><div className="requests-history"><div className="shelf-header"><div><h2>{user.isAdmin ? 'All media requests' : 'Your requests'}</h2><p>Track the status of every suggestion</p></div><button className="btn btn-ghost" onClick={() => requests.refetch()}>Refresh <ArrowRight size={16}/></button></div>{requests.data?.requests.length ? <div className="request-table">{requests.data.requests.map(r => <div className="request-row" key={r.id}><div><strong>{r.title}{r.year ? ` (${r.year})` : ''}</strong><small>{r.kind === 'movie' ? 'Movie' : 'TV show'} · {new Date(r.created_at).toLocaleDateString()}{user.isAdmin ? ` · ${r.user_name}` : ''}{r.notes ? ` · ${r.notes}` : ''}</small></div><span className={`status status-${r.status}`}>{r.status}</span></div>)}</div> : <div className="empty-state">No requests yet. You can be the first to submit one.</div>}</div></section>;
}
function Admin() {
  const qc = useQueryClient();
  const requests = useQuery({ queryKey: ['requests'], queryFn: () => api<{ requests: RequestEntry[] }>('/api/requests') });
  const status = useQuery({ queryKey: ['adminStatus'], queryFn: () => api<{ jellyfinReachable: boolean; filelistConfigured: boolean; pendingRequests: number }>('/api/admin/status'), refetchInterval: 45000 });
  const mutate = useMutation({ mutationFn: (arg: { id: string; status: string }) => api(`/api/requests/${arg.id}`, { method: 'PATCH', body: JSON.stringify({ status: arg.status }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['requests'] }); qc.invalidateQueries({ queryKey: ['adminStatus'] }); } });
  return <section className="content-section"><div className="heading"><p className="eyebrow">ADMINISTRATOR ACCESS</p><h1>Server & requests</h1><p>Review your server's connection and manage media suggestions.</p></div><div className="admin-stats"><div className="stat"><small>JELLYFIN CONNECTION</small><strong>{status.isLoading ? 'Checking…' : status.isError ? 'Unavailable' : status.data?.jellyfinReachable ? 'Connected' : 'Not connected'}</strong></div><div className="stat"><small>FILELIST INTEGRATION</small><strong>{status.isLoading ? 'Checking…' : status.isError ? 'Unavailable' : status.data?.filelistConfigured ? 'Configured' : 'Not configured'}</strong></div><div className="stat"><small>PENDING REQUESTS</small><strong>{status.data?.pendingRequests ?? '–'}</strong></div></div><div className="panel admin-list"><h2>Review requests</h2>{requests.data?.requests.length ? requests.data.requests.map(r => <div className="review-row" key={r.id}><div><strong>{r.title}</strong><small>{r.user_name} · {r.kind}{r.year ? ` · ${r.year}` : ''} · {r.notes || 'No additional notes'}</small></div><select disabled={mutate.isPending} aria-label={`Status for ${r.title}`} value={r.status} onChange={e => mutate.mutate({ id: r.id, status: e.target.value })}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="fulfilled">Fulfilled</option></select></div>) : <div className="empty-state">No requests to review.</div>}{mutate.error && <p className="error">{mutate.error.message}</p>}</div><FileListConfiguration /><SubtitleCoverage /></section>;
}


function SubtitleCoverage() {
  const stats = useQuery({ queryKey: ['subtitleCoverage'], queryFn: () =>
    api<{ enabled: boolean; summary?: { checked:number; haveRomanian:number;
      possiblyMissing:number; attempted:number; installed:number; lastScanUtc:string } }>('/api/admin/subtitles/status'),
    refetchInterval: 120000 });
  const summary = stats.data?.summary;
  const percent = summary?.checked ? Math.round(summary.haveRomanian * 100 / summary.checked) : 0;
  return <div className="panel subtitle-coverage">
    <div className="subtitle-coverage-title"><span className="eyebrow"><ShieldCheck size={14}/> ROMANIAN SUBTITLE COVERAGE</span>
      <h2>Community captions audit</h2></div>
    {summary ? <>
      <div className="subtitle-numbers">
        <div><strong>{summary.checked}</strong><span>Media checked</span></div>
        <div><strong>{summary.haveRomanian}</strong><span>With Romanian subtitles</span></div>
        <div><strong>{summary.possiblyMissing}</strong><span>Potentially missing</span></div>
      </div>
      <div className="subtitle-progress" role="progressbar" aria-label="Romanian subtitle coverage"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }}/></div>
      <p className="muted">{percent}% indexed coverage · Last scan: {summary.lastScanUtc ? new Date(summary.lastScanUtc).toLocaleString() : 'Unknown'}.
        {' '}Downloads require available community sources and matching releases; no automatic machine translations are produced by this audit.</p>
    </> : <p className="muted">{stats.isLoading ? 'Checking subtitle audit status…' : 'The subtitle audit has not run yet or cannot be reached.'}</p>}
  </div>;
}

function FileListConfiguration() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['filelistAdminSettings'], queryFn: () =>
    api<{apiConfigured: boolean; rssConfigured: boolean; rssPasskeyAvailable: boolean;
      username: string; downloaderConfigured: boolean}>('/api/admin/filelist/settings') });
  const [username, setUsername] = useState('');
  const [passkey, setPasskey] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (settings.data && !dirty) setUsername(settings.data.username || ''); }, [settings.data, dirty]);
  const save = useMutation({ mutationFn: () => api('/api/admin/filelist/settings', {
    method: 'POST', body: JSON.stringify({ username, ...(passkey.trim() ? { passkey: passkey.trim() } : {}) }),
    signal: AbortSignal.timeout(10000)
  }), onSuccess: () => {
    setPasskey(''); setDirty(false);
    qc.invalidateQueries({ queryKey: ['filelistAdminSettings'] });
    qc.invalidateQueries({ queryKey: ['adminStatus'] });
    qc.invalidateQueries({ queryKey: ['filelist'] });
  }});
  return <div className="panel filelist-settings"><h2>FileList API search</h2>
    <p className="muted">{settings.data?.apiConfigured
      ? 'Full FileList catalog search is enabled.'
      : 'RSS is active. Add your FileList username to enable the complete API search.'}
      {' '}Credentials are held only on the server.</p>
    <form onSubmit={e => { e.preventDefault(); save.mutate(); }}>
      <label htmlFor="filelist-api-user">FILELIST USERNAME</label>
      <input id="filelist-api-user" autoComplete="off" placeholder="Your FileList account username"
        value={username} maxLength={100} onChange={e => { setUsername(e.target.value); setDirty(true); }}/>
      <label htmlFor="filelist-api-pass">API PASSKEY (OPTIONAL)</label>
      <input id="filelist-api-pass" type="password" autoComplete="new-password"
        placeholder={settings.data?.rssPasskeyAvailable ? 'Leave empty to reuse your stored RSS passkey' : 'Enter FileList API passkey'}
        value={passkey} maxLength={256} onChange={e => setPasskey(e.target.value)}/>
      <button type="submit" className="btn btn-primary" disabled={save.isPending}>
        <ShieldCheck size={16}/> {save.isPending ? 'Saving…' : 'Save FileList API settings'}
      </button>
      {save.isSuccess && <p className="success">API settings saved. Search again to check authentication.</p>}
      {save.error && <p className="error">{save.error.message}</p>}
    </form>
    <p className="muted">Torrent files can be downloaded by Jellyfin administrators after an API search.
      To download the media directly on the server, configure a password-protected qBittorrent Web API.</p>
  </div>;
}

createRoot(document.getElementById('root')!).render(<QueryClientProvider client={q}><App /></QueryClientProvider>);
