import fs from 'node:fs';
import path from 'node:path';
const value = process.argv[2];
if (!value) { console.error('Usage: node scripts/configure-client.mjs https://YOUR-ACTUAL-FUNNEL-HOST.ts.net'); process.exit(1); }
const u = new URL(value);
if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('Only a clean HTTPS origin is allowed');
const location = path.join(import.meta.dirname, '../desktop/config.json');
fs.writeFileSync(location, JSON.stringify({ url: u.origin }, null, 2) + '\n');
console.log('Desktop client remote HTTPS endpoint configured.');
