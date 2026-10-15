'use strict';
// Sichere Brücke zwischen Oberfläche und Hauptprozess.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bw', {
  async call(method, ...args) {
    const r = await ipcRenderer.invoke('bw:call', method, args);
    if (r && r.ok) return r.data;
    const err = new Error((r && r.error) || 'Unbekannter Fehler');
    err.code = r && r.code;
    throw err;
  },
  on(cb) {
    const handler = (_e, name, data) => cb(name, data);
    ipcRenderer.on('bw:event', handler);
    return () => ipcRenderer.removeListener('bw:event', handler);
  },
  pathForFile(file) {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
  platform: process.platform,
});
