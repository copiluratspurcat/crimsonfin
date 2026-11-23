'use strict';
const { autoUpdater } = require('electron-updater');

let started = false;
let last = { state: 'idle', version: null, percent: 0 };
function safeVersion(v) { return /^\d+\.\d+\.\d+(?:-[a-z\d.-]+)?$/i.test(String(v||'')) ? String(v) : null; }
function redact(message) {
  return String(message || 'Unknown update failure').replace(/(token|passkey|api_key|password)=([^\s&]+)/ig, '$1=[redacted]').slice(0, 160);
}

function startAutoUpdates({ app, win, ipcMain, dialog, shell }) {
  if (!app.isPackaged || started) return;
  started = true;
  const linuxDeb = process.platform === 'linux' && !process.env.APPIMAGE;
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'https://github.com/copiluratspurcat/crimsonfin/releases/latest/download/'
  });
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.autoDownload = !linuxDeb;
  autoUpdater.autoInstallOnAppQuit = !linuxDeb;
  const publish = patch => {
    last = { ...last, ...patch };
    for (const window of require('electron').BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('crimsonfin:update', last);
    }
  };
  let checking = false;
  let reportedError;
  function reportError(error) {
    if (error === reportedError) return;
    reportedError = error;
    const downloading = last.state === 'downloading';
    const code = /^[A-Z][A-Z0-9_]{1,50}$/.test(error?.code || '') ? ' (' + error.code + ')' : '';
    publish({ state: 'error', message: (downloading ? 'Update download failed' : 'Could not check for updates') + code + '.' });
    console.warn('[CrimsonFin updater]', redact(error?.message));
    if (!win.isDestroyed()) win.setProgressBar(-1);
  }
  async function check() {
    if (checking || ['downloading', 'downloaded'].includes(last.state)) return last;
    checking = true;
    reportedError = undefined;
    publish({ state: 'checking', version: null, percent: 0, message: undefined });
    try { await autoUpdater.checkForUpdates(); }
    catch (error) {
      reportError(error);
    }
    finally { checking = false; }
    return last;
  }
  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => publish({ state: 'current', version: app.getVersion() }));
  autoUpdater.on('update-available', info => {
    publish({ state: linuxDeb ? 'manual' : 'downloading', version: safeVersion(info.version), percent: 0 });
    if (linuxDeb) {
      dialog.showMessageBox(win, {
        type: 'info', title: 'CrimsonFin update available',
        message: 'A newer version of CrimsonFin is available.',
        detail: 'This Linux .deb installation needs package-manager authorization. Open the official GitHub release to install the update.',
        buttons: ['View release', 'Later'], defaultId: 0, cancelId: 1
      }).then(({ response }) => {
        if (response === 0) shell.openExternal('https://github.com/copiluratspurcat/crimsonfin/releases/latest');
      });
    }
  });
  autoUpdater.on('download-progress', info => {
    publish({ state: 'downloading', percent: Math.round(Math.max(0, Math.min(100, info.percent || 0))) });
    if (!win.isDestroyed()) win.setProgressBar((info.percent || 0) / 100);
  });
  autoUpdater.on('update-downloaded', info => {
    if (!win.isDestroyed()) win.setProgressBar(-1);
    publish({ state: 'downloaded', version: safeVersion(info.version), percent: 100 });
    dialog.showMessageBox(win, {
      type: 'info', title: 'CrimsonFin update ready',
      message: 'CrimsonFin ' + (safeVersion(info.version) || 'update') + ' has finished downloading.',
      detail: 'Restart CrimsonFin to install this update. Your Jellyfin library and login will stay on the server.',
      buttons: ['Restart and install', 'Later'], defaultId: 0, cancelId: 1
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });
  autoUpdater.on('error', reportError);
  ipcMain.handle('crimsonfin:update:get', event => event.sender.id === win.webContents.id ? last : null);
  ipcMain.handle('crimsonfin:update:check', event => event.sender.id === win.webContents.id ? check() : null);
  ipcMain.handle('crimsonfin:update:install', event => {
    if (event.sender.id !== win.webContents.id || last.state !== 'downloaded') return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });
  setTimeout(() => { if (!win.isDestroyed()) check(); }, 12000).unref?.();
  setInterval(() => { if (!win.isDestroyed()) check(); }, 4 * 3600000).unref?.();
}

module.exports = { startAutoUpdates };
