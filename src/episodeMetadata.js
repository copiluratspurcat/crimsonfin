// Pure metadata rules: avoid changing original Jellyfin titles or files.
const strip = s => String(s || '').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g,' ').trim();
export function episodeNeedsLookup(ep, seriesName='') {
  const name=String(ep?.Name||'').trim();
  if (!name) return true;
  if (strip(name)===strip(seriesName)) return true;
  if (/^(?:episode|ep|e|cap[ií]tulo|chapter)\s*[0-9]+$/i.test(name)) return true;
  if (/^s\d{1,2}e\d{1,3}(?:\s*[-–.]?\s*(?:[0-9]+p|h264|h265|x264|x265)\b)?$/i.test(name)) return true;
  if (/\.(?:mkv|mp4|avi|m4v|webm)$/i.test(name)) return true;
  if (/\b(?:1080p|2160p|720p|web[- .]?dl|webrip|bluray|x264|x265|hevc)\b/i.test(name)) return true;
  if (/^untitled|^unknown|^video\s*\d+$/i.test(name)) return true;
  return false;
}
export function hasRepeatedEpisodeTitles(episodes=[]) {
  const counts=new Map();for(const ep of episodes) {const name=strip(ep.Name);if(!name)continue;counts.set(name,(counts.get(name)||0)+1)}
  return [...counts.values()].some(n=>n>=2);
}
export function applyEpisodeTitles(episodes=[],metadata,seriesName='') {
  if(!metadata || !Array.isArray(metadata.episodes)) return episodes;
  const byNumber=new Map(metadata.episodes.map(ep=>[`${ep.season}:${ep.number}`,ep]));
  const repeated=hasRepeatedEpisodeTitles(episodes);
  return episodes.map(ep=>{
    const season=Number(ep.ParentIndexNumber),num=Number(ep.IndexNumber);
    const remote=byNumber.get(`${season}:${num}`);
    if(!remote?.name || !Number.isInteger(season) || !Number.isInteger(num)) return ep;
    if(!episodeNeedsLookup(ep,seriesName)&&!repeated) return ep;
    return {...ep,DisplayEpisodeName:String(remote.name),DisplayEpisodeSource:'TVmaze'};
  });
}
