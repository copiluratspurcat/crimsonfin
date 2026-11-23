'use strict';
const { app, BrowserWindow, Menu, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// The desktop shell displays the CUSTOM CrimsonFin application hosted securely by
// the gateway. It never loads the stock Jellyfin web interface.
const urlConfig = path.join(__dirname, 'config.json');
function getServerUrl() {
  if (process.env.CRIMSONFIN_URL) return process.env.CRIMSONFIN_URL;
  try { return JSON.parse(fs.readFileSync(urlConfig, 'utf8')).url; } catch { return ''; }
}
function trustedUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) return u.origin;
  } catch {}
  return null;
}
function makeWindow() {
  const origin = trustedUrl(getServerUrl());
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
  if (origin) {
    session.fromPartition('persist:crimsonfin').setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    win.loadURL(origin).catch(() => win.loadURL('data:text/html,' + encodeURIComponent('<body style="font:16px system-ui;background:#0b1019;color:white;padding:3rem"><h2>CrimsonFin is unavailable</h2><p>Check your server connection and try reopening the application.</p></body>')));
  } else {
    win.loadURL('data:text/html,' + encodeURIComponent('<body style="background:#0b1019;color:#eef3ff;font:18px system-ui;padding:3rem"><h1>CrimsonFin setup</h1><p>The packaged client needs its public HTTPS server URL.</p><p>The application builder must configure the public server URL using <code>node scripts/configure-client.mjs https://your-node.ts.net</code> before packaging.</p></body>'));
  }
  Menu.setApplicationMenu(null);
  return win;
}
app.whenReady().then(() => {
  makeWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
