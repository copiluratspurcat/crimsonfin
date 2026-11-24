import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryClient, statusOf, type Account, type Item, type PageResult } from './lib';
import { uniqueWatchEntries } from './continue-watching';
import { TopNav, type Tab } from './nav';
import { DetailsPage, HomePage, LibraryPage, MyListPage, SearchPage } from './pages';
import { RequestsPage } from './requests';
import { SettingsPage } from './settings';
import { Login } from './login';
import { Player } from './player';
import { Logo } from './ui';
import { initTheme } from './theme';
import { enableTvNavigation } from './tv';
import './spotlight.css';

function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: Account }>('/api/auth/me'), retry: false });
  const [tab, setTab] = useState<Tab>('home');
  const [selected, setSelected] = useState<Item | null>(null);
  const [playing, setPlaying] = useState<Item | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const signedIn = !!me.data;
  const movies = useQuery({ queryKey: ['movies'], queryFn: () => api<PageResult>('/api/library?type=movie'), enabled: signedIn });
  const series = useQuery({ queryKey: ['series'], queryFn: () => api<PageResult>('/api/library?type=series'), enabled: signedIn });
  const resume = useQuery({ queryKey: ['resume'], queryFn: () => api<PageResult>('/api/continue'), enabled: signedIn });
  const nextup = useQuery({ queryKey: ['nextup'], queryFn: () => api<PageResult>('/api/nextup'), enabled: signedIn });
  const logout = useMutation({
    mutationFn: () => api('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => { qc.clear(); setSelected(null); setPlaying(null); setTab('home'); void qc.invalidateQueries({ queryKey: ['me'] }); }
  });
  // A 401 from any library call means the Jellyfin session ended: re-check /me to show the login.
  const sessionExpired = [movies.error, series.error, resume.error, nextup.error].some(error => statusOf(error) === 401);
  useEffect(() => { if (sessionExpired) void qc.invalidateQueries({ queryKey: ['me'] }); }, [qc, sessionExpired]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab, selected?.Id]);
  // Escape / TV Back closes the details page (the player handles its own Escape).
  useEffect(() => {
    if (!selected || playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target instanceof HTMLElement && e.target.closest('.searchbox, .account, select')) return;
      e.preventDefault(); setSelected(null);
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
    // Episodes and seasons open their series; everything else opens itself.
    if ((item.Type === 'Episode' || item.Type === 'Season') && item.SeriesId) setSelected({ Id: item.SeriesId, Name: item.SeriesName || item.Name, Type: 'Series' });
    else setSelected(item);
  };
  const play = (item: Item) => setPlaying(item);
  const goTab = (next: Tab) => { setSelected(null); setTab(next); };
  const nav = { onOpen: open, onPlay: play };

  return <div className="app">
    <TopNav tab={tab} user={user} onTab={goTab} onOpen={open} onSignOut={() => logout.mutate()}
      onSearchAll={term => { setSearchTerm(term); goTab('search'); }} />
    <main id="content">
      {selected ? <DetailsPage key={selected.Id} item={selected} nextUp={nextup.data?.Items || []} onBack={() => setSelected(null)}
        onPlay={play} onChanged={() => void qc.invalidateQueries()} /> : <>
        {tab === 'home' && <HomePage hero={hero} recent={recent} upNext={upcoming.slice(recent.length)} movies={movies.data?.Items || []}
          series={series.data?.Items || []} loading={movies.isPending || series.isPending} error={libraryError} onRetry={retryLibrary} {...nav} />}
        {tab === 'movies' && <LibraryPage kind="movies" items={movies.data?.Items || []} nextUp={[]} loading={movies.isPending}
          error={movies.error?.message} onRetry={retryLibrary} {...nav} />}
        {tab === 'series' && <LibraryPage kind="series" items={series.data?.Items || []} nextUp={upcoming.filter(i => i.Type === 'Episode')}
          loading={series.isPending} error={series.error?.message} onRetry={retryLibrary} {...nav} />}
        {tab === 'mylist' && <MyListPage favorites={all.filter(i => i.UserData?.IsFavorite)} watching={upcoming}
          watched={all.filter(i => i.UserData?.Played)} loading={movies.isPending || series.isPending || resume.isPending || nextup.isPending} {...nav} />}
        {tab === 'search' && <SearchPage initial={searchTerm} {...nav} />}
        {tab === 'requests' && <RequestsPage user={user} onShowDownloads={() => goTab(user.isAdmin ? 'downloads' : 'requests')} />}
        {(tab === 'settings' || tab === 'downloads' || tab === 'admin') && <SettingsPage user={user} tab={tab} onTab={goTab} onSignOut={() => logout.mutate()} />}
      </>}
    </main>
    {playing && <Player key={playing.Id} item={playing} onClose={() => {
      setPlaying(null);
      for (const key of ['resume', 'nextup', 'movies', 'series', 'item', 'episodes']) void qc.invalidateQueries({ queryKey: [key] });
    }} />}
  </div>;
}

initTheme();
enableTvNavigation();
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
