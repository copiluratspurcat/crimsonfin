import { FileListRelease } from './filelist-release';
import { bestSeedCount } from './filelist-presentation';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { requestDeadline, api, type Release, type RequestEntry } from './lib';
import { Empty, StatusDot } from './ui';
import { downloadStatusLabel } from './requests';

export function AdminSection() {
  const qc = useQueryClient();
  const requests = useQuery({ queryKey: ['requests'], queryFn: () => api<{ requests: RequestEntry[] }>('/api/requests'), refetchInterval: 15000 });
  const status = useQuery({ queryKey: ['adminStatus'], refetchInterval: 45000,
    queryFn: () => api<{ jellyfinReachable: boolean; filelistConfigured: boolean; pendingRequests: number }>('/api/admin/status') });
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const options = useQuery({ queryKey: ['request-release-options', selectionId], enabled: !!selectionId, staleTime: 0,
    queryFn: () => api<{ requestId: string; query: string; results: Release[] }>('/api/requests/' + encodeURIComponent(selectionId!) + '/releases') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['requests'] });
    void qc.invalidateQueries({ queryKey: ['adminStatus'] });
    void qc.invalidateQueries({ queryKey: ['downloadManager'] });
  };
  const mutate = useMutation({
    mutationFn: (arg: { id: string; status: string; kind?: 'movie' | 'series' }) => api<{ ok: boolean }>(`/api/requests/${arg.id}`, {
      method: 'PATCH', body: JSON.stringify({ status: arg.status, ...(arg.kind ? { kind: arg.kind } : {}) }), signal: requestDeadline(50000) }),
    onSettled: refresh
  });
  const retry = useMutation({
    mutationFn: (id: string) => api('/api/requests/' + encodeURIComponent(id) + '/process', { method: 'POST', body: JSON.stringify({}), signal: requestDeadline(50000) }),
    onSettled: refresh
  });
  const queue = useMutation({
    mutationFn: (arg: { id: string; releaseId: string }) => api('/api/requests/' + encodeURIComponent(arg.id) + '/queue', {
      method: 'POST', body: JSON.stringify({ releaseId: arg.releaseId }), signal: requestDeadline(50000) }),
    onSuccess: () => setSelectionId(null),
    onSettled: refresh
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<RequestEntry | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/requests/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      if (selectionId === id) setSelectionId(null);
      dialog.current?.close();
      refresh();
    }
  });
  function askToDelete(request: RequestEntry) {
    remove.reset();
    setTarget(request);
    dialog.current?.showModal();
    cancel.current?.focus();
  }
  const busy = mutate.isPending || retry.isPending || queue.isPending || remove.isPending;
  const check = (loading: boolean, error: boolean, ok?: boolean, yes = 'Connected', no = 'Not connected') =>
    loading ? 'Checking…' : error ? 'Unavailable' : ok ? yes : no;
  const list = requests.data?.requests || [];
  const releases = (options.data?.results || []).slice(0, 25);
  const best = bestSeedCount(releases);
  return <div className="settings-content">
    <h2 className="section-title">Admin</h2>
    <div className="tiles">
      <Tile label="Jellyfin" tone={status.data?.jellyfinReachable ? 'green' : 'red'} value={check(status.isLoading, status.isError, status.data?.jellyfinReachable)} />
      <Tile label="FileList" tone={status.data?.filelistConfigured ? 'green' : 'amber'} value={check(status.isLoading, status.isError, status.data?.filelistConfigured, 'Configured', 'Not configured')} />
      <Tile label="Pending requests" tone="amber" value={String(status.data?.pendingRequests ?? '–')} />
      <SubtitleTile />
    </div>
    <header className="row-head"><h2>Review requests</h2><span className="muted">Approving searches FileList and queues an exact match automatically. Ambiguous results wait for you.</span></header>
    {list.length ? <ul className="list">{list.map(r => <li key={r.id} className="review">
      <div className="list-row">
        <span className="list-text"><strong>{r.title}</strong>
          <small>{r.user_name} · {r.kind === 'movie' ? 'Movie' : 'Show'}{r.year ? ' · ' + r.year : ''} · {r.notes || 'No notes'}</small></span>
        <label className="select"><select disabled={busy} aria-label={`Status for ${r.title}`} value={r.status} onChange={e => mutate.mutate({ id: r.id, status: e.target.value })}>
          <option value="pending">Pending</option><option value="approved">Approved</option>
          <option value="rejected">Declined</option><option value="fulfilled">Fulfilled</option></select></label>
        <button type="button" className="btn small delete-torrent" disabled={busy} aria-label={`Delete request for ${r.title}`}
          onClick={() => askToDelete(r)}><Trash2 aria-hidden /> Delete request</button>
      </div>
      {r.status === 'approved' && <div className="review-progress">
        <span className="status"><StatusDot tone={r.download_state === 'failed' || r.download_state === 'needs_review' ? 'amber' : 'blue'} />{downloadStatusLabel(r.download_state)}</span>
        {r.release_name && <span className="muted ellipsis" title={r.release_name}>{r.release_name}</span>}
        {r.download_detail && <span className="muted">{r.download_detail}</span>}
        {!['queued', 'downloading', 'completed', 'searching'].includes(r.download_state || '') && <span className="actions">
          <button className="btn small primary" disabled={busy} onClick={() => setSelectionId(selectionId === r.id ? null : r.id)}>
            <Search aria-hidden /> {selectionId === r.id ? 'Hide releases' : 'Choose release'}</button>
          <button className="btn small" disabled={busy} onClick={() => retry.mutate(r.id)}><RefreshCw aria-hidden /> {retry.isPending ? 'Searching…' : 'Retry search'}</button>
          <label className="select small"><span>Type:</span><select disabled={busy} value={r.kind} aria-label="Media type"
            onChange={e => mutate.mutate({ id: r.id, status: r.status, kind: e.target.value as 'movie' | 'series' })}>
            <option value="movie">Movie</option><option value="series">Show</option></select></label>
        </span>}
      </div>}
      {selectionId === r.id && r.status === 'approved' && <div className="release-picker">
        <strong>FileList matches</strong>
        {options.isFetching && <p className="muted">Searching tracker…</p>}
        {options.error && <p className="error">{options.error.message}</p>}
        {options.data && !options.data.results.length && <p className="muted">No releases found. Try another title or search FileList manually.</p>}
        {releases.map(x => <div className="list-row" key={x.id}>
          <FileListRelease release={x} best={best} />
          <button className="btn small primary" disabled={busy || !x.downloadable} onClick={() => queue.mutate({ id: r.id, releaseId: x.id })}>Download</button>
        </div>)}
      </div>}
    </li>)}</ul> : <Empty>No requests to review.</Empty>}
    {mutate.isPending && <p className="muted" role="status">Processing approval and checking FileList…</p>}
    {[mutate.error, retry.error, queue.error].filter(Boolean).map((e, i) => <p key={i} className="error" role="alert">{e!.message}</p>)}
    <dialog ref={dialog} className="dialog" aria-labelledby="delete-request-title" aria-describedby="delete-request-warning"
      onCancel={event => { if (remove.isPending) event.preventDefault(); }}
      onClose={() => setTarget(null)}>
      <h2 id="delete-request-title">Delete request?</h2>
      <p id="delete-request-warning">Remove “{target?.title}” from Requests. Its torrent and downloaded files will stay on the server.</p>
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      <div className="actions">
        <button type="button" className="btn" ref={cancel} disabled={remove.isPending} onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="button" className="btn destructive" disabled={!target || remove.isPending}
          onClick={() => target && remove.mutate(target.id)}>{remove.isPending ? 'Deleting…' : 'Delete request'}</button>
      </div>
    </dialog>
    <FileListConfiguration />
  </div>;
}

