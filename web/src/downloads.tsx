import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, HardDrive, RefreshCw, Trash2, Tv2 } from 'lucide-react';
import { api } from './lib';
import { Empty, StatusDot } from './ui';

type Drive = { id: string; name: string; totalBytes: number; freeBytes: number; movieFolder: string | null; seriesFolder: string | null };
type Transfer = { hash: string; name: string; state: string; progress: number; sizeBytes: number; downloadedBytes: number; remainingBytes: number; downloadSpeedBytes: number; uploadSpeedBytes: number; etaSeconds: number | null; drive: string; folder: string; seeding: boolean };
type Result = { online: boolean; error?: string; drives: Drive[]; downloads: Transfer[]; active: number };
const pretty = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return Math.round(bytes) + ' B';
  const i = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return (bytes / 1024 ** i).toFixed(i > 2 ? 2 : 1) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
};
const eta = (n: number | null) => n === null || n > 8640000 ? 'Unknown' : n <= 0 ? 'Soon' : n < 3600 ? Math.ceil(n / 60) + ' min' : n < 86400 ? Math.ceil(n / 3600) + ' h' : Math.ceil(n / 86400) + ' days';
const statuses: Record<string, string> = {
  downloading: 'Downloading', metaDL: 'Getting torrent info', forcedDL: 'Downloading',
  stalledDL: 'Waiting for peers', queuedDL: 'Queued', checkingDL: 'Checking files',
  pausedDL: 'Paused', stoppedDL: 'Stopped', uploading: 'Seeding', stalledUP: 'Seeding · Idle',
  pausedUP: 'Completed', stoppedUP: 'Completed', queuedUP: 'Completed', forcedUP: 'Seeding',
  error: 'Error', missingFiles: 'Files missing', allocating: 'Preparing storage'
};
async function getDownloads(): Promise<Result> {
  const response = await fetch('/api/admin/downloads', { credentials: 'same-origin', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Cannot retrieve downloader status');
  return response.json();
}

export function DownloadsSection() {
  const query = useQuery({ queryKey: ['downloadManager'], queryFn: getDownloads, refetchInterval: 3500, retry: 1, staleTime: 1000 });
  const qc = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<Transfer | null>(null);
  const [notice, setNotice] = useState('');
  const remove = useMutation({
    mutationFn: (torrent: Transfer) => api(`/api/admin/downloads/${encodeURIComponent(torrent.hash)}`, { method: 'DELETE' }),
    onSuccess: (_, torrent) => {
      dialog.current?.close();
      setNotice(`Deletion requested for “${torrent.name}”.`);
      void query.refetch();
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['adminStatus'] });
    },
    onError: () => { void query.refetch(); }
  });

  function confirmRemoval(torrent: Transfer) {
    remove.reset();
    setNotice('');
    setTarget(torrent);
    dialog.current?.showModal();
    cancelButton.current?.focus();
  }
  const data = query.data;
  const mostFree = data?.drives.length ? data.drives.reduce((a, b) => (b.freeBytes > a.freeBytes ? b : a)).id : '';
  return <div className="settings-content">
    <header className="row-head"><h2 className="section-title">Downloads</h2><span className="spacer" />
      <span className="status"><StatusDot tone={data?.online ? 'green' : query.isPending ? 'grey' : 'red'} />
        {query.isPending ? 'Checking qBittorrent…' : data?.online ? `qBittorrent connected · ${data.active} active` : 'qBittorrent unavailable'}</span>
      <button className="btn small" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw aria-hidden /> Refresh</button></header>
    {query.error && <p className="error" role="alert">{query.error.message}</p>}
    {data?.error && <p className="error" role="alert">{data.error}</p>}
    <div className="drives">{data?.drives.map(d => {
      const used = d.totalBytes ? Math.round((1 - d.freeBytes / d.totalBytes) * 100) : 0;
      return <article className="drive" key={d.id}>
        <header><HardDrive aria-hidden /><strong>{d.name}</strong>{d.id === mostFree && <span className="chip small">Most free space</span>}</header>
        <p className="drive-free"><strong>{pretty(d.freeBytes)}</strong> free of {pretty(d.totalBytes)}</p>
        <span className={used > 85 ? 'meter warn' : 'meter'} role="progressbar" aria-label={`${d.name} disk used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}><i style={{ width: `${used}%` }} /></span>
        {d.movieFolder && <small className="path"><Film aria-hidden /> {d.movieFolder}</small>}
        {d.seriesFolder && <small className="path"><Tv2 aria-hidden /> {d.seriesFolder}</small>}
      </article>;
    })}</div>
    {!data && <Empty>Checking available storage…</Empty>}
    <p className="muted">New downloads go straight into the Movies or Shows folder on the drive with the most free space. Space for unfinished downloads is reserved.</p>
    <h2 className="section-title">Torrents</h2>
    {notice && <p role="status">{notice}</p>}
    {data?.downloads.length ? <ul className="list">{data.downloads.map((x, i) => <li className="transfer" key={x.hash || i}>
      <div className="transfer-head">
        <span className="list-text"><strong title={x.name}>{x.name}</strong><small>{statuses[x.state] || x.state} · {x.drive} · {x.folder}</small></span>
        <span className="transfer-stat"><small>Speed</small>{x.progress >= 100 ? '—' : `${pretty(x.downloadSpeedBytes)}/s`}</span>
        <span className="transfer-stat"><small>Time left</small>{x.progress >= 100 ? 'Done' : eta(x.etaSeconds)}</span>
        <strong className="transfer-pct">{Math.floor(x.progress)}%</strong>
      </div>
      <span className="meter" role="progressbar" aria-label={`${x.name} progress`} aria-valuenow={x.progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${x.progress}%` }} /></span>
      <div className="transfer-actions">
        <small className="muted">{pretty(x.downloadedBytes)} of {pretty(x.sizeBytes)} · ↑ {pretty(x.uploadSpeedBytes)}/s</small>
        {x.hash && <button type="button" className="btn small delete-torrent" aria-label={`Delete ${x.name} and its files`}
          onClick={() => confirmRemoval(x)}><Trash2 aria-hidden /> Delete torrent</button>}
      </div>
    </li>)}</ul> : <Empty>{query.isPending ? 'Loading…' : data?.online
      ? 'No torrents in the download folders. Search FileList on the Requests page and choose “Download on server”.' : 'qBittorrent is unavailable. Check its service on the server.'}</Empty>}
    <dialog ref={dialog} className="dialog" aria-labelledby="delete-torrent-title" aria-describedby="delete-torrent-warning"
      onCancel={event => { if (remove.isPending) event.preventDefault(); }}
      onClose={() => setTarget(null)}>
      <h2 id="delete-torrent-title">Delete torrent and files?</h2>
      <p id="delete-torrent-warning"><strong>{target?.name}</strong> will be removed from qBittorrent and its downloaded files will be deleted from the server. Any linked request will also be removed.</p>
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      <div className="actions">
        <button type="button" className="btn" ref={cancelButton} disabled={remove.isPending} onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="button" className="btn destructive" disabled={!target || remove.isPending} onClick={() => target && remove.mutate(target)}>
          {remove.isPending ? 'Deleting…' : 'Delete torrent and files'}
        </button>
      </div>
    </dialog>
  </div>;
}
