import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTorrentInfo, classifyTorrent, safeSeriesDestination } from '../server/media-layout.mjs';

const enc = value => {
  if (typeof value === 'number') return Buffer.from('i' + value + 'e');
  if (typeof value === 'string') {
    const b=Buffer.from(value,'utf8');
    return Buffer.concat([Buffer.from(b.length + ':'),b]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(value.length+':'),value]);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'),...value.map(enc),Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d'),
    ...Object.keys(value).sort().flatMap(k=>[enc(k),enc(value[k])]),Buffer.from('e')]);
};
const torrent=(name,files)=>enc({info:{name,files:files.map(p=>({length:200000000,path:p.split('/')})), 'piece length':16384,pieces:Buffer.alloc(20)}});

test('Season pack is auto-classified as TV even when wrongly selected as Movie',()=>{
  const t=torrent('Sword.Art.Online.Alternative.Gun.Gale.Online.S01.1080p.CR.WEB-DL',
    ['Sword.Art.Online.Alternative.Gun.Gale.Online.S01E01.mkv',
     'Sword.Art.Online.Alternative.Gun.Gale.Online.S01E02.mkv']);
  const p=classifyTorrent(t,'Sword.Art.Online.Alternative.Gun.Gale.Online.S01.1080p.CR.WEB-DL','movie');
  assert.equal(p.kind,'series');
  assert.equal(p.detectedSeries,true);
  assert.equal(p.title,'Sword Art Online Alternative Gun Gale Online');
  assert.equal(p.videoFiles,2);
  assert.equal(p.seasonNumber,1);
  assert.equal(safeSeriesDestination('/mnt/ADATA/Shows',p.title),
    '/mnt/ADATA/Shows/Sword Art Online Alternative Gun Gale Online');
});
test('Anime episode packs with numbered files are classified as TV',()=>{
 const t=torrent('[Shinobi] Nanatsu no Taizai (Cele Sapte Pacate Capitale) - Complet [1080p]',
  ['[Shinobi] Nanatsu no Taizai - 01 [1080p].mp4',
   '[Shinobi] Nanatsu no Taizai - 02 [1080p].mp4',
   '[Shinobi] Nanatsu no Taizai - 03 [1080p].mp4']);
 const p=classifyTorrent(t,'[Shinobi] Nanatsu no Taizai (Cele Sapte Pacate Capitale) - Complet [1080p]','movie');
 assert.equal(p.kind,'series');
 assert.equal(p.title,'Nanatsu no Taizai (Cele Sapte Pacate Capitale)');
 assert.equal(p.seasonNumber,1);
});
test('One ordinary film and two-film collections are not mislabeled as TV',()=>{
 const one=torrent('Single.Film.2025.1080p',['Single.Film.2025.mkv']);
 const pair=torrent('Film.Collection',['Film.1.mkv','Film.2.mkv']);
 assert.equal(classifyTorrent(one,'Single.Film.2025.1080p').kind,'movie');
 assert.equal(classifyTorrent(pair,'Film.Collection').kind,'movie');
});
test('Season two and mixed-season packs are distinguished safely',()=>{
 const second=torrent('Example.Show.S02.1080p',['Example.Show.S02E01.mkv','Example.Show.S02E02.mkv']);
 const detected=classifyTorrent(second,'Example.Show.S02.1080p','movie');
 assert.equal(detected.kind,'series');
 assert.equal(detected.seasonNumber,2);
 assert.equal(detected.multipleSeasons,false);
 const mixed=torrent('Example.Show.Complete',['Example.Show.S01E01.mkv','Example.Show.S02E01.mkv']);
 assert.equal(classifyTorrent(mixed,'Example.Show.Complete','movie').multipleSeasons,true);
});

test('Malformed bencoding and unsafe folder titles are rejected',()=>{
 assert.throws(()=>parseTorrentInfo(Buffer.from('d3:foo3:bare')),/Torrent missing info dictionary/);
 assert.throws(()=>parseTorrentInfo(Buffer.alloc(5_000_001)),/Invalid torrent metadata/);
 assert.throws(()=>safeSeriesDestination('/mnt/ADATA/Shows','..'),/Cannot determine/);
 assert.equal(safeSeriesDestination('/mnt/ADATA/Shows','Tokyo/Ghoul'),
   '/mnt/ADATA/Shows/Tokyo Ghoul');
});
