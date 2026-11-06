// preload.js — a small, safe bridge between the screen (src/) and main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.sendSync('load-data'),
  save: (data) => ipcRenderer.send('save-data', data),
  saveNow: (data) => ipcRenderer.sendSync('save-data-sync', data),
  setAlwaysOnTop: (on) => ipcRenderer.send('set-always-on-top', on),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
});
