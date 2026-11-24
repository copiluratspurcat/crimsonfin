import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib';
import { usePrefs } from './prefs';

type MediaTitle = { Id: string; Name: string; Type?: string; OriginalTitle?: string; ProductionYear?: number; SeriesId?: string; SeriesName?: string };
type Translations = { en?: string; ro?: string };

export function useMediaTitle(item?: MediaTitle) {
  const language = usePrefs().titleLanguage;
  const qc = useQueryClient();
  const configured = qc.getQueryData<{ titleTranslations?: boolean }>(['me'])?.titleTranslations;
  const isSeriesEpisode = item?.Type === 'Episode' && !!item.SeriesId;
  const id = isSeriesEpisode ? item?.SeriesId : item?.Id;
  const query = useQuery({
    queryKey: ['title-translations', id],
    queryFn: ({ signal }) => api<Translations>(`/api/items/${encodeURIComponent(id!)}/titles`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) }),
    enabled: !!configured && !!id && (isSeriesEpisode || item?.Type === 'Movie' || item?.Type === 'Series'),
    staleTime: 10 * 60_000,
    retry: false
  });

  const libraryTitle = isSeriesEpisode ? item?.SeriesName || item?.Name : item?.Name;
  // Jellyfin sometimes uses the release filename as the title before identification.
  const release = item?.Type === 'Movie' && item.ProductionYear &&
    libraryTitle?.match(/^(.+)[._](\d{4})[._](?=.*(?:\b(?:720p|1080p|2160p|BluRay|WEB[-_.]?DL)\b))/i);
  const fallback = release && Number(release[2]) === item?.ProductionYear
    ? release[1].replace(/[._]+/g, ' ').trim()
    : libraryTitle;
  // OriginalTitle is the native release title. Jellyfin's Name is its localized display title.
  return query.data?.[language] || fallback || (!isSeriesEpisode && item?.OriginalTitle?.trim()) || '';
}
