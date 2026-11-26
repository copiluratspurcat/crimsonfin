import { classifyTorrent, parseTorrentInfo } from './media-layout.mjs';
import { parseTorrentSizeBytes } from './download-manager.mjs';

const normal = title => String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,'');
const safeError = message => String(message || 'Unable to process release').replace(/(passkey|token|apikey)=[^\s&]+/ig,'$1=[hidden]').slice(0,200);
const err = (text,code=400)=>Object.assign(new Error(text),{status:code});
const stamp=()=>Date.now();

export function chooseExactRelease(request, result) {
  const wanted=normal(request.title);
  const exact=(result?.results||[]).filter(r=>r.downloadable && normal(r.name)===wanted && r.seeders!==0);
  return exact.length===1 ? exact[0] : null;
}
export function searchTerm(request) {
  const title=String(request.title||'').trim();
  // FileList's name index supports full release names; use a broad fallback
  // when punctuation and release tags prevent literal lookups.
  const initial=title.replace(/[._]+/g,' ').split(/\s+/);
  if(initial.length<4)return title.slice(0,90);
  const season=initial.find(x=>/^s\d{1,2}$/i.test(x));
  const year=initial.find(x=>/^(19|20)\d{2}$/.test(x));
  const base=initial.slice(0,Math.min(3,initial.length)).filter(x=>!/^s\d/i.test(x));
  return [...base,...(year&&!base.includes(year)?[year]:[]),...(season&&!base.includes(season)?[season]:[])].join(' ').slice(0,95);
}
export function initRequestJobs(db){
  db.exec(`CREATE TABLE IF NOT EXISTS request_jobs (
    request_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'needs_review',
    release_id TEXT NOT NULL DEFAULT '',
    release_name TEXT NOT NULL DEFAULT '',
    torrent_hash TEXT NOT NULL DEFAULT '',
    drive TEXT NOT NULL DEFAULT '',
    destination TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )`);
}
export function createRequestFulfillment({db,filelist,downloadManager}){
  const find=id=>db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  const get=id=>db.prepare('SELECT * FROM request_jobs WHERE request_id = ?').get(id);
  const save=(id,fields)=>{
    const prev=get(id)||{request_id:id,state:'needs_review',release_id:'',release_name:'',torrent_hash:'',drive:'',destination:'',detail:''};
    const v={...prev,...fields,updated_at:stamp()};
    if (!find(id)) return v;
    db.prepare(`INSERT INTO request_jobs
      (request_id,state,release_id,release_name,torrent_hash,drive,destination,detail,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(request_id) DO UPDATE SET
      state=excluded.state,release_id=excluded.release_id,release_name=excluded.release_name,
      torrent_hash=excluded.torrent_hash,drive=excluded.drive,destination=excluded.destination,
      detail=excluded.detail,updated_at=excluded.updated_at`)
     .run(v.request_id,v.state,v.release_id,v.release_name,v.torrent_hash,v.drive,v.destination,v.detail,v.updated_at);
    return get(id);
  };
  const inFlight = new Set();
  const active=state=>['searching','queued','downloading','completed'].includes(state);
  async function queue(requestId,userId,releaseId,results=null){
    const request=find(requestId);
    if(!request||request.status!=='approved')throw err('Only approved requests can be downloaded',409);
    const prev=get(requestId);
    if(prev && active(prev.state) && prev.state!=='searching')return prev; // never queue twice
    let releases=results;
    if(!releases){
      releases=await filelist.search(searchTerm(request),userId);
    }
    const selected=releases?.results?.find(r=>r.id===String(releaseId)&&r.downloadable);
    if(!selected)throw err('This release is not available. Search again.',404);
    // Determine media type from torrent CONTENTS, never from the request's
    // potentially wrong Movie/TV dropdown.
    const bytes=await filelist.torrentFor(userId,selected.id);
    const layout=classifyTorrent(bytes,selected.name,'movie');
    const advertised=selected.name.match(/(?:^|[._\s-])S(\d{1,2})(?=[._\s-]|$)/i);
    const actualName=parseTorrentInfo(bytes).rootName.match(/(?:^|[._\s-])S(\d{1,2})(?=[._\s-]|$)/i);
    const claimed=advertised?Number(advertised[1]):null;
    const actual=layout.seasonNumber || (actualName ? Number(actualName[1]) : null);
    if (claimed!==null && actual!==null && claimed!==actual) {
      return save(requestId,{state:'needs_review',release_id:selected.id,release_name:selected.name,
        detail:'Tracker advertises Season '+claimed+' but the torrent contains Season '+actual+'. Nothing was downloaded. Choose another release.'});
    }
    if (claimed!==null && actualName && Number(actualName[1])!==claimed) {
      return save(requestId,{state:'needs_review',release_id:selected.id,release_name:selected.name,
        detail:'Tracker listing and torrent root folder disagree about the season. Download blocked.'});
    }
    if(layout.kind!==request.kind) {
      return save(requestId,{state:'needs_review',detail:`This release is a ${layout.kind==='movie'?'movie':'TV show'} but the request was submitted as ${request.kind==='movie'?'a movie':'a TV show'}. Edit the request type first.`});
    }
    const hash=parseTorrentInfo(bytes).infoHash||'';
    const jobs=await downloadManager.listRaw();
    if(jobs.some(j=>j.hash===hash)){
      const exists=jobs.find(j=>j.hash===hash);
      return save(requestId,{state:exists.progress>=1?'completed':'downloading',release_id:selected.id,
        release_name:selected.name,torrent_hash:hash,drive:'',destination:exists.save_path,
        detail:'Already present in qBittorrent; no duplicate torrent was added.'});
    }
    if (find(requestId)?.status !== 'approved') throw err('Request is no longer approved', 409);
    const queued=await downloadManager.queueTorrentFile(bytes,layout.kind,parseTorrentSizeBytes(selected.size),selected.name);
    return save(requestId,{state:queued.existing ? (queued.complete ? 'completed' : 'downloading') : 'queued',
      release_id:selected.id,release_name:selected.name,torrent_hash:hash,drive:queued.drive,destination:queued.folder,
      detail:queued.existing ? 'Already present in qBittorrent; no duplicate torrent was added.' : ''});
  }
  async function process(requestId,userId){
    const request=find(requestId);
    if(!request)throw err('Request not found',404);
    if(request.status!=='approved')throw err('Approve the request first',409);
    const prev=get(requestId);
    if(prev&&active(prev.state)&&prev.state!=='searching')return prev;
    if (inFlight.has(requestId) || (prev?.state === 'searching' && stamp() - prev.updated_at < 90_000)) return prev;
    save(requestId,{state:'searching',detail:''});
    inFlight.add(requestId);
    try{
      const q=searchTerm(request);
      let options=await filelist.search(q,userId);
      let selected=chooseExactRelease(request,options);
      if(!selected && q.toLowerCase()!==request.title.trim().toLowerCase()) {
        const specific=await filelist.search(request.title.slice(0,99),userId);
        const matched=chooseExactRelease(request,specific);
        if(matched){options=specific;selected=matched}
      }
      if(!selected){
        return save(requestId,{state:'needs_review',
          detail:options?.results?.length?'Several or no exact release matches; select a release below.':'No matching release found on FileList. Try searching manually.'});
      }
      // Mark the specific torrent while starting to prevent concurrent approval races.
      save(requestId,{state:'searching',release_id:selected.id,release_name:selected.name});
      return await queue(requestId,userId,selected.id,options);
    }catch(error){
      return save(requestId,{state:'failed',detail:safeError(error?.message||'FileList or downloader unavailable')});
    } finally { inFlight.delete(requestId); }
  }
  async function options(requestId,userId){
    const request=find(requestId);
    if(!request || request.status!=='approved')throw err('Approve the request first',409);
    const result=await filelist.search(searchTerm(request),userId);
    return {requestId,query:searchTerm(request),results:result.results||[],source:result.source};
  }
  async function select(requestId,userId,releaseId){
    const current=get(requestId);
    const staleSearch=current?.state==='searching'&&stamp()-current.updated_at>=90_000;
    if (inFlight.has(requestId) || (current && active(current.state) && !staleSearch)) return current;
    if (find(requestId)?.status !== 'approved') throw err('Approve the request first', 409);
    save(requestId,{state:'searching',release_id:String(releaseId),detail:''});
    inFlight.add(requestId);
    try {
      const result = await options(requestId,userId);
      return await queue(requestId,userId,releaseId,result);
    } catch(error) {
      return save(requestId,{state:'failed',detail:safeError(error?.message)});
    } finally { inFlight.delete(requestId); }
  }
  function deleteRequests(ids) {
    db.exec('BEGIN');
    try {
      const deleteJob = db.prepare('DELETE FROM request_jobs WHERE request_id = ?');
      const deleteRequest = db.prepare('DELETE FROM requests WHERE id = ?');
      for (const id of ids) {
        deleteJob.run(id);
        deleteRequest.run(id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function deleteRequest(id) {
    if (!find(id)) throw err('Request not found', 404);
    const job = get(id);
    if (inFlight.has(id) || (job?.state === 'searching' && stamp() - job.updated_at < 90_000)) {
      throw err('This request is being processed. Try again shortly.', 409);
    }
    deleteRequests([id]);
  }
  async function syncProgress(){
    const previouslyDeleted = db.prepare("SELECT request_id FROM request_jobs WHERE state = 'failed' AND torrent_hash = '' AND detail = ?")
      .all('An administrator deleted this download and requested removal of its files. Retry or choose another release.');
    if (previouslyDeleted.length) deleteRequests(previouslyDeleted.map(row => row.request_id));
    const rows = db.prepare(`SELECT j.*, r.kind, r.status FROM request_jobs j JOIN requests r ON r.id = j.request_id
      WHERE j.state IN ('queued','downloading','completed') AND j.torrent_hash != ''`).all();
    if(!rows.length)return;
    const jobs=await downloadManager.listRaw();
    const byHash=new Map(jobs.map(j=>[String(j.hash).toLowerCase(),j]));
    // listRaw caps the list at 500, so "missing" is only trusted below that.
    const complete=jobs.length<500;
    for(const row of rows){
      const t=byHash.get(row.torrent_hash.toLowerCase());
      if (get(row.request_id)?.torrent_hash !== row.torrent_hash) continue;
      if (t) {
        const state = Number(t.progress) >= 1 ? 'completed' : 'downloading';
        if (row.state !== state) save(row.request_id, { state });
        if (state === 'completed' && ['approved','fulfilled'].includes(row.status) &&
            await downloadManager.isInLibrary(t, row.kind).catch(() => false)) {
          const request = find(row.request_id);
          if (request?.kind === row.kind && ['approved','fulfilled'].includes(request.status) &&
              get(row.request_id)?.torrent_hash === row.torrent_hash) deleteRequests([row.request_id]);
        }
      } else if (complete && stamp()-row.updated_at > 120_000) {
        save(row.request_id,{state:'failed',detail:'The download was removed from qBittorrent. Retry or choose another release.'});
      }
    }
  }
  function markDownloadDeleted(hash) {
    const rows = db.prepare('SELECT request_id FROM request_jobs WHERE lower(torrent_hash) = ?').all(hash);
    if (rows.length) deleteRequests(rows.map(row => row.request_id));
  }
  function listRows(user){
    const rows=user.isAdmin?
      db.prepare("SELECT r.*, j.state AS download_state,j.release_name,j.drive,j.destination,j.detail AS download_detail FROM requests r LEFT JOIN request_jobs j ON j.request_id=r.id ORDER BY r.created_at DESC LIMIT 300").all():
      db.prepare("SELECT r.*, j.state AS download_state,j.release_name,j.drive,j.destination,j.detail AS download_detail FROM requests r LEFT JOIN request_jobs j ON j.request_id=r.id WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 200").all(user.userId);
    return rows.map(row=>({...row,user_id:undefined}));
  }
  return { process, options, select, syncProgress, deleteRequest, markDownloadDeleted, listRows, get, save };
}
