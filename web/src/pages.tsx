import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronDown, Delete, Heart, Info, Play, Plus, Search, Star } from 'lucide-react';
import { api, itemArt, episodeCode, isPlayable, minutesLeft, progressOf, runtime, useArtworkAccent, useDebounced, type Item, type PageResult } from './lib';
import { Artwork, CardMenu, Empty, PageHead, PosterCard, Row, Tabs, WideCard } from './ui';
import { isTv } from './tv';

type Nav = { onOpen: (item: Item) => void; onPlay: (item: Item) => void };

function Meta({ item, extra }: { item: Item; extra?: string[] }) {
  const parts = [item.ProductionYear, runtime(item.RunTimeTicks), item.Genres?.slice(0, 2).join(', '), ...(extra || [])].filter(Boolean);
  return <div className="meta">{parts.map((p, i) => <span key={i}>{p}</span>)}
    {item.CommunityRating ? <span className="rating"><Star aria-hidden fill="currentColor" /> {item.CommunityRating.toFixed(1)}</span> : null}</div>;
}

/* ---------------------------------- Home ---------------------------------- */
export function HomePage({ hero, recent, upNext, movies, series, loading, error, onRetry, onOpen, onPlay }: Nav & {
  hero?: Item; recent: Item[]; upNext: Item[]; movies: Item[]; series: Item[]; loading: boolean; error?: string; onRetry: () => void;
}) {
  return <div className="page home">
    {hero ? <section className="spotlight">
      <div className="spotlight-art" aria-hidden><Artwork sources={[itemArt(hero, 'Backdrop')]} /></div>
      <div className="spotlight-info">
        <span className="chip">Featured from your library</span>
        <h1>{hero.Name}</h1>
        <Meta item={hero} />
        {hero.Overview && <p className="synopsis">{hero.Overview}</p>}
        <div className="actions">
          <button className="btn primary" autoFocus={isTv} onClick={() => (isPlayable(hero) ? onPlay(hero) : onOpen(hero))}>
            <Play fill="currentColor" aria-hidden />{isPlayable(hero) ? 'Play' : 'Episodes'}</button>
          <button className="btn" onClick={() => onOpen(hero)}><Info aria-hidden /> More info</button>
        </div>
      </div>
    </section> : <section className="spotlight empty-spotlight">
      <div className="spotlight-info"><h1>{error ? 'Library unavailable' : loading ? 'Loading your library…' : 'Your cinema starts here.'}</h1>
        {error ? <><p className="synopsis">{error}</p><button className="btn" onClick={onRetry}>Retry</button></>
          : !loading && <p className="synopsis">There are no movies or shows available to this Jellyfin account yet.</p>}</div>
    </section>}
    {recent.length > 0 && <Row title="Continue watching" meta={`${recent.length} in progress`}>
      {recent.map(i => <WideCard key={i.Id} item={i} onOpen={onOpen} onPlay={onPlay} />)}</Row>}
    {upNext.length > 0 && <Row title="Up next">{upNext.map(i => <WideCard key={i.Id} item={i} onOpen={onOpen} onPlay={onPlay} />)}</Row>}
    {movies.length > 0 && <Row title="Just added">{movies.slice(0, 18).map(i => <PosterCard key={i.Id} item={i} onOpen={onOpen} onPlay={onPlay} />)}</Row>}
    {series.length > 0 && <Row title="Shows to discover">{series.slice(0, 18).map(i => <PosterCard key={i.Id} item={i} onOpen={onOpen} onPlay={onPlay}
      subtitle={i.ChildCount ? `${i.ChildCount} season${i.ChildCount === 1 ? '' : 's'}` : String(i.ProductionYear || '')} />)}</Row>}
  </div>;
}

/* ------------------------------ Movies / Shows ----------------------------- */
const sorts = { added: 'Recently added', name: 'A–Z', year: 'Newest', rating: 'Top rated' } as const;
type Sort = keyof typeof sorts;
const PAGE = 60;

