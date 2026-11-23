import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHlsUrl } from '../web/src/hls-url.ts';

const itemId = '94976de2416a40a777490ccfc0f53f04';
const mediaSourceId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
test('Jellyfin HLS URL always includes required MediaSourceId and compatible audio', () => {
  const url = new URL(buildHlsUrl(itemId, mediaSourceId, 12_000_000), 'https://example.test');
  assert.equal(url.pathname, '/jellyfin/Videos/' + itemId + '/master.m3u8');
  assert.equal(url.searchParams.get('MediaSourceId'), mediaSourceId);
  assert.equal(url.searchParams.get('AudioCodec'), 'aac');
  assert.equal(url.searchParams.get('VideoCodec'), 'h264');
  assert.equal(url.searchParams.get('MaxStreamingBitrate'), '12000000');
  assert.equal(url.searchParams.get('AudioStreamIndex'), null);
  assert.equal(url.searchParams.get('SubtitleStreamIndex'), '-1');
});
test('English/Japanese audio selection keeps the required HLS source', () => {
  const url = new URL(buildHlsUrl(itemId,mediaSourceId,8_000_000,'2'),'https://example.test');
  assert.equal(url.searchParams.get('AudioStreamIndex'),'2');
  assert.equal(url.searchParams.get('MediaSourceId'),mediaSourceId);
  assert.equal(url.searchParams.get('AudioCodec'),'aac');
});
test('Untrusted stream identifiers or audio indices cannot enter the URL', () => {
  assert.throws(()=>buildHlsUrl('../private',mediaSourceId,12_000_000));
  assert.throws(()=>buildHlsUrl(itemId,mediaSourceId,99));
  assert.throws(()=>buildHlsUrl(itemId,mediaSourceId,12_000_000,'../../etc'));
});
