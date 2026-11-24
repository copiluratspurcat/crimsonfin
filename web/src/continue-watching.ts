type Entry = {
  Id: string;
  Type: string;
  SeriesId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  IndexNumberEnd?: number;
};

type Span = { show: string; season: number; first: number; last: number };

function episodeSpan(item: Entry): Span | null {
  if (item.Type !== 'Episode' || !item.SeriesId || !Number.isInteger(item.ParentIndexNumber)
    || !Number.isInteger(item.IndexNumber)) return null;
  const first = item.IndexNumber!;
  const end = Number.isInteger(item.IndexNumberEnd) ? item.IndexNumberEnd! : first;
  return { show: item.SeriesId, season: item.ParentIndexNumber!, first, last: Math.max(first, end) };
}

/**
 * Merge watch lists in priority order, dropping repeats. An episode is a repeat when an
 * earlier entry has the same id, or already covers its whole episode range (so a Next Up
 * S01E02 is dropped after a resumed S01E01-E02 file, but a longer E02-E03 file is kept).
 */
export function uniqueWatchEntries<T extends Entry>(...groups: T[][]): T[] {
  const ids = new Set<string>();
  const spans: Span[] = [];
  return groups.flat().filter(item => {
    const span = episodeSpan(item);
    const duplicate = ids.has(item.Id) || (span !== null && spans.some(seen => seen.show === span.show
      && seen.season === span.season && seen.first <= span.first && span.last <= seen.last));
    ids.add(item.Id);
    if (span !== null && !duplicate) spans.push(span);
    return !duplicate;
  });
}
