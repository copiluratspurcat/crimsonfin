import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle2, DownloadCloud, HardDrive, RefreshCw, Tv2, Film } from 'lucide-react';

type Drive = { id:string; name:string; totalBytes:number; freeBytes:number; movieFolder:string|null; seriesFolder:string|null };
type Transfer = { hash:string; name:string; state:string; progress:number; sizeBytes:number; downloadedBytes:number; remainingBytes:number; downloadSpeedBytes:number; uploadSpeedBytes:number; etaSeconds:number|null; drive:string; folder:string; seeding:boolean };
type Result = { online:boolean; error?:string; drives:Drive[]; downloads:Transfer[]; active:number };
const pretty = (bytes:number) => {
  if (!Number.isFinite(bytes) || bytes<0) return '—';
  if (bytes<1024) return Math.round(bytes)+' B';
  const i=Math.min(4,Math.floor(Math.log(bytes)/Math.log(1024)));
  return (bytes/1024**i).toFixed(i>2?2:1)+' '+['B','KB','MB','GB','TB'][i];
};
const eta = (n:number|null) => n===null||n>8640000?'Unknown':n<=0?'Soon':n<3600?Math.ceil(n/60)+' min':n<86400?Math.ceil(n/3600)+' h':Math.ceil(n/86400)+' days';
const statuses:Record<string,string> = {
 downloading:'Downloading',metaDL:'Getting torrent info',forcedDL:'Downloading',
 stalledDL:'Waiting for peers',queuedDL:'Queued',checkingDL:'Checking files',
 pausedDL:'Paused',stoppedDL:'Stopped',uploading:'Seeding',stalledUP:'Seeding · Idle',
 pausedUP:'Completed',stoppedUP:'Completed',queuedUP:'Completed',forcedUP:'Seeding',
 error:'Error',missingFiles:'Files missing',allocating:'Preparing storage'
};
async function getDownloads():Promise<Result>{
 const response=await fetch('/api/admin/downloads',{credentials:'same-origin',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error('Cannot retrieve downloader status');
 return response.json();
}
export function DownloadsPanel(){
 const query=useQuery({queryKey:['downloadManager'],queryFn:getDownloads,refetchInterval:3500,retry:1,staleTime:1000});
 const data=query.data;
 return <section className="content-section downloads-page">
  <div className="heading"><span className="eyebrow"><DownloadCloud size={16}/> DOWNLOAD CENTER</span>
   <h1>Downloads & storage</h1>
   <p>Live qBittorrent progress. New downloads automatically use the Jellyfin library drive with the most available space.</p></div>
  <div className="download-summary">
   <div><Activity size={17}/>{data?.online?'Downloader online':'Downloader unavailable'}</div>
   <div><DownloadCloud size={17}/>{data?.active??0} active downloads</div>
   <button onClick={()=>query.refetch()} disabled={query.isFetching}><RefreshCw size={15}/> Refresh</button>
  </div>
  {query.error&&<p className="error">{query.error.message}</p>}
  {data?.error&&<p className="error">{data.error}</p>}
  <h2 className="download-heading"><HardDrive size={21}/> Hard drives</h2>
  <div className="drive-cards">{data?.drives.map(d=>{
    const used=d.totalBytes?Math.round((1-d.freeBytes/d.totalBytes)*100):0;
    return <article className="drive-card" key={d.id}>
      <div className="drive-head"><span><HardDrive size={19}/> {d.name}</span>
       {d.id===data.drives[0].id&&<small>Most free space</small>}</div>
      <strong className="drive-free">{pretty(d.freeBytes)} <span>available</span></strong>
      <div className="drive-meter" role="progressbar" aria-label={d.name+' disk used'}
       aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}><i style={{width:used+'%'}}/></div>
      <p>{pretty(d.totalBytes-d.freeBytes)} used · {pretty(d.totalBytes)} total</p>
      {d.movieFolder&&<div className="drive-path"><Film size={13}/><span>Movies · {d.movieFolder}</span></div>}
      {d.seriesFolder&&<div className="drive-path"><Tv2 size={13}/><span>Shows · {d.seriesFolder}</span></div>}
     </article>;
   })}</div>
  {!data&&<div className="empty-state">Checking available storage…</div>}
  <p className="drive-note">Files go directly into an existing Movies or Shows library folder. The server reserves space for unfinished downloads and keeps a safety margin.</p>
  <h2 className="download-heading"><DownloadCloud size={21}/> qBittorrent downloads
   {data?.online&&<span className="download-connected"><CheckCircle2 size={16}/> Connected</span>}</h2>
  {data?.downloads.length?<div className="download-list">
   {data.downloads.map((x,i)=><article className="download-entry" key={x.hash||i}>
    <div className="download-entry-head"><div><strong title={x.name}>{x.name}</strong>
      <small>{statuses[x.state]||x.state} · {x.drive}</small></div><strong>{x.progress.toFixed(1)}%</strong></div>
    <div className="download-meter" role="progressbar" aria-label={x.name+' progress'}
     aria-valuenow={x.progress} aria-valuemin={0} aria-valuemax={100}><i style={{width:x.progress+'%'}}/></div>
    <div className="download-details">
      <span>{pretty(x.downloadedBytes)} / {pretty(x.sizeBytes)}</span>
      <span>↓ {pretty(x.downloadSpeedBytes)}/s</span><span>↑ {pretty(x.uploadSpeedBytes)}/s</span>
      <span>{x.progress>=100?'Complete':'ETA '+eta(x.etaSeconds)}</span>
    </div><small className="download-location">Saving in {x.folder}</small>
   </article>)}
   </div>:<div className="empty-state">{query.isPending?'Loading…':
      data?.online?'No active downloads. Search FileList, choose Movie or TV Show, then click Download on server.':
      'qBittorrent is unavailable. Check its server service.'}</div>}
 </section>;
}