function Tile({ label, value, tone, sub }: { label: string; value: string; tone: 'green' | 'amber' | 'blue' | 'grey' | 'red'; sub?: string }) {
  return <div className="tile"><span className="tile-label"><StatusDot tone={tone} />{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

function SubtitleTile() {
  const stats = useQuery({ queryKey: ['subtitleCoverage'], refetchInterval: 120000,
    queryFn: () => api<{ enabled: boolean; summary?: { checked: number; haveRomanian: number; possiblyMissing: number; attempted: number; installed: number; lastScanUtc: string } }>('/api/admin/subtitles/status') });
  const s = stats.data?.summary;
  const percent = s?.checked ? Math.round(s.haveRomanian * 100 / s.checked) : 0;
  return <div className="tile" title={s?.lastScanUtc ? `Last scan ${new Date(s.lastScanUtc).toLocaleString()} · community subtitles only, no machine translation` : undefined}>
    <span className="tile-label"><StatusDot tone="blue" />Romanian subtitles</span>
    <strong>{s ? `${percent}%` : stats.isLoading ? 'Checking…' : 'Not scanned'}</strong>
    <small>{s ? `${s.haveRomanian.toLocaleString()} of ${s.checked.toLocaleString()} · ${s.possiblyMissing} missing` : 'The audit has not run yet'}</small>
    {s && <span className="meter" role="progressbar" aria-label="Romanian subtitle coverage" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }} /></span>}
  </div>;
}

function FileListConfiguration() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['filelistAdminSettings'],
    queryFn: () => api<{ apiConfigured: boolean; rssConfigured: boolean; rssPasskeyAvailable: boolean; username: string; downloaderConfigured: boolean }>('/api/admin/filelist/settings') });
  const [username, setUsername] = useState(''); const [passkey, setPasskey] = useState(''); const [dirty, setDirty] = useState(false);
  useEffect(() => { if (settings.data && !dirty) setUsername(settings.data.username || ''); }, [settings.data, dirty]);
  const save = useMutation({
    mutationFn: () => api('/api/admin/filelist/settings', { method: 'POST', signal: requestDeadline(10000),
      body: JSON.stringify({ username, ...(passkey.trim() ? { passkey: passkey.trim() } : {}) }) }),
    onSuccess: () => {
      setPasskey(''); setDirty(false);
      for (const key of ['filelistAdminSettings', 'adminStatus', 'filelist']) void qc.invalidateQueries({ queryKey: [key] });
    }
  });
  return <form className="panel" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    <h2><ShieldCheck aria-hidden /> FileList API search</h2>
    <p className="muted">{settings.data?.apiConfigured ? 'Full FileList catalog search is enabled.' : 'RSS is active. Add your FileList username to enable full API search.'} Credentials are kept on the server only.</p>
    <div className="form-grid">
      <label className="field"><span>FileList username</span><input autoComplete="off" maxLength={100} placeholder="Your FileList username" value={username}
        onChange={e => { setUsername(e.target.value); setDirty(true); }} /></label>
      <label className="field"><span>API passkey (optional)</span><input type="password" autoComplete="new-password" maxLength={256} value={passkey}
        placeholder={settings.data?.rssPasskeyAvailable ? 'Leave empty to reuse the stored RSS passkey' : 'FileList API passkey'} onChange={e => setPasskey(e.target.value)} /></label>
    </div>
    <div className="actions"><button type="submit" className="btn primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save FileList settings'}</button></div>
    {save.isSuccess && <p className="success" role="status">Saved. Search again to check the login.</p>}
    {save.error && <p className="error" role="alert">{save.error.message}</p>}
    <p className="muted">Admins can download .torrent files after an API search. To download straight onto the server, configure a password-protected qBittorrent Web API.</p>
  </form>;
}
