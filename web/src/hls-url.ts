const ID = /^[a-f0-9-]{32,36}$/i;

/** Jellyfin 12 HLS requires MediaSourceId; AAC avoids silent E-AC-3/DTS direct playback. */
export function buildHlsUrl(
  itemId: string, mediaSourceId: string, quality: number, audioChoice: string = 'auto'
) {
  if (!ID.test(itemId) || !ID.test(mediaSourceId)) throw new Error('Invalid Jellyfin media identifiers');
  if (!Number.isFinite(quality) || quality < 100_000 || quality > 50_000_000) {
    throw new Error('Invalid streaming quality');
  }
  const params = new URLSearchParams({
    MediaSourceId: mediaSourceId, VideoCodec: 'h264', AudioCodec: 'aac',
    MaxStreamingBitrate: String(Math.round(quality)),
    SubtitleStreamIndex: '-1', SubtitleMethod: 'External'
  });
  if (audioChoice !== 'auto') {
    if (!/^\d{1,3}$/.test(audioChoice)) throw new Error('Invalid audio track');
    params.set('AudioStreamIndex', audioChoice);
  }
  return `/jellyfin/Videos/${encodeURIComponent(itemId)}/master.m3u8?${params}`;
}
