import fs from 'node:fs';
const repo = (process.argv[2] || '').trim();
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  console.error('Usage: npm run configure:updates -- YOUR_GITHUB_USERNAME/YOUR_REPOSITORY');
  process.exit(1);
}
const [owner, name] = repo.split('/');
const file = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
pkg.repository = { type: 'git', url: `https://github.com/${owner}/${name}.git` };
pkg.build.publish = [{ provider: 'github', owner, repo: name, releaseType: 'release' }];
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Configured updates via GitHub releases at ${owner}/${name}.`);
console.log('Commit package.json before creating your next release tag.');
