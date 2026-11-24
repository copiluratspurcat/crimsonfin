import React, { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryClient, statusOf, type Account, type Item, type PageResult } from './lib';
import { uniqueWatchEntries } from './continue-watching';
import { TopNav, type Tab } from './nav';
import { DetailsPage, HomePage, LibraryPage, MyListPage, SearchPage } from './pages';
import { Login } from './login';
import { Logo } from './ui';
import { initTheme } from './theme';
import { enableTvNavigation } from './tv';
import './spotlight.css';

// Loaded on demand: the player (with hls.js) and the less-visited pages stay out of the first download.
const Player = lazy(() => import('./player').then(m => ({ default: m.Player })));
const RequestsPage = lazy(() => import('./requests').then(m => ({ default: m.RequestsPage })));
const SettingsPage = lazy(() => import('./settings').then(m => ({ default: m.SettingsPage })));
// Fetch the player in the background once the app is idle, so the first Play starts without waiting.
const preloadPlayer = () => { void import('./player'); };
if ('requestIdleCallback' in window) window.requestIdleCallback(preloadPlayer, { timeout: 8000 }); else setTimeout(preloadPlayer, 3000);
const pageFallback = <div className="page"><p className="muted" role="status">Loading…</p></div>;

/** Browse pages kept alive between visits (their cards and artwork stay in place). */
const KEEP_ALIVE: Tab[] = ['home', 'movies', 'series', 'mylist'];

function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: Account; titleTranslations?: boolean }>('/api/auth/me'), retry: false });
  const [tab, setTab] = useState<Tab>('home');
  const [selected, setSelected] = useState<Item | null>(null);
  const [playing, setPlaying] = useState<Item | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const signedIn = !!me.data;
  const movies = useQuery({ queryKey: ['movies'], queryFn: () => api<PageResult>('/api/library?type=movie&limit=30'), enabled: signedIn });
  const series = useQuery({ queryKey: ['series'], queryFn: () => api<PageResult>('/api/library?type=series&limit=30'), enabled: signedIn });
  const resume = useQuery({ queryKey: ['resume'], queryFn: () => api<PageResult>('/api/continue'), enabled: signedIn });
  const nextup = useQuery({ queryKey: ['nextup'], queryFn: () => api<PageResult>('/api/nextup'), enabled: signedIn });
  const logout = useMutation({
    mutationFn: () => api('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => { qc.clear(); setSelected(null); setPlaying(null); setTab('home'); void qc.invalidateQueries({ queryKey: ['me'] }); }
  });
  // A 401 from any query re-checks /me (see queryClient in lib.ts), which brings back the login.
  // Browse pages stay mounted once visited (hidden when not shown), so switching tabs or
  // leaving a details page doesn't rebuild every card and re-request its artwork.
  const [kept, setKept] = useState<Tab[]>(['home']);
  useEffect(() => { if (KEEP_ALIVE.includes(tab)) setKept(k => (k.includes(tab) ? k : [...k, tab])); }, [tab]);
  const savedScroll = useRef(0);
  const restoreScroll = useRef(false);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab]);
  useLayoutEffect(() => {
    if (selected) window.scrollTo({ top: 0 });
    else if (restoreScroll.current) { restoreScroll.current = false; window.scrollTo({ top: savedScroll.current }); }
  }, [selected?.Id]);
  const closeDetails = () => { restoreScroll.current = true; setSelected(null); };
  // Escape / TV Back closes the details page (the player handles its own Escape).
  useEffect(() => {
    if (!selected || playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target instanceof HTMLElement && e.target.closest('.searchbox, .account, select')) return;
      e.preventDefault(); closeDetails();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, playing]);

  if (me.isPending) return <div className="boot"><Logo /><p>Connecting to your cinema…</p></div>;
  if (me.isError && statusOf(me.error) === 401) return <Login onLogin={() => {
    qc.removeQueries({ predicate: query => query.queryKey[0] !== 'me' });
    void qc.invalidateQueries({ queryKey: ['me'] });
  }} />;
  if (!me.data) return <div className="boot" role="alert"><Logo />
    <p>{me.error?.message || 'Could not reach your Jellyfin server.'}</p>
    <button className="btn" onClick={() => void me.refetch()}>Retry connection</button></div>;

  const user = me.data.user;
  const recent = uniqueWatchEntries(resume.data?.Items ?? []);
  const upcoming = uniqueWatchEntries(recent, nextup.data?.Items ?? []);
  const all = [...(movies.data?.Items || []), ...(series.data?.Items || [])];
  const hero = all.find(i => i.CommunityRating && i.CommunityRating >= 7) || all[0];
  const libraryError = (movies.error || series.error)?.message;
  const retryLibrary = () => { void movies.refetch(); void series.refetch(); };
  const open = (item: Item) => {
    if (!selected) savedScroll.current = window.scrollY;
    // Episodes and seasons open their series; everything else opens itself.
    if ((item.Type === 'Episode' || item.Type === 'Season') && item.SeriesId) setSelected({ Id: item.SeriesId, Name: item.SeriesName || item.Name, Type: 'Series' });
    else setSelected(item);
  };
  const play = (item: Item) => setPlaying(item);
  const goTab = (next: Tab) => { setSelected(null); setTab(next); };
  const nav = { onOpen: open, onPlay: play };
  /** Render a browse page if it is showing or was visited before; hide it otherwise. */
  const keep = (t: Tab, page: React.ReactNode) => (t === tab || kept.includes(t))
    && <div className="view" hidden={!!selected || t !== tab}>{page}</div>;

  return <div className="app">
    <TopNav tab={tab} user={user} onTab={goTab} onOpen={open} onSignOut={() => logout.mutate()}
      onSearchAll={term => { setSearchTerm(term); goTab('search'); }} />
    <main id="content">
      {selected && <DetailsPage key={selected.Id} item={selected} nextUp={nextup.data?.Items || []} onBack={closeDetails}
        onPlay={play} onChanged={() => void qc.invalidateQueries()} />}
      {keep('home', <HomePage hero={hero} recent={recent} upNext={upcoming.slice(recent.length)} movies={movies.data?.Items || []}
        series={series.data?.Items || []} loading={movies.isPending || series.isPending} error={libraryError} onRetry={retryLibrary} {...nav} />)}
      {keep('movies', <LibraryPage kind="movies" nextUp={[]} {...nav} />)}
      {keep('series', <LibraryPage kind="series" nextUp={upcoming.filter(i => i.Type === 'Episode')} {...nav} />)}
      {keep('mylist', <MyListPage watching={upcoming} loadingWatching={resume.isPending || nextup.isPending} {...nav} />)}
      {!selected && <Suspense fallback={pageFallback}>
        {tab === 'search' && <SearchPage initial={searchTerm} {...nav} />}
        {tab === 'requests' && <RequestsPage user={user} onShowDownloads={() => goTab(user.isAdmin ? 'downloads' : 'requests')} />}
        {(tab === 'settings' || tab === 'downloads' || tab === 'admin') && <SettingsPage user={user} tab={tab} onTab={goTab} onSignOut={() => logout.mutate()} />}
      </Suspense>}
    </main>
    {playing && <Suspense fallback={<div className="player"><div className="player-message"><span className="spinner" aria-label="Loading player" /></div></div>}><Player key={playing.Id} item={playing} onNext={next => setPlaying(next as Item)} onClose={() => {
      setPlaying(null);
      for (const key of ['resume', 'nextup', 'movies', 'series', 'library', 'item', 'episodes']) void qc.invalidateQueries({ queryKey: [key] });
    }} /></Suspense>}
  </div>;
}

initTheme();
enableTvNavigation();
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