/** A Jellyfin listing fetched page by page (sorting/filtering happen on the server). */
export function useLibrary({ type, sort = 'added', genre = '', filter = '' }: { type: 'movie' | 'series' | 'all'; sort?: string; genre?: string; filter?: '' | 'favorite' | 'played' }) {
  const query = useInfiniteQuery({
    queryKey: ['library', type, sort, genre, filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<PageResult>(`/api/library?${new URLSearchParams({
      type, sort, start: String(pageParam), limit: String(PAGE), ...(genre ? { genre } : {}), ...(filter ? { filter } : {}) })}`),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.Items.length, 0);
      return last.Items.length === PAGE && loaded < (last.TotalRecordCount ?? Infinity) ? loaded : undefined;
    }
  });
  const items = useMemo(() => query.data?.pages.flatMap(p => p.Items) ?? [], [query.data]);
  return { ...query, items, total: query.data?.pages[0]?.TotalRecordCount ?? items.length };
}

/** Loads the next page when it scrolls into view (also when TV focus scrolls the page). */
function LoadMore({ more, loading, onMore }: { more: boolean; loading: boolean; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !more) return;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) onMore(); }, { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, onMore]);
  if (!more && !loading) return null;
  return <div ref={ref} className="load-more" role="status">{loading ? 'Loading more…' : ''}</div>;
}

