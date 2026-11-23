type Entry = {
  Id: string;
  Type: string;
  SeriesId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  IndexNumberEnd?: number;
};

export function uniqueWatchEntries<T extends Entry>(...groups: T[][]): T[] {
  const ids = new Set<string>();
  const episodes = new Set<string>();
  return groups.flat().filter(item => {
    const episode = item.Type === 'Episode' && item.SeriesId && Number.isInteger(item.ParentIndexNumber)
      && Number.isInteger(item.IndexNumber)
      ? JSON.stringify([item.SeriesId, item.ParentIndexNumber, item.IndexNumber, item.IndexNumberEnd ?? item.IndexNumber])
      : null;
    const duplicate = ids.has(item.Id) || (episode !== null && episodes.has(episode));
    ids.add(item.Id);
    if (episode !== null) episodes.add(episode);
    return !duplicate;
  });
}
