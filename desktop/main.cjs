'use strict';
const { app, BrowserWindow, Menu, shell, session, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { probeLocal, matchesPinnedCertificate } = require('./local-route.cjs');
const { startAutoUpdates } = require('./updates.cjs');

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
// Development only: an unpackaged app may load a local dev server (e.g. Vite at
// http://127.0.0.1:5173) via CRIMSONFIN_DEV_URL. Packaged builds ignore it.
function devServer(raw) {
  if (app.isPackaged || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) && u.pathname === '/' && !u.search) return u.origin;
  } catch {}
  return null;
}
const config = getConfig();
const dev = devServer(process.env.CRIMSONFIN_DEV_URL);
const remote = dev || trustedRemote(process.env.CRIMSONFIN_URL || config.url);
let approvedLocalOrigin = null;


// The only certificate exception is a pinned self-signed LAN certificate
// for this particular CrimsonFin device. Never disable TLS verification globally.
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  try {
    const incoming = new URL(url);
    const pinned = matchesPinnedCertificate(
      incoming.origin, approvedLocalOrigin, certificate, config.local?.fingerprint256
    );
    if (pinned) {
      event.preventDefault();
      callback(true);
    }
  } catch {}
});

ipcMain.handle('crimsonfin:fullscreen:set', (event, enabled) => {
  const frame = event.senderFrame;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !frame || frame !== event.sender.mainFrame || typeof enabled !== 'boolean') return;
  const origin = new URL(frame.url).origin;
  if (origin !== remote && origin !== approvedLocalOrigin) return;
  win.setFullScreen(enabled);
});

function unavailable(win) {
  win.loadURL('data:text/html,' + encodeURIComponent(
    '<body style="font:16px system-ui;background:#0b1019;color:white;padding:3rem"><h2>CrimsonFin is unavailable</h2><p>Check your server connection and try reopening the app.</p></body>'
  ));
}
async function makeWindow() {
  // LAN-first with a strictly pinned HTTPS certificate; remote is the fallback.
  const availableLocal = dev ? null : await probeLocal(config);
  approvedLocalOrigin = availableLocal;
  let origin = availableLocal || remote;
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 850, minHeight: 580,
    backgroundColor: '#0e0d10', title: 'CrimsonFin', show: false, icon: path.join(__dirname, 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs'), partition: 'persist:crimsonfin' }
  });
  win.once('ready-to-show', () => win.show());
  win.on('leave-full-screen', () => win.webContents.send('crimsonfin:fullscreen:exit'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (origin && !target.startsWith(origin + '/')) event.preventDefault();
  });
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
      origin = remote;
      try { await win.loadURL(remote); } catch { unavailable(win); }
    } else unavailable(win);
  }
  return win;
}
let openingWindow;
function showMainWindow() {
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) { existing.show(); return; }
  if (!openingWindow) {
    openingWindow = makeWindow()
      .then(() => startAutoUpdates({ app, ipcMain, dialog }))
      .catch(err => console.error('[CrimsonFin] Window startup failed', err?.name))
      .finally(() => { openingWindow = null; });
  }
}
app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }
    ]));
  } else Menu.setApplicationMenu(null);
  showMainWindow();
  app.on('activate', showMainWindow);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