export function LibraryPage({ kind, nextUp, onOpen, onPlay }: Nav & { kind: 'movies' | 'series'; nextUp: Item[] }) {
  const type = kind === 'movies' ? 'movie' : 'series';
  const [genre, setGenre] = useState('');
  const [sort, setSort] = useState<Sort>('added');
  const lib = useLibrary({ type, sort, genre });
  const genres = useQuery({ queryKey: ['genres', type], staleTime: 10 * 60_000,
    queryFn: () => api<{ genres: string[] }>(`/api/genres?type=${type}`) }).data?.genres ?? [];
  const noun = kind === 'movies' ? 'title' : 'series';
  const count = lib.isPending ? 'Loading…' : `${lib.total} ${lib.total === 1 || noun === 'series' ? noun : noun + 's'}`;
  const sortKeys = Object.keys(sorts) as Sort[];
  return <div className="page library">
    <PageHead title={kind === 'movies' ? 'Movies' : 'Shows'} meta={count}>
      {isTv ? <button className="pill select" onClick={() => setSort(sortKeys[(sortKeys.indexOf(sort) + 1) % sortKeys.length])}>
        Sort: {sorts[sort]} <ChevronDown aria-hidden /></button>
        : <>
          <label className="select"><span>Genre:</span><select value={genre} onChange={e => setGenre(e.target.value)} aria-label="Filter by genre">
            <option value="">All</option>{genres.map(g => <option key={g}>{g}</option>)}</select><ChevronDown aria-hidden /></label>
          <label className="select"><span>Sort:</span><select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort">
            {sortKeys.map(k => <option key={k} value={k}>{sorts[k]}</option>)}</select><ChevronDown aria-hidden /></label>
        </>}
    </PageHead>
    {isTv && genres.length > 0 && <div className="pills" role="group" aria-label="Filter by genre">
      {['', ...genres.slice(0, 12)].map(g => <button key={g || 'all'} className={genre === g ? 'pill active' : 'pill'} onClick={() => setGenre(g)}>{g || 'All'}</button>)}
    </div>}
    {lib.error && <Empty action={<button className="btn" onClick={() => void lib.refetch()}>Retry</button>}>{lib.error.message}</Empty>}
    {kind === 'series' && nextUp.length > 0 && !genre && <Row title="Next up">{nextUp.map(i => <WideCard key={i.Id} item={i} onOpen={onOpen} onPlay={onPlay} />)}</Row>}
    {kind === 'series' && nextUp.length > 0 && !genre && <h2 className="section-title">All shows</h2>}
    {lib.isPending ? <Empty>Loading your library…</Empty> : lib.items.length ? <>
      <div className="poster-grid">
        {lib.items.map(i => <PosterCard key={i.Id} item={i} onOpen={onOpen} onPlay={onPlay}
          subtitle={kind === 'series' ? [i.ProductionYear, i.ChildCount ? `${i.ChildCount} season${i.ChildCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') : undefined} />)}
      </div>
      <LoadMore more={!!lib.hasNextPage} loading={lib.isFetchingNextPage} onMore={() => { if (!lib.isFetchingNextPage) void lib.fetchNextPage(); }} />
    </> : !lib.error && <Empty>There are no {kind === 'movies' ? 'movies' : 'shows'} {genre ? `in ${genre} ` : ''}to show here yet.</Empty>}
  </div>;
}

/* --------------------------------- My list -------------------------------- */
export function MyListPage({ watching, loadingWatching, onOpen, onPlay }: Nav & { watching: Item[]; loadingWatching: boolean }) {
  const [tab, setTab] = useState<'favorites' | 'watching' | 'watched'>('favorites');
  const favorites = useLibrary({ type: 'all', sort: 'name', filter: 'favorite' });
  const watched = useLibrary({ type: 'all', sort: 'played', filter: 'played' });
  const active = tab === 'favorites' ? favorites : tab === 'watched' ? watched : null;
  const items = active ? active.items : watching;
  const loading = active ? active.isPending : loadingWatching;
  return <div className="page mylist">
    <PageHead title="My list"><Tabs label="My list" value={tab} onChange={setTab} options={[
      { value: 'favorites', label: 'Favorites', count: favorites.isPending ? undefined : favorites.total },
      { value: 'watching', label: 'Continue watching', count: watching.length },
      { value: 'watched', label: 'Watched', count: watched.isPending ? undefined : watched.total }]} /></PageHead>
    {active?.error && <Empty action={<button className="btn" onClick={() => void active.refetch()}>Retry</button>}>{active.error.message}</Empty>}
    {loading ? <Empty>Loading…</Empty> : items.length ? <>
      <div className="wide-grid">
        {items.map(i => <WideCard key={i.Id} item={i} onOpen={onOpen} onPlay={onPlay}
          subtitle={tab === 'watching' ? undefined : [i.Type === 'Series' ? 'Show' : 'Movie', i.ProductionYear, runtime(i.RunTimeTicks)].filter(Boolean).join(' · ')} />)}
      </div>
      {active && <LoadMore more={!!active.hasNextPage} loading={active.isFetchingNextPage} onMore={() => { if (!active.isFetchingNextPage) void active.fetchNextPage(); }} />}
    </> : !active?.error && <Empty>{tab === 'favorites' ? 'Nothing saved yet. Open any title and choose “My list”.'
      : tab === 'watching' ? 'Nothing in progress.' : 'Nothing watched yet.'}</Empty>}
  </div>;
}

/* --------------------------------- Search --------------------------------- */
const keys = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'];
export function SearchPage({ initial, onOpen, onPlay }: Nav & { initial: string }) {
  const [query, setQuery] = useState(initial);
  useEffect(() => setQuery(initial), [initial]);
  const term = useDebounced(query.trim(), 260);
  const search = useQuery({ queryKey: ['search', term], queryFn: () => api<PageResult>(`/api/search?q=${encodeURIComponent(term)}`), enabled: term.length > 1 });
  const [filter, setFilter] = useState<'all' | 'Movie' | 'Series'>('all');
  const all = search.data?.Items || [];
  const shown = filter === 'all' ? all : all.filter(i => i.Type === filter);
  const results = <div className="search-results-page">
    {term.length > 1 && <PageHead title={`Results for “${term}”`} meta={search.isFetching ? 'Searching…' : `${all.length} title${all.length === 1 ? '' : 's'}`}>
      <Tabs label="Result type" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' },
        { value: 'Movie', label: 'Movies', count: all.filter(i => i.Type === 'Movie').length },
        { value: 'Series', label: 'Shows', count: all.filter(i => i.Type === 'Series').length }]} /></PageHead>}
    {term.length < 2 ? <Empty>Start typing to search your library.</Empty> : shown.length ? <div className="poster-grid">
      {shown.map(i => <div key={i.Id} className="highlighted"><PosterCard item={i} onOpen={onOpen} onPlay={onPlay}
        subtitle={`${i.Type === 'Series' ? 'Show' : 'Movie'}${i.ProductionYear ? ' · ' + i.ProductionYear : ''}`} /></div>)}
    </div> : !search.isFetching && <Empty>No matches for “{term}”.</Empty>}
  </div>;
  if (!isTv) return <div className="page search">
    <label className="search-field big"><Search aria-hidden /><input autoFocus type="search" value={query} aria-label="Search movies and shows"
      placeholder="Search movies and shows" onChange={e => setQuery(e.target.value)} /></label>
    {results}
  </div>;
  return <div className="page search tv-search">
    <div className="search-panel">
      <label className="search-field big"><Search aria-hidden /><input type="search" value={query} aria-label="Search movies and shows"
        placeholder="Search" onChange={e => setQuery(e.target.value)} /></label>
      <div className="keyboard" role="group" aria-label="On-screen keyboard">
        {keys.map(row => <div key={row} className="key-row">{[...row].map(ch =>
          <button key={ch} className="key" onClick={() => setQuery(q => q + ch)}>{ch}</button>)}</div>)}
        <div className="key-row">
          <button className="key wide" onClick={() => setQuery(q => q + ' ')}>Space</button>
          <button className="key mid" aria-label="Delete" onClick={() => setQuery(q => q.slice(0, -1))}><Delete aria-hidden /> Delete</button>
          <button className="key text" onClick={() => setQuery('')}>Clear</button>
        </div>
      </div>
      <p className="muted">Tip: a keyboard or your phone's remote app also works.</p>
    </div>
    {results}
  </div>;
}

/* --------------------------------- Details -------------------------------- */
export function DetailsPage({ item, nextUp, onBack, onPlay, onChanged }: {
  item: Item; nextUp: Item[]; onBack: () => void; onPlay: (item: Item) => void; onChanged: () => void;
}) {
  const details = useQuery({ queryKey: ['item', item.Id], queryFn: () => api<Item>(`/api/items/${item.Id}`) });
  const media = details.data || item;
  const series = item.Type === 'Series';
  const seasons = useQuery({ queryKey: ['seasons', item.Id], queryFn: () => api<PageResult>(`/api/series/${item.Id}/seasons`), enabled: series });
  const [seasonId, setSeasonId] = useState('');
  useEffect(() => { if (seasons.data?.Items?.length && !seasonId) setSeasonId(seasons.data.Items[0].Id); }, [seasons.data, seasonId]);
  const episodes = useQuery({ queryKey: ['episodes', item.Id, seasonId], enabled: series && !!seasonId,
    queryFn: () => api<PageResult>(`/api/series/${item.Id}/episodes?seasonId=${encodeURIComponent(seasonId)}`) });
  const favorite = useMutation({ mutationFn: () => api(`/api/items/${item.Id}/favorite`, { method: media.UserData?.IsFavorite ? 'DELETE' : 'POST' }),
    onSuccess: () => { void details.refetch(); onChanged(); } });
  const accent = useArtworkAccent(itemArt(item, 'Backdrop', 160));
  const resumeEpisode = series ? nextUp.find(e => e.SeriesId === item.Id) || episodes.data?.Items.find(e => !e.UserData?.Played) : undefined;
  const streams = media.MediaSources?.[0]?.MediaStreams || [];
  const facts = [
    ['Audio', streams.filter(s => s.Type === 'Audio').map(s => s.DisplayTitle || s.Codec).slice(0, 3).join(', ')],
    ['Subtitles', streams.filter(s => s.Type === 'Subtitle').map(s => s.DisplayTitle || s.Language).slice(0, 4).join(', ')],
    ['Video', streams.filter(s => s.Type === 'Video').map(s => s.DisplayTitle || s.Codec).slice(0, 1).join('')]
  ].filter(([, v]) => v);
  const style = accent ? { '--item-accent': accent.color, '--item-accent-text': accent.text } as React.CSSProperties : undefined;
  return <div className="page details" style={style}>
    <div className="details-art" aria-hidden><Artwork sources={[itemArt(item, 'Backdrop')]} /></div>
    <div className="details-info">
      <button className="back-link" data-back onClick={onBack}><ArrowLeft aria-hidden /> Back</button>
      <span className="chip accent">{series ? `Series${seasons.data?.Items.length ? ` · ${seasons.data.Items.length} season${seasons.data.Items.length === 1 ? '' : 's'}` : ''}` : 'Movie'}</span>
      <h1>{item.Name}</h1>
      <Meta item={media} />
      {media.Overview && <p className="synopsis">{media.Overview}</p>}
      <div className="actions">
        {!series && <button className="btn primary accent" autoFocus={isTv} onClick={() => onPlay(media)}><Play fill="currentColor" aria-hidden />
          {media.UserData?.PlaybackPositionTicks ? <>Resume <small>{minutesLeft(media)}</small></> : 'Play'}</button>}
        {series && resumeEpisode && <button className="btn primary accent" autoFocus={isTv} onClick={() => onPlay(resumeEpisode)}><Play fill="currentColor" aria-hidden />
          {resumeEpisode.UserData?.PlaybackPositionTicks ? 'Resume' : 'Play'} {episodeCode(resumeEpisode).replace(' · ', ' ')}
          {minutesLeft(resumeEpisode) && <small>{minutesLeft(resumeEpisode)}</small>}</button>}
        <button className="btn" onClick={() => favorite.mutate()} disabled={favorite.isPending} aria-pressed={!!media.UserData?.IsFavorite}>
          {media.UserData?.IsFavorite ? <><Heart fill="currentColor" aria-hidden /> In My list</> : <><Plus aria-hidden /> My list</>}</button>
      </div>
      {favorite.error && <p className="error" role="alert">{favorite.error.message}</p>}
    </div>
    {facts.length > 0 && <dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
    {series && <section className="episodes">
      <header className="row-head"><h2>Episodes</h2>
        {(seasons.data?.Items.length || 0) > 1 && <label className="select"><select value={seasonId} onChange={e => setSeasonId(e.target.value)} aria-label="Season">
          {seasons.data!.Items.map(s => <option key={s.Id} value={s.Id}>{s.Name}</option>)}</select><ChevronDown aria-hidden /></label>}
        {seasons.data?.Items.length === 1 && <span className="muted">{seasons.data.Items[0].Name}</span>}
      </header>
      {episodes.isLoading ? <Empty>Loading episodes…</Empty> : episodes.data?.Items.length ? <ol className="episode-list">
        {episodes.data.Items.map(ep => {
          const now = ep.Id === resumeEpisode?.Id;
          return <li key={ep.Id}><button className={now ? 'episode current' : 'episode'} onClick={() => onPlay(ep)}>
            <span className="ep-num">{ep.IndexNumber ?? '–'}</span>
            <span className="ep-art"><Artwork sources={[itemArt(ep, 'Primary', 400), itemArt(item, 'Backdrop', 400)]} />
              {progressOf(ep) > 0 && <span className="card-progress"><i style={{ width: `${progressOf(ep)}%` }} /></span>}</span>
            <span className="ep-text"><strong>{ep.Name}{ep.UserData?.Played && <Check className="ok" aria-label="Watched" />}</strong>
              {ep.Overview && <small>{ep.Overview}</small>}</span>
            <span className={now ? 'ep-time accent' : 'ep-time'}>{now && minutesLeft(ep) ? minutesLeft(ep) : runtime(ep.RunTimeTicks)}</span>
          </button><CardMenu item={ep} onOpen={() => {}} className="episode-menu" /></li>;
        })}</ol> : <Empty>No episodes in this season.</Empty>}
    </section>}
  </div>;
}
