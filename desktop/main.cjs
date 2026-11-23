'use strict';
const { app, BrowserWindow, Menu, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { probeLocal, localOrigin, normalizeFingerprint } = require('./local-route.cjs');

function getConfig() {
  const files = [path.join(__dirname, 'config.json'), path.join(__dirname, 'release-target.json')];
  for (const file of files) {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cfg && typeof cfg.url === 'string') return cfg;
    } catch {}
  }
  return {};
}
function trustedRemote(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash) return u.origin;
  } catch {}
  return null;
}
const config = getConfig();
const remote = trustedRemote(process.env.CRIMSONFIN_URL || config.url);
let approvedLocalOrigin = null;
const localFingerprint = normalizeFingerprint(config.local?.fingerprint256);

// The only certificate exception is a pinned self-signed LAN certificate
// for this particular CrimsonFin device. Never disable TLS verification globally.
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  try {
    const incoming = new URL(url);
    const pinned = incoming.origin === approvedLocalOrigin &&
      normalizeFingerprint(certificate?.fingerprint) === localFingerprint &&
      localFingerprint.length === 64;
    if (pinned) {
      event.preventDefault();
      callback(true);
    }
  } catch {}
});

function unavailable(win) {
  win.loadURL('data:text/html,' + encodeURIComponent(
    '<body style="font:16px system-ui;background:#0b1019;color:white;padding:3rem"><h2>CrimsonFin is unavailable</h2><p>Check your server connection and try reopening the app.</p></body>'
  ));
}
async function makeWindow() {
  // LAN-first with a strictly pinned HTTPS certificate; remote is the fallback.
  const availableLocal = await probeLocal(config);
  approvedLocalOrigin = availableLocal;
  const origin = availableLocal || remote;
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 850, minHeight: 580,
    backgroundColor: '#0b1019', title: 'CrimsonFin', show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:crimsonfin' }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (origin && !target.startsWith(origin + '/')) event.preventDefault();
  });
  Menu.setApplicationMenu(null);
  const webSession = session.fromPartition('persist:crimsonfin');
  webSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  if (!origin) {
    win.loadURL('data:text/html,' + encodeURIComponent(
      '<body style="background:#0b1019;color:#eef3ff;font:18px system-ui;padding:3rem"><h1>CrimsonFin setup</h1><p>Configure the remote server URL before packaging.</p></body>'
    ));
    return win;
  }
  try {
    await win.loadURL(origin);
  } catch {
    if (availableLocal && remote && remote !== availableLocal) {
      try { await win.loadURL(remote); } catch { unavailable(win); }
    } else unavailable(win);
  }
  return win;
}
app.whenReady().then(() => {
  makeWindow().catch(err => console.error('[CrimsonFin] Window startup failed', err?.name));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
