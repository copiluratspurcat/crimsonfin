import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseStorage, parseTorrentSizeBytes, createDownloadManager } from '../server/download-manager.mjs';

const GiB = 1024 ** 3;
const drives = [
  {id:'ADATA',name:'ADATA',totalBytes:2_000*GiB,freeBytes:1_700*GiB,
    movieFolder:'/mnt/ADATA/Movies',seriesFolder:'/mnt/ADATA/Shows'},
  {id:'WD1TBLU',name:'WD1TBLU',totalBytes:900*GiB,freeBytes:180*GiB,
    movieFolder:'/mnt/WD1TBLU/movies',seriesFolder:'/mnt/WD1TBLU/shows'}
];

test('Automatic library selector uses the drive with the most unreserved free space',()=>{
  assert.deepEqual(chooseStorage(drives,'movie',12*GiB).savePath,'/mnt/ADATA/Movies');
  assert.equal(chooseStorage(drives,'series',12*GiB).savePath,'/mnt/ADATA/Shows');
  assert.equal(chooseStorage(drives,'series',12*GiB,{ADATA:1_695*GiB}).savePath,'/mnt/WD1TBLU/shows');
  assert.throws(()=>chooseStorage(drives,'series',190*GiB,{ADATA:1_650*GiB}),/Not enough available space/);
  assert.throws(()=>chooseStorage(drives,'other',1),/Choose Movie or TV Show/);
});

test('FileList sizes are parsed conservatively',()=>{
  assert.equal(parseTorrentSizeBytes('1.5 GiB'),1.5*GiB);
  assert.equal(parseTorrentSizeBytes('2 GB'),2e9);
  assert.equal(parseTorrentSizeBytes('unknown'),0);
  assert.equal(parseTorrentSizeBytes(-10),0);
});

test('Authenticated qBittorrent queue sets the proper Movies or Shows savepath', async()=>{
  let loginCount=0;
  const paths=[];
  const env={QBIT_URL:'http://127.0.0.1:8877',QBIT_USERNAME:'test-user',QBIT_PASSWORD:'test-pass'};
  const fakeFetch=async(url,init={})=>{
    const u=new URL(url);
    assert.equal(u.hostname,'127.0.0.1');
    if(u.pathname==='/api/v2/auth/login'){
      loginCount++;
      assert.match(String(init.body),/username=test-user/);
      return new Response('Ok.',{headers:{'set-cookie':'SID=session-test; HttpOnly'}});
    }
    assert.equal(init.headers.cookie,'SID=session-test');
    if(u.pathname==='/api/v2/torrents/info'){
      return Response.json([{hash:'a'.repeat(40),name:'Existing Movie',state:'downloading',
        save_path:'/mnt/ADATA/Movies',amount_left:1_600*GiB,progress:0.35,
        size:10*GiB,downloaded:4*GiB,dlspeed:560_000,upspeed:1000,eta:32}]);
    }
    if(u.pathname==='/api/v2/torrents/add'){
      assert.equal(init.method,'POST');
      assert.equal(init.body.get('stopped'),'false');
      assert.equal(init.body.get('autoTMM'),'false');
      paths.push(init.body.get('savepath'));
      return new Response('Ok.');
    }
    throw new Error('Unexpected WebUI method '+u.pathname);
  };
  const client=createDownloadManager({env,fetchImpl:fakeFetch,storageProvider:()=>drives});
  const result=await client.queueTorrentFile(Buffer.from('d3:foo3:bare'), 'series', 12*GiB);
  assert.equal(result.queued,true);
  assert.equal(result.drive,'WD1TBLU','unfinished downloads reserve space');
  assert.equal(result.folder,'/mnt/WD1TBLU/shows');
  assert.deepEqual(paths,['/mnt/WD1TBLU/shows']);
  assert.equal(loginCount,1,'qBittorrent session reused');
  const status=await client.status();
  assert.equal(status.online,true);
  assert.equal(status.downloads.length,1);
  assert.equal(status.downloads[0].progress,35);
  assert.equal(status.active,1);
});

test('qBittorrent endpoint is restricted to loopback',()=>{
  assert.throws(()=>createDownloadManager({env:{QBIT_URL:'http://192.168.1.10:8080'}}),/loopback/);
  assert.throws(()=>createDownloadManager({env:{QBIT_URL:'https://evil.test:8080'}}),/loopback/);
});
