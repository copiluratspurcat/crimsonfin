import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequestFulfillment, chooseExactRelease, initRequestJobs, searchTerm } from '../server/request-fulfillment.mjs';

const enc = v => {
 if(typeof v === 'number') return Buffer.from('i'+v+'e');
 if(Buffer.isBuffer(v) || typeof v === 'string'){const b=Buffer.from(v);return Buffer.concat([Buffer.from(b.length+':'),b]);}
 if(Array.isArray(v))return Buffer.concat([Buffer.from('l'),...v.map(enc),Buffer.from('e')]);
 return Buffer.concat([Buffer.from('d'),...Object.keys(v).sort().flatMap(k=>[enc(k),enc(v[k])]),Buffer.from('e')]);
};
const title='Lupin 2021 S03 2160p NF WEB-DL DD+5 1 Atmos H 265-GRACE';
const release='Lupin.2021.S03.2160p.NF.WEB-DL.DD+5.1.Atmos.H.265-GRACE';
const info=enc({info:{name:release,files:[
 {length:1000000,path:['Lupin.2021.S03E01.mkv']},
 {length:1000000,path:['Lupin.2021.S03E02.mkv']}
 ],'piece length':16384,pieces:Buffer.alloc(20)}});
function fixture(requestTitle=title,kind='series',torrentBytes=info) {
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE requests (id TEXT PRIMARY KEY,title TEXT,kind TEXT,status TEXT,year INTEGER,notes TEXT,created_at INTEGER,user_id TEXT,user_name TEXT,updated_at INTEGER)');
 db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?,?)').run('requested-item',requestTitle,kind,'approved',null,'',Date.now(),'requester','Friend',Date.now());
 initRequestJobs(db);
 const attempts=[];let calls=0;
 const filelist={
  search:async(query,userId)=>{attempts.push(['search',query,userId]);return {
   source:'api',results:[{id:'980045',name:release,downloadable:true,seeders:30,size:'52696943461'}]}},
  torrentFor:async()=>torrentBytes
 };
 const downloadManager={
  listRaw:async()=>[],queueTorrentFile:async(torrent,typ,size,name)=>{
   calls++;attempts.push(['queue',typ,size,name]);
   return {queued:true,drive:'ADATA',folder:'/mnt/ADATA/Shows/Lupin 2021/Season 03'};
  }
 };
 const service=createRequestFulfillment({db,filelist,downloadManager});
 return {db,service,attempts,getCalls:()=>calls};
}
test('Exactly matching punctuation variants choose one release and skip ambiguous pairs',()=>{
 const req={title};
 const candidate={id:'980045',name:release,downloadable:true,seeders:30};
 assert.equal(chooseExactRelease(req,{results:[candidate]}).id,'980045');
 assert.equal(chooseExactRelease(req,{results:[candidate,{...candidate,id:'22'}]}),null);
 assert.equal(chooseExactRelease(req,{results:[{...candidate,name:'Lupin.S02.1080p'}]}),null);
 assert.equal(searchTerm(req),'Lupin 2021 S03');
});
test('Approved exact TV match starts one torrent and stays idempotent',async()=>{
 const f=fixture();
 try{
  const first=await f.service.process('requested-item','administrator');
  assert.equal(first.state,'queued');
  assert.equal(first.release_id,'980045');
  assert.match(first.torrent_hash,/^[a-f0-9]{40}$/);
  assert.equal(first.drive,'ADATA');
  assert.equal(f.getCalls(),1);
  const second=await f.service.process('requested-item','administrator');
  assert.equal(second.state,'queued');
  assert.equal(f.getCalls(),1,'must not duplicate qBittorrent jobs');
  assert.ok(f.service.listRows({isAdmin:true})[0].download_state==='queued');
 }finally{f.db.close()}
});
test('An approved request with a mismatched Movie/TV type does not queue',async()=>{
 const f=fixture(title,'movie');
 try{
  const result=await f.service.process('requested-item','administrator');
  assert.equal(result.state,'needs_review');
  assert.match(result.detail,/TV show/);
  assert.equal(f.getCalls(),0);
 }finally{f.db.close()}
});
test('A request with no exact match is held for review, not blindly downloaded',async()=>{
 const f=fixture('A Completely Different Title','movie');
 try{
  const result=await f.service.process('requested-item','administrator');
  assert.equal(result.state,'needs_review');
  assert.equal(f.getCalls(),0);
 }finally{f.db.close()}
});

test('Tracker S03 whose actual torrent contains S04 is blocked before qBittorrent',async()=>{
 const bad=enc({info:{name:'Lupin.S04.2160p.WEB-DL',files:[
  {length:1000000,path:['Lupin.S04E01.mkv']},
  {length:1000000,path:['Lupin.S04E02.mkv']}],
  'piece length':16384,pieces:Buffer.alloc(20)}});
 const f=fixture(title,'series',bad);
 try{
  const result=await f.service.process('requested-item','admin');
  assert.equal(result.state,'needs_review');
  assert.match(result.detail,/Season 3.*Season 4/);
  assert.equal(f.getCalls(),0);
 }finally{f.db.close()}
});

test('A download removed from qBittorrent frees the request so it can be retried',async()=>{
 const {db,service}=fixture();
 const old=Date.now()-10*60_000;
 service.save('requested-item',{state:'downloading',torrent_hash:'a'.repeat(40)});
 db.prepare('UPDATE request_jobs SET updated_at=? WHERE request_id=?').run(old,'requested-item');
 await service.syncProgress(); // qBittorrent's list (listRaw) no longer has the torrent
 const row=service.get('requested-item');
 assert.equal(row.state,'failed');
 assert.match(row.detail,/removed from qBittorrent/);
});

test('A just-queued download is not marked removed before qBittorrent lists it',async()=>{
 const {service}=fixture();
 service.save('requested-item',{state:'queued',torrent_hash:'b'.repeat(40)});
 await service.syncProgress();
 assert.equal(service.get('requested-item').state,'queued');
});

test('A search interrupted by a restart does not block choosing a release',async()=>{
 const {db,service,getCalls}=fixture();
 service.save('requested-item',{state:'searching'});
 db.prepare('UPDATE request_jobs SET updated_at=? WHERE request_id=?').run(Date.now()-5*60_000,'requested-item');
 const outcome=await service.select('requested-item','admin','980045');
 assert.equal(outcome.state,'queued');
 assert.equal(getCalls(),1);
});
