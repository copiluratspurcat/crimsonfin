'use strict';
const { BrowserWindow, net } = require('electron');
const semver = require('semver');
const repo = 'copiluratspurcat/crimsonfin';
const releases = 'https://github.com/' + repo + '/releases';
const { autoUpdater } = require('electron-updater');

let started = false;
let last = { state: 'idle', version: null, percent: 0 };
function safeVersion(v) { return /^\d+\.\d+\.\d+(?:-[a-z\d.-]+)?$/i.test(String(v||'')) ? String(v) : null; }
function redact(message) {
  return String(message || 'Unknown update failure').replace(/(token|passkey|api_key|password)=([^\s&]+)/ig, '$1=[redacted]').slice(0, 160);
}

function startAutoUpdates({ app, ipcMain, dialog }) {
  if (!app.isPackaged || started) return;
  started = true;
  const mac = process.platform === 'darwin';
  const manual = process.platform !== 'win32';
  const currentWindow = () => BrowserWindow.getAllWindows()[0];
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = !manual;
  const publish = patch => {
    last = { ...last, ...patch };
    for (const window of BrowserWindow.getAllWindows()) {
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
    currentWindow()?.setProgressBar(-1);
  }
  async function check() {
    if (checking || ['downloading', 'downloaded'].includes(last.state)) return last;
    checking = true;
    reportedError = undefined;
    publish({ state: 'checking', version: null, percent: 0, message: undefined });
    try {
      const response = await net.fetch('https://api.github.com/repos/' + repo + '/releases/latest', {
        headers: { accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error('Release lookup returned HTTP ' + response.status);
      const release = await response.json();
      const tag = String(release.tag_name || '');
      if (!/^v\d+\.\d+\.\d+$/.test(tag) || release.draft || release.prerelease) {
        throw new Error('GitHub did not return a stable CrimsonFin release');
      }
      const version = tag.slice(1);
      if (!semver.gt(version, app.getVersion())) {
        publish({ state: 'current', version: app.getVersion() });
      } else if (manual) {
        publish({ state: 'manual', version, message: mac
          ? 'Download the new macOS disk image from the official release.'
          : process.env.APPIMAGE
          ? 'Download the new AppImage from the official release.'
          : 'Download the new .deb from the official release and install it with your package manager.' });
      } else {
        autoUpdater.setFeedURL({ provider: 'generic', url: releases + '/download/' + tag + '/' });
        const result = await autoUpdater.checkForUpdates();
        if (!result?.isUpdateAvailable || result.updateInfo.version !== version) {
          throw new Error('The Windows update manifest does not match ' + tag);
        }
        publish({ state: 'downloading', version, percent: 0 });
        await autoUpdater.downloadUpdate();
      }
    }
    catch (error) {
      reportError(error);
    }
    finally { checking = false; }
    return last;
  }
  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }));
  autoUpdater.on('download-progress', info => {
    publish({ state: 'downloading', percent: Math.round(Math.max(0, Math.min(100, info.percent || 0))) });
    currentWindow()?.setProgressBar((info.percent || 0) / 100);
  });
  autoUpdater.on('update-downloaded', info => {
    currentWindow()?.setProgressBar(-1);
    publish({ state: 'downloaded', version: safeVersion(info.version), percent: 100 });
    const win = currentWindow();
    if (!win) return;
    dialog.showMessageBox(win, {
      type: 'info', title: 'CrimsonFin update ready',
      message: 'CrimsonFin ' + (safeVersion(info.version) || 'update') + ' has finished downloading.',
      detail: 'Restart CrimsonFin to install this update. Your Jellyfin library and login will stay on the server.',
      buttons: ['Restart and install', 'Later'], defaultId: 0, cancelId: 1
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    }).catch(reportError);
  });
  autoUpdater.on('error', reportError);
  ipcMain.handle('crimsonfin:update:get', event => event.sender.id === currentWindow()?.webContents.id ? last : null);
  ipcMain.handle('crimsonfin:update:check', event => event.sender.id === currentWindow()?.webContents.id ? check() : null);
  ipcMain.handle('crimsonfin:update:install', event => {
    if (event.sender.id !== currentWindow()?.webContents.id || last.state !== 'downloaded') return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });
  setTimeout(() => { if (currentWindow()) void check(); }, 12000).unref?.();
  setInterval(() => { if (currentWindow()) void check(); }, 4 * 3600000).unref?.();
}

module.exports = { startAutoUpdates };
