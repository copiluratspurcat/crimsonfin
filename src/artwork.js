/** Pure artwork decisions; no account token or server URLs in this module. */
export const hasPrimaryPoster = item => Boolean(item?.ImageTags?.Primary || item?.PrimaryImageTag);
export function posterLooksLandscape(item) {
  const aspect = Number(item?.PrimaryImageAspectRatio);
  return Number.isFinite(aspect) && aspect > 0.92;
}
export function chooseImageSource(item, type='Primary') {
  if (!item?.Id) return null;
  if(type === 'Backdrop') {
    return item.BackdropImageTags?.length ? {id:item.Id,type,index:0,tag:item.BackdropImageTags[0]} : null;
  }
  if(type === 'Primary') {
    if (item.ImageTags?.Primary) return {id:item.Id,type,tag:item.ImageTags.Primary};
    if (item.PrimaryImageTag) return {id:item.PrimaryImageItemId||item.Id,type,tag:item.PrimaryImageTag};
    if (item.SeriesPrimaryImageTag && item.SeriesId) return {id:item.SeriesId,type,tag:item.SeriesPrimaryImageTag};
    if (item.ParentPrimaryImageTag && item.ParentPrimaryImageItemId) return {id:item.ParentPrimaryImageItemId,type,tag:item.ParentPrimaryImageTag};
  }
  if(item.ImageTags?.[type]) return {id:item.Id,type,tag:item.ImageTags[type]};
  return null;
}
export function rankArtwork(images=[]) {
  return (Array.isArray(images)?images:[])
    .filter(x=>x && typeof x.Url === 'string' && x.Type==='Primary')
    .sort((a,b)=>{
      const score=x=>{
        const w=Number(x.Width),h=Number(x.Height);
        const portrait=w>0&&h>0&&h/w>=1.25&&h/w<=1.85;
        const known=w>0&&h>0;
        const source=/themoviedb|tmdb/i.test(x.ProviderName||'')?4:/tvdb|fanart|tvmaze/i.test(x.ProviderName||'')?3:0;
        return (portrait?100:known?-50:0)+source+Math.min(20,Math.log2(Math.max(1,h||1)));
      };
      return score(b)-score(a);
    });
}
