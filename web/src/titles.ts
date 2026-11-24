import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib';
import { usePrefs } from './prefs';

type MediaTitle = { Id: string; Name: string; Type?: string; OriginalTitle?: string; SeriesId?: string; SeriesName?: string };
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
  return query.data?.[language] ||
    (language === 'en' && !isSeriesEpisode ? item?.OriginalTitle?.trim() : '') ||
    libraryTitle || '';
}
