// Tracker names are labels, not authoritative media metadata.
export function describeFileListName(name: string) {
  const readable = name.replace(/\.(?:mkv|mp4|avi|m4v)$/i, '')
    .replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const resolution = readable.match(/\b(2160p|1080[pi]|720p|576p|480p|4k|uhd)\b/i)?.[0].toLowerCase();
  const source = /\b(?:blu[ -]?ray|b[dr]rip|bdremux)\b/i.test(readable) ? 'Blu-ray'
    : /\bweb[ -]?dl\b/i.test(readable) ? 'WEB-DL'
    : /\bweb[ -]?rip\b/i.test(readable) ? 'WEBRip'
    : /\bhdtv\b/i.test(readable) ? 'HDTV'
    : /\b(?:dvd[ -]?rip|dvd)\b/i.test(readable) ? 'DVD' : '';
  const technical = /\b(?:2160p|1080[pi]|720p|576p|480p|4k|uhd|blu[ -]?ray|web[ -]?(?:dl|rip)|hdtv|b[dr]rip|bdremux|dvd[ -]?rip|[hx][ -]?26[45]|hevc|av1)\b/i;
  const technicalOffset = readable.search(technical);
  const heading = (technicalOffset > 0 ? readable.slice(0, technicalOffset) : readable).trim();
  const installment = heading.match(/\b(?:S\d{1,2}(?:\s*E\d{1,3})?(?:\s*-\s*(?:S\d{1,2}|E\d{1,3}))?|Season\s+\d{1,2}|(?:EP|Episode)\s*\d{1,3})\b/i);
  const beforeInstallment = installment?.index ? heading.slice(0, installment.index).trim() : heading;
  // A year at the start may be the title itself (1917, 2001: A Space Odyssey).
  const year = beforeInstallment.match(/\s+\(?(18[89]\d|19\d\d|20\d\d)\)?\s*[-\]) ]*$/);
  const clean = year?.index && technicalOffset > 0 ? beforeInstallment.slice(0, year.index) : beforeInstallment;
  const title = clean.replace(/[\s(\[\-–]+$/g, '').trim() || readable || name;
  const quality = resolution && ['2160p', '4k', 'uhd'].includes(resolution) ? '4K' : resolution;
  return { title, tags: [year && technicalOffset > 0 ? year[1] : '', installment?.index ? installment[0].toUpperCase() : '',
    quality, source, /\bremux\b/i.test(readable) ? 'Remux' : ''].filter(Boolean) };
}

export function bestSeedCount(results: readonly { seeders: number | null }[]) {
  const most = Math.max(0, ...results.map(({ seeders }) => seeders ?? 0));
  return most >= 10 ? most : null;
}
