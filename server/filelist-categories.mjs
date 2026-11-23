// FileList categories, as mapped by the FlexGet FileList API integration.
const media = new Map([
  ['1', 'Filme SD'], ['2', 'Filme DVD'], ['3', 'Filme DVD-RO'],
  ['4', 'Filme HD'], ['6', 'Filme 4K'], ['19', 'Filme HD-RO'],
  ['20', 'Filme Blu-Ray'], ['25', 'Filme 3D'], ['26', 'Filme 4K Blu-Ray'],
  ['21', 'Seriale HD'], ['23', 'Seriale SD'], ['27', 'Seriale 4K'],
  ['24', 'Anime']
]);
const normalize = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

export function allowedFilelistCategories(requested) {
  if (!requested) return [...media.keys()].join(',');
  return [...new Set(requested.split(','))].filter(id => media.has(id)).join(',');
}

export function isFilelistMediaCategory(value, categories = allowedFilelistCategories('')) {
  const normalized = normalize(value);
  return Boolean(normalized) && categories.split(',').some(id => media.has(id)
    && (normalized === id || normalized === normalize(media.get(id))));
}
