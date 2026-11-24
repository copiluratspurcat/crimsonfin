// FileList categories, as mapped by the FlexGet FileList API integration.
const media = new Map([
  ['1', 'Filme SD'], ['2', 'Filme DVD'], ['3', 'Filme DVD-RO'],
  ['4', 'Filme HD'], ['6', 'Filme 4K'], ['19', 'Filme HD-RO'],
  ['20', 'Filme Blu-Ray'], ['25', 'Filme 3D'], ['26', 'Filme 4K Blu-Ray'],
  ['21', 'Seriale HD'], ['23', 'Seriale SD'], ['27', 'Seriale 4K'],
  ['24', 'Anime'], ['15', 'Desene'], ['16', 'Docs']
]);
const normalize = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/** True when a category value is absent or blank (treated as "not declared"). */
export function isBlankCategory(value) {
  return String(value ?? '').trim() === '';
}

/**
 * Media category ids to search. With no request, every media category.
 * Requested ids are trimmed; malformed ids are rejected with a 400, while
 * well-formed ids outside the media list are dropped (possibly leaving none).
 */
export function allowedFilelistCategories(requested) {
  if (!requested || !String(requested).trim()) return [...media.keys()].join(',');
  const ids = String(requested).split(',').map(id => id.trim()).filter(Boolean);
  if (ids.some(id => !/^\d{1,3}$/.test(id))) {
    throw Object.assign(new Error('Invalid categories'), { status: 400 });
  }
  return [...new Set(ids)].filter(id => media.has(id)).join(',');
}

export function isFilelistMediaCategory(value, categories = allowedFilelistCategories('')) {
  const normalized = normalize(value);
  return Boolean(normalized) && categories.split(',').some(id => media.has(id)
    && (normalized === id || normalized === normalize(media.get(id))));
}
