// Bridge between the Stream page and the desktop shell (replaces the old native App / View menu bar).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  setTray: (on) => ipcRenderer.invoke('ds:tray', !!on),
  updateInfo: () => ipcRenderer.invoke('ds:updInfo'),
  checkUpdate: () => ipcRenderer.invoke('ds:updCheck'),
  onUiNew: (cb) => ipcRenderer.on('ds:ui-new', () => cb()),
  act: (name) => ipcRenderer.invoke('ds:act', String(name)),
});
