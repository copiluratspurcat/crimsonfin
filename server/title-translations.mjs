// Resolve language variants by provider ID. A title search could match a different film.
export function createTitleTranslations(token, fetchImpl) {
  const cache = new Map();
  let active = 0;
  const waiting = [];
  const next = () => {
    while (active < 6 && waiting.length) {
      const run = waiting.shift();
      active++;
      void run().finally(() => { active--; next(); });
    }
  };

  return async function translations(item) {
    const kind = { Movie: 'movie', Series: 'tv' }[item?.Type];
    const id = String(item?.ProviderIds?.Tmdb || '');
    if (!token || !kind || !/^\d{1,12}$/.test(id)) return {};
    const key = `${kind}/${id}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    if (waiting.length >= 120) return {};

    const entry = { expires: Infinity, result: null };
    entry.result = new Promise(resolve => {
      waiting.push(async () => {
        try {
          const response = await fetchImpl(`https://api.themoviedb.org/3/${key}/translations`, {
            headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
            redirect: 'error', signal: AbortSignal.timeout(4000)
          });
          if (!response.ok) throw new Error('TMDB translation request failed');
          const { translations } = await response.json();
          const result = {};
          for (const [language, country] of [['en', 'US'], ['ro', 'RO']]) {
            const matches = (translations || []).filter(row => row.iso_639_1 === language);
            const name = row => row?.data?.[kind === 'movie' ? 'title' : 'name']?.trim();
            const value = name(matches.find(row => row.iso_3166_1 === country)) || matches.map(name).find(Boolean);
            if (value) result[language] = value;
          }
          entry.expires = Date.now() + 24 * 60 * 60_000;
          resolve(result);
        } catch {
          entry.expires = Date.now() + 60_000;
          resolve({});
        }
      });
    });
    if (cache.size >= 4096) cache.delete(cache.keys().next().value);
    cache.set(key, entry);
    next();
    return entry.result;
  };
}
