import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseStorage, parseTorrentSizeBytes, createDownloadManager } from '../server/download-manager.mjs';

const enc = v => {
 if(typeof v === 'number') return Buffer.from('i'+v+'e');
 if(Buffer.isBuffer(v) || typeof v === 'string'){const b=Buffer.from(v);return Buffer.concat([Buffer.from(b.length+':'),b]);}
 if(Array.isArray(v))return Buffer.concat([Buffer.from('l'),...v.map(enc),Buffer.from('e')]);
 return Buffer.concat([Buffer.from('d'),...Object.keys(v).sort().flatMap(k=>[enc(k),enc(v[k])]),Buffer.from('e')]);
};

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
      assert.equal(init.body.get('contentLayout'),'NoSubfolder');
      paths.push(init.body.get('savepath'));
      return new Response('Ok.');
    }
    throw new Error('Unexpected WebUI method '+u.pathname);
  };
  const client=createDownloadManager({env,fetchImpl:fakeFetch,storageProvider:()=>drives,ensureSeriesFolder:()=>{}});
  const filename='Test.Series.S01E01.mkv';
  const metadata=Buffer.from('d4:infod4:name'+Buffer.byteLength(filename)+':'+filename+'6:lengthi1024eee');
  const result=await client.queueTorrentFile(metadata, 'series', 12*GiB, 'Test.Series.S01.1080p');
  assert.equal(result.queued,true);
  assert.equal(result.drive,'WD1TBLU','unfinished downloads reserve space');
  assert.equal(result.folder,'/mnt/WD1TBLU/shows/Test Series/Season 01');
  assert.deepEqual(paths,['/mnt/WD1TBLU/shows/Test Series/Season 01']);
  assert.equal(loginCount,1,'qBittorrent session reused');
  const status=await client.status();
  assert.equal(status.online,true);
  assert.equal(status.downloads.length,1);
  assert.equal(status.downloads[0].progress,35);
  assert.equal(status.active,1);
});

test('Manual FileList downloads reject mislabelled seasons before a queue request',async()=>{
 const bad=enc({info:{name:'Lupin.S04.2160p.WEB-DL',files:[{length:1000,path:['Lupin.S04E01.mkv']}], 'piece length':16384,pieces:Buffer.alloc(20)}});
 const client=createDownloadManager({env:{QBIT_URL:'http://127.0.0.1:8877'}});
 await assert.rejects(()=>client.queueTorrentFile(bad,'series',1,'Lupin.2021.S03.2160p'),/Season 3.*Season 4|Malformed/);
});

test('qBittorrent endpoint is restricted to loopback',()=>{
  assert.throws(()=>createDownloadManager({env:{QBIT_URL:'http://192.168.1.10:8080'}}),/loopback/);
  assert.throws(()=>createDownloadManager({env:{QBIT_URL:'https://evil.test:8080'}}),/loopback/);
});

test('delete sends one exact hash and only deletes torrents within the download folders', async () => {
  const hash = 'a'.repeat(40);
  const calls = [];
  let savePath = '/mnt/ADATA/Shows/Test Show/Season 01';
  let contentPath = savePath + '/episode.mkv';
  let found = true;
  const client = createDownloadManager({
    env: { QBIT_USERNAME: 'test', QBIT_PASSWORD: 'test' },
    storageProvider: () => drives,
    fetchImpl: async (url, init) => {
      if (url.pathname.endsWith('/auth/login')) return new Response('Ok.', { headers: { 'set-cookie': 'SID=test' } });
      if (url.pathname.endsWith('/torrents/info')) {
        assert.equal(url.searchParams.get('hashes'), hash);
        return Response.json(found ? [{ hash, save_path: savePath, content_path: contentPath }] : []);
      }
      assert.equal(url.pathname, '/api/v2/torrents/delete');
      assert.equal(init.method, 'POST');
      calls.push(Object.fromEntries(init.body));
      return new Response('');
    }
  });
  await assert.rejects(client.deleteTorrent('all'), { status: 400 });
  await assert.rejects(client.deleteTorrent(hash + '|' + hash), { status: 400 });
  await client.deleteTorrent(hash);
  contentPath = '/mnt/ADATA/Shows/Other Show/episode.mkv';
  await assert.rejects(client.deleteTorrent(hash), { status: 409 });
  savePath = '/tmp/downloads';
  await assert.rejects(client.deleteTorrent(hash), { status: 409 });
  found = false;
  await assert.rejects(client.deleteTorrent(hash), { status: 404 });
  assert.deepEqual(calls, [{ hashes: hash, deleteFiles: 'true' }]);
});

test('library placement requires a completed selected video at the expected size in the correct library', async t => {
  const { mkdtemp, mkdir, rm, writeFile, realpath } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  if (process.platform === 'win32') return t.skip('The downloader uses POSIX server paths');
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'cf-placement-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const movies = path.join(folder, 'Movies');
  await mkdir(movies);
  const hash = 'd'.repeat(40);
  let files = [{ name: 'Film.mkv', size: 10, progress: 1, priority: 1 }];
  const client = createDownloadManager({
    env: { QBIT_USERNAME: 'test', QBIT_PASSWORD: 'test' },
    storageProvider: () => [{ movieFolder: movies }],
    fetchImpl: async (url) => {
      if (url.pathname.endsWith('/auth/login')) return new Response('Ok.', { headers: { 'set-cookie': 'SID=test' } });
      assert.equal(url.pathname, '/api/v2/torrents/files');
      assert.equal(url.searchParams.get('hash'), hash);
      return Response.json(files);
    }
  });
  const torrent = { hash, save_path: movies, progress: 1, state: 'uploading' };
  assert.equal(await client.isInLibrary(torrent, 'movie'), false);
  await writeFile(path.join(movies, 'Film.mkv'), Buffer.alloc(10));
  assert.equal(await client.isInLibrary(torrent, 'movie'), true);
  assert.equal(await client.isInLibrary(torrent, 'series'), false);
  assert.equal(await client.isInLibrary({ ...torrent, state: 'moving' }, 'movie'), false);
  files = [{ ...files[0], progress: 0.9 }];
  assert.equal(await client.isInLibrary(torrent, 'movie'), false);
  files = [{ name: '../Film.mkv', size: 10, progress: 1, priority: 1 }];
  assert.equal(await client.isInLibrary(torrent, 'movie'), false);
});
