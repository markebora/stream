// Bridge between the Stream page and the desktop shell (replaces the old native App / View menu bar).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  setTray: (on) => ipcRenderer.invoke('ds:tray', !!on),
  act: (name) => ipcRenderer.invoke('ds:act', String(name)),
});
