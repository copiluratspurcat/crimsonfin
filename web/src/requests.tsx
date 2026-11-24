import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, DownloadCloud, Film, Plus, RefreshCw, Search, Send, Tv2 } from 'lucide-react';
import { api, type Account, type Release, type RequestEntry } from './lib';
import { Empty, PageHead, StatusDot } from './ui';

export function downloadStatusLabel(state?: string | null) {
  const labels: Record<string, string> = {
    searching: 'Searching FileList', needs_review: 'Needs release selection',
    queued: 'Queued in qBittorrent', downloading: 'Downloading',
    completed: 'Downloaded', failed: 'Unable to queue'
  };
  return labels[state || ''] || 'Approved · not queued yet';
}
const statusTone = (r: RequestEntry) => r.status === 'fulfilled' ? 'green' : r.status === 'rejected' ? 'grey'
  : r.status === 'approved' ? (r.download_state === 'failed' || r.download_state === 'needs_review' ? 'amber' : 'blue') : 'amber';
const statusText = (r: RequestEntry) => r.status === 'fulfilled' ? 'Available' : r.status === 'rejected' ? 'Declined'
  : r.status === 'approved' ? downloadStatusLabel(r.download_state) : 'Pending';

export function RequestsPage({ user, onShowDownloads }: { user: Account; onShowDownloads: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'movie' | 'series'>('movie');
  const [title, setTitle] = useState(''); const [year, setYear] = useState(''); const [notes, setNotes] = useState('');
  const [search, setSearch] = useState(''); const [searchCommitted, setSearchCommitted] = useState('');
  const [queueKind, setQueueKind] = useState<'movie' | 'series'>('movie');
  const requests = useQuery({ queryKey: ['requests'], queryFn: () => api<{ requests: RequestEntry[] }>('/api/requests'), refetchInterval: 20000 });
  const filelistSettings = useQuery({ queryKey: ['filelistAdminSettings'], enabled: user.isAdmin,
    queryFn: () => api<{ apiConfigured: boolean; downloaderConfigured: boolean }>('/api/admin/filelist/settings') });
  const queue = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'movie' | 'series' }) =>
      api<{ queued: boolean; drive: string; folder: string; kind: 'movie' | 'series'; classifiedAsShow: boolean }>(
        '/api/admin/filelist/queue/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify({ kind }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['downloadManager'] })
  });
  const catalog = useQuery({ queryKey: ['filelist', searchCommitted], enabled: searchCommitted.length > 1, staleTime: 300000,
    queryFn: () => api<{ configured: boolean; results: Release[]; source?: string }>(`/api/filelist/search?q=${encodeURIComponent(searchCommitted)}`) });
  const create = useMutation({
    mutationFn: () => api('/api/requests', { method: 'POST', body: JSON.stringify({ kind, title, year, notes }) }),
    onSuccess: () => { setTitle(''); setYear(''); setNotes(''); void qc.invalidateQueries({ queryKey: ['requests'] }); }
  });
  const list = requests.data?.requests || [];
  return <div className="page requests">
    <PageHead title="Requests" meta="Ask for a movie or show. An admin reviews every request." />
    <div className="requests-layout">
      <div className="stack">
        <form className="panel" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
          <h2>New request</h2>
          <div className="segmented" role="radiogroup" aria-label="Media type">
            <button type="button" role="radio" aria-checked={kind === 'movie'} className={kind === 'movie' ? 'active' : ''} onClick={() => setKind('movie')}><Film aria-hidden /> Movie</button>
            <button type="button" role="radio" aria-checked={kind === 'series'} className={kind === 'series' ? 'active' : ''} onClick={() => setKind('series')}><Tv2 aria-hidden /> Show</button>
          </div>
          <label className="field"><span>Title</span><input required minLength={2} maxLength={180} placeholder="What would you like to watch?" value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label className="field"><span>Year (optional)</span><input type="number" min={1888} max={2100} placeholder="2026" value={year} onChange={e => setYear(e.target.value)} /></label>
          <label className="field"><span>Notes (optional)</span><textarea maxLength={500} rows={3} placeholder="Edition, language, season…" value={notes} onChange={e => setNotes(e.target.value)} /></label>
          <button className="btn primary block" type="submit" disabled={create.isPending}><Send aria-hidden />{create.isPending ? 'Sending…' : 'Send request'}</button>
          {create.isSuccess && <p className="success" role="status"><Check aria-hidden /> Request saved.</p>}
          {create.error && <p className="error" role="alert">{create.error.message}</p>}
        </form>
        <div className="panel">
          <h2>Find it on FileList</h2>
          <p className="muted">Search movies, shows and anime. Pick a result to use its title in your request.</p>
          {user.isAdmin && <label className="field"><span>Download as</span>
            <select value={queueKind} onChange={e => setQueueKind(e.target.value as 'movie' | 'series')}>
              <option value="movie">Movie · Movies library</option><option value="series">Show · Shows library</option></select></label>}
          <form className="inline-form" onSubmit={e => { e.preventDefault(); setSearchCommitted(search.trim()); }}>
            <input minLength={2} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search FileList…" aria-label="Search FileList" />
            <button className="btn" type="submit" aria-label="Search FileList"><Search aria-hidden /></button>
          </form>
          {catalog.isFetching && <p className="muted" role="status">Searching FileList…</p>}
          {catalog.isError && <p className="error" role="alert">{catalog.error.message}</p>}
          {catalog.data && (!catalog.data.configured ? <Empty>FileList isn't configured on this server. You can still send requests.</Empty>
            : catalog.data.results.length ? <ul className="release-list">{catalog.data.results.map((r, index) => <li key={`${r.id}-${index}`} className="release">
              <button className="release-pick" title="Use this title" onClick={() => setTitle(r.name.replace(/\./g, ' '))}>
                <span><strong>{r.name}</strong><small>{r.size ? `${r.size} · ` : ''}{r.seeders == null ? 'Recent RSS entry' : `${r.seeders} seeders`}</small></span><Plus aria-hidden /></button>
              {user.isAdmin && catalog.data!.source === 'api' && r.downloadable && <span className="release-actions">
                <a className="btn small" href={`/api/admin/filelist/torrent/${r.id}`} download>.torrent</a>
                {filelistSettings.data?.downloaderConfigured && <button className="btn small primary" disabled={queue.isPending}
                  onClick={() => queue.mutate({ id: r.id, kind: queueKind })}>Download on server</button>}
              </span>}
            </li>)}</ul> : <Empty>No matching movies, shows or anime.</Empty>)}
          {queue.isSuccess && <p className="success" role="status">Queued as {queue.data?.kind === 'series' ? 'show' : 'movie'}{queue.data?.classifiedAsShow ? ' (auto-detected)' : ''} to {queue.data?.drive || 'the selected drive'} · {queue.data?.folder || 'the Jellyfin library'}.</p>}
          {queue.error && <p className="error" role="alert">{queue.error.message}</p>}
          {user.isAdmin && <button className="btn" onClick={onShowDownloads}><DownloadCloud aria-hidden /> View download progress</button>}
        </div>
      </div>
      <section className="request-list" aria-label={user.isAdmin ? 'All requests' : 'Your requests'}>
        <header className="row-head"><h2>{user.isAdmin ? 'All requests' : 'Your requests'}</h2><span className="muted">{list.length} total</span>
          <span className="spacer" /><button className="btn small" onClick={() => void requests.refetch()} disabled={requests.isFetching}><RefreshCw aria-hidden /> Refresh</button></header>
        {requests.isLoading ? <Empty>Loading requests…</Empty> : list.length ? <ul className="list">{list.map(r => <li key={r.id} className="list-row">
          <span className="list-text"><strong>{r.title}{r.year ? ` (${r.year})` : ''}</strong>
            <small>{r.kind === 'movie' ? 'Movie' : 'Show'} · {new Date(r.created_at).toLocaleDateString()}{user.isAdmin ? ` · ${r.user_name}` : ''}{r.notes ? ` · ${r.notes}` : ''}</small>
            {r.download_detail && <small className="detail" title={r.download_detail}>{r.download_detail}</small>}</span>
          <span className="status"><StatusDot tone={statusTone(r)} />{statusText(r)}</span>
        </li>)}</ul> : <Empty>No requests yet. Be the first to suggest something.</Empty>}
      </section>
    </div>
  </div>;
}
