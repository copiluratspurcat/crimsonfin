type Entry = {
  Id: string;
  Type: string;
  SeriesId?: string;
  UserData?: { LastPlayedDate?: string; PlaybackPositionTicks?: number };
};

/** Keep one episode per show, even when the user goes back a season. */
export function uniqueWatchEntries<T extends Entry>(...groups: T[][]): T[] {
  const seen = new Set<string>();
  const playedAt = (item: T) => Date.parse(item.UserData?.LastPlayedDate || '') || 0;
  return groups.flatMap(group => [...group].sort((a, b) => playedAt(b) - playedAt(a))
    .filter(item => {
      const key = item.Type === 'Episode' && item.SeriesId ? 'series:' + item.SeriesId : item.Id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
}
