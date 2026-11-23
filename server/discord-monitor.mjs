import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const RELEASES = 'https://github.com/copiluratspurcat/crimsonfin/releases';
const LATEST = 'https://api.github.com/repos/copiluratspurcat/crimsonfin/releases/latest';
const text = value => String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, 120)
  .replace(/([\\`*_~|<>\[\]])/g, '\\$1');
const version = value => /^v?\d+\.\d+\.\d+$/.test(value || '') ? value.replace(/^v/, '') : null;

async function get(url, options = {}) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(18000), ...options });
  if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), { status: response.status });
  return response.json();
}

function webhook(url) {
  const endpoint = new URL(url);
  if (endpoint.origin !== 'https://discord.com' || endpoint.username || endpoint.password ||
      !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(endpoint.pathname) || endpoint.search || endpoint.hash) {
    throw new Error('Use the Discord webhook URL copied from channel settings.');
  }
  return async (body, messageId) => {
    const target = new URL(endpoint);
    if (messageId) target.pathname += '/messages/' + messageId;
    target.searchParams.set('wait', 'true');
    const options = {
      method: messageId ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } })
    };
    try {
      return await get(target, options);
    } catch (error) {
      if (error.status === 404 && messageId) return null;
      throw error;
    }
  };
}

export function newLibraryItems(items, known) {
  const ids = new Set(known);
  const titles = new Set(items.map(item => item.Id));
  return items.filter(item => !ids.has(item.Id) && titles.delete(item.Id)).reverse();
}

export function dashboard({ online, running, latest, downloads, libraryAvailable }) {
  const active = downloads?.length || 0;
  const queue = !online ? 'Unavailable while the gateway is offline.'
    : !downloads ? 'Download service unavailable.'
    : !active ? 'No active downloads.'
    : downloads.slice(0, 8).map(item => {
      const speed = item.downloadSpeedBytes > 0 ? ` · ${(item.downloadSpeedBytes / 1048576).toFixed(1)} MiB/s` : '';
      const eta = speed && item.etaSeconds > 0 ? ` · ETA ${Math.ceil(item.etaSeconds / 60)} min` : '';
      return `**${Math.floor(item.progress)}%** · ${text(item.name)} · ${text(item.state)}${speed}${eta}`;
    }).join('\n') + (active > 8 ? `\n+${active - 8} more` : '');
  return { embeds: [{
    title: 'CrimsonFin status',
    color: online ? 0x31ba75 : 0xc93058,
    description: [
      `**Gateway** · ${online ? 'Online' : 'Offline or unreachable'}`,
      `**Gateway build** · ${running ? 'v' + running + (online ? '' : ' (last seen)') : 'Unknown'}`,
      `**Latest desktop release** · ${latest ? 'v' + latest : 'Unknown'}`,
      `**Jellyfin library** · ${libraryAvailable ? 'Available' : 'Unavailable'}`,
      '', '**Active downloads**', queue
    ].join('\n')
  }] };
}

async function main() {
  const { CRIMSONFIN_MONITOR_URL, DISCORD_MONITOR_TOKEN, DISCORD_STATUS_WEBHOOK,
    DISCORD_ANNOUNCEMENTS_WEBHOOK, DISCORD_MONITOR_STATE } = process.env;
  const gateway = new URL(CRIMSONFIN_MONITOR_URL);
  if (gateway.protocol !== 'https:' || gateway.username || gateway.password || gateway.pathname !== '/' || gateway.search || gateway.hash) {
    throw new Error('Set CRIMSONFIN_MONITOR_URL to the HTTPS gateway origin.');
  }
  if (!DISCORD_MONITOR_TOKEN || DISCORD_MONITOR_TOKEN.length < 32) throw new Error('Missing monitor token.');
  const postStatus = webhook(DISCORD_STATUS_WEBHOOK);
  const announce = webhook(DISCORD_ANNOUNCEMENTS_WEBHOOK || DISCORD_STATUS_WEBHOOK);
  const filename = path.resolve(DISCORD_MONITOR_STATE || './data/discord-monitor.json');
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const state = await readFile(filename, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
  const save = async () => {
    await writeFile(filename + '.tmp', JSON.stringify(state), { mode: 0o600 });
    await rename(filename + '.tmp', filename);
  };
  let failures = 0;
  let iterations = 0;
  let previousDashboard;

  for (;;) {
    const health = await get(new URL('/api/health', gateway)).catch(() => null);
    const reachable = health?.ok === true && health.service === 'CrimsonFin';
    failures = reachable ? 0 : failures + 1;
    const online = reachable || (failures < 2 && state.online !== false);
    const snapshot = reachable ? await get(new URL('/api/discord-monitor', gateway), {
      headers: { authorization: 'Bearer ' + DISCORD_MONITOR_TOKEN }
    }).catch(error => {
      console.error('Gateway monitor data unavailable:', error.status || error.name);
      return null;
    }) : null;
    if (reachable && version(health.version)) state.running = version(health.version);

    if (iterations++ % 5 === 0 || !state.latest) {
      try {
        const release = await get(LATEST);
        const published = !release.draft && !release.prerelease && version(release.tag_name);
        if (published && published !== state.latest) {
          if (state.latest) await announce({ content: `**CrimsonFin v${published} is out.** Open CrimsonFin and go to **Settings → App updates → Check now**.\n${RELEASES}/tag/v${published}` });
          state.latest = published;
          await save();
        }
      } catch (error) { console.error('Release check:', error.status || error.name); }
    }

    try {
      if (reachable || failures >= 2) {
        const body = dashboard({ online, running: state.running, latest: state.latest,
          downloads: snapshot?.downloads, libraryAvailable: Array.isArray(snapshot?.items) });
        const rendered = JSON.stringify(body);
        if (rendered !== previousDashboard || iterations % 15 === 0) {
          let message = /^\d+$/.test(state.statusId || '') ? await postStatus(body, state.statusId) : null;
          if (!message) message = await postStatus(body);
          state.statusId = message.id;
          previousDashboard = rendered;
          await save();
        }
        if (state.online !== online) {
          if (typeof state.online === 'boolean') await announce({ content: online
            ? '**CrimsonFin is back online.**' : '**CrimsonFin is offline or unreachable.**' });
          state.online = online;
          await save();
        }
      }
      if (Array.isArray(snapshot?.items)) {
        const items = snapshot.items;
        if (state.seen) {
          const entries = newLibraryItems(items, state.seen);
          for (let i = 0; i < entries.length; i += 5) {
            const batch = entries.slice(i, i + 5);
            await announce({ content: '**New in Jellyfin**\n' + batch.map(item =>
              `• ${item.Type === 'Episode' && item.SeriesName ? text(item.SeriesName) + ' · ' : ''}${text(item.Name)} (${item.Type})`
            ).join('\n') });
            state.seen = [...new Set([...batch.map(item => item.Id), ...state.seen])].slice(0, 500);
            await save();
            await sleep(1200);
          }
        }
        state.seen = [...new Set([...items.map(item => item.Id), ...state.seen || []])].slice(0, 500);
        await save();
      }
    } catch (error) { console.error('Discord monitor delivery:', error.status || error.name); }
    await sleep(60000);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Discord monitor stopped:', error.code || (error instanceof TypeError ? 'invalid configuration' : error.message));
    process.exitCode = 1;
  });
}
