'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('crimsonfinUpdates', Object.freeze({
  getStatus: () => ipcRenderer.invoke('crimsonfin:update:get'),
  check: () => ipcRenderer.invoke('crimsonfin:update:check'),
  install: () => ipcRenderer.invoke('crimsonfin:update:install'),
  onChange: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('crimsonfin:update', listener);
    return () => ipcRenderer.removeListener('crimsonfin:update', listener);
  }
}));

contextBridge.exposeInMainWorld('crimsonfinFullscreen', Object.freeze({
  set: enabled => ipcRenderer.invoke('crimsonfin:fullscreen:set', enabled),
  onExit: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('crimsonfin:fullscreen:exit', listener);
    return () => ipcRenderer.removeListener('crimsonfin:fullscreen:exit', listener);
  }
}));
