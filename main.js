// Disciples Stream desktop shell: runs the server inside the app, with ffmpeg bundled (ffmpeg-static).
const { app, BrowserWindow, Menu, dialog, clipboard, session, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
if (!app.requestSingleInstanceLock()) app.quit();

let ff = ''; try { ff = require('ffmpeg-static') || ''; } catch {}
process.env.FFMPEG_PATH = ff.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep).replace('app.asar/', 'app.asar.unpacked/');
process.env.DATA_DIR = app.getPath('userData');
process.env.PUBLIC_DIR = path.join(__dirname, 'public');
process.env.PORT = process.env.PORT || '3000';

let win, srv;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* screen / window picker for getDisplayMedia (Electron has no built-in one on Windows) */
function pickSource(sources) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({ parent: win, modal: true, width: 760, height: 520, title: 'Choose what to share', autoHideMenuBar: true, backgroundColor: '#151518', webPreferences: { nodeIntegration: true, contextIsolation: false } });
    const html = '<body style="margin:0;background:#151518;color:#f7f7f7;font:13px Inter,Segoe UI,sans-serif"><div style="padding:12px 14px;font-weight:700">Choose a screen or window</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:0 14px 14px;overflow:auto;height:430px">'
      + sources.map((s, i) => '<div data-i="' + i + '" style="cursor:pointer;border:1px solid #2d2d32;border-radius:8px;padding:6px;background:#1b1b1f"><img style="width:100%;border-radius:4px" src="' + s.thumbnail.toDataURL() + '"><div style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s.name) + '</div></div>').join('')
      + '</div><script>const {ipcRenderer}=require("electron");document.querySelectorAll("[data-i]").forEach(d=>d.onclick=()=>ipcRenderer.send("pick",+d.dataset.i));</script></body>';
    let done = false; const fin = (i) => { if (done) return; done = true; ipcMain.removeListener('pick', on); w.destroy(); resolve(i == null ? null : sources[i]); };
    const on = (e, i) => { if (e.sender === w.webContents) fin(i); }; ipcMain.on('pick', on); w.on('closed', () => fin(null));
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 960, minHeight: 600, backgroundColor: '#000000', title: 'Disciples Stream' });
  const url = 'http://localhost:' + srv.PORT + '/?code=' + encodeURIComponent(srv.CODE);
  win.webContents.on('did-fail-load', () => setTimeout(() => win && win.loadURL(url), 600));
  win.loadURL(url);
  win.on('closed', () => { win = null; });
}

function showCode() {
  dialog.showMessageBox(win, { type: 'info', title: 'Pairing code', message: 'Pairing code: ' + srv.CODE, detail: 'Enter this in PreCenter (Screens > Stream link).\nServer address: this computer\'s address with port ' + srv.PORT + ', for example localhost:' + srv.PORT + ' on this computer.', buttons: ['Copy code', 'Close'] })
    .then((r) => { if (r.response === 0) clipboard.writeText(srv.CODE); });
}

app.whenReady().then(() => {
  srv = require('./server.js');
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'display-capture', 'fullscreen'].includes(perm)));
  session.defaultSession.setDisplayMediaRequestHandler(async (req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
      const s = await pickSource(sources); if (!s) return cb({});
      cb(req.audioRequested ? { video: s, audio: 'loopback' } : { video: s });
    } catch { cb({}); }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'App', submenu: [{ label: 'Show pairing code…', click: showCode }, { label: 'Copy pairing code', click: () => clipboard.writeText(srv.CODE) }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] }
  ]));
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
