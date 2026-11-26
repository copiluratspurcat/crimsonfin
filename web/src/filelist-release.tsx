import type { Release } from './lib';
import { describeFileListName } from './filelist-presentation';

export function FileListRelease({ release, best }: { release: Release; best: number | null }) {
  const { title, tags } = describeFileListName(release.name);
  const count = release.seeders;
  return <span className="filelist-summary" title={release.name}>
    <strong>{title}</strong>
    <small>{[...tags, release.size || 'Size unknown'].join(' · ')}</small>
    <span className="filelist-peers">
      <small>{count == null ? 'Seed count unavailable' : `${count} ${count === 1 ? 'seeder' : 'seeders'}`}</small>
      {best !== null && count === best && <span className="chip filelist-fast" title="Most seeders in these results. Speed can vary.">Best seeded</span>}
      {count !== null && count <= 2 && <span className="chip filelist-slow">{count === 0 ? 'No seeders' : 'Few seeders'}</span>}
    </span>
  </span>;
}
