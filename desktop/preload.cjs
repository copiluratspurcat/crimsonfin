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
