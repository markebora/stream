// Bridge between the Stream page and the desktop shell (replaces the old native App / View menu bar).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  setTray: (on) => ipcRenderer.invoke('ds:tray', !!on),
  updateInfo: () => ipcRenderer.invoke('ds:updInfo'),
  checkUpdate: () => ipcRenderer.invoke('ds:updCheck'),
  onUiNew: (cb) => ipcRenderer.on('ds:ui-new', () => cb()),
  browserOpen: (o) => ipcRenderer.send('ds:b-open', o),
  browserClose: (id) => ipcRenderer.send('ds:b-close', id),
  browserReload: (id) => ipcRenderer.send('ds:b-reload', id),
  onBrowserFrame: (cb) => ipcRenderer.on('ds:b-frame', (e, id, w, h, buf) => cb(id, w, h, buf)),
  act: (name) => ipcRenderer.invoke('ds:act', String(name)),
});
