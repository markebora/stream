// Disciples Stream desktop shell: runs the server inside the app, with ffmpeg bundled (ffmpeg-static).
const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, clipboard, session, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
if (!app.requestSingleInstanceLock()) app.quit();

let ff = ''; try { ff = require('ffmpeg-static') || ''; } catch {}
process.env.FFMPEG_PATH = ff.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep).replace('app.asar/', 'app.asar.unpacked/');
process.env.DATA_DIR = app.getPath('userData');
process.env.PUBLIC_DIR = path.join(__dirname, 'public');
process.env.PORT = process.env.PORT || '3000';

let win, srv, tray = null, trayOn = false, quitting = false;
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
  const opts = { width: 1440, height: 900, minWidth: 960, minHeight: 600, backgroundColor: '#000000', title: 'Disciples Stream', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } };   // keep drawing/streaming when the window is hidden or minimized
  // Windows: draw the page's own menu bar in the title bar (like PreCenter) and keep the native min/max/close buttons.
  if (process.platform === 'win32') { opts.titleBarStyle = 'hidden'; opts.titleBarOverlay = { color: '#000000', symbolColor: '#f7f7f7', height: 38 }; }
  win = new BrowserWindow(opts);
  win.setMenuBarVisibility(false);
  const url = 'http://localhost:' + srv.PORT + '/?code=' + encodeURIComponent(srv.CODE);
  win.webContents.on('did-fail-load', () => setTimeout(() => win && win.loadURL(url), 600));
  // keep the shortcuts the old View menu had, now that there is no native menu
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return; const k = i.key.toLowerCase(), c = i.control || i.meta;
    if (k === 'f12' || (c && i.shift && k === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
    else if (c && k === 'r') { win.webContents.reload(); e.preventDefault(); }
  });
  win.loadURL(url);
  win.on('close', (e) => { if (trayOn && !quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}

/* actions the page asks for from Tools > App / View */
const zoom = (d) => { if (!win) return; const w = win.webContents; w.setZoomLevel(d === 0 ? 0 : Math.max(-3, Math.min(4, w.getZoomLevel() + d))); };
function setTray(on) {
  trayOn = !!on;
  if (on && !tray) {
    const img = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVR4nGP4z8DwHwMzMDAwMDAyMDD8Z2D4z0AlwDBqwKgBwwYMGzBswLABw8YAAJ0kEtgUnmMsAAAAAElFTkSuQmCC');
    tray = new Tray(img); tray.setToolTip('Disciples Stream');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show', click: () => { if (win) { win.show(); win.focus(); } } }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }]));
    tray.on('click', () => { if (win) { win.show(); win.focus(); } });
  } else if (!on && tray) { tray.destroy(); tray = null; }
}
ipcMain.handle('ds:tray', (e, on) => { if (win && e.sender === win.webContents) setTray(on); return true; });
ipcMain.handle('ds:act', (e, name) => {
  if (!win || e.sender !== win.webContents) return false;
  switch (name) {
    case 'showCode': showCode(); break;
    case 'copyCode': clipboard.writeText(srv.CODE); break;
    case 'reload': win.webContents.reload(); break;
    case 'devtools': win.webContents.toggleDevTools(); break;
    case 'zoomIn': zoom(0.5); break;
    case 'zoomOut': zoom(-0.5); break;
    case 'zoomReset': zoom(0); break;
    case 'quit': quitting = true; app.quit(); break;
    default: return false;
  }
  return true;
});

function lanIp() { const n = require('os').networkInterfaces(); for (const k in n) for (const i of n[k]) if (i.family === 'IPv4' && !i.internal) return i.address; return 'localhost'; }
function showCode() {
  const addr = lanIp() + ':' + srv.PORT;
  dialog.showMessageBox(win, { type: 'info', title: 'Link PreCenter', message: 'Server address: ' + addr + '\nPairing code: ' + srv.CODE, detail: 'In PreCenter open Screens > Stream link and enter these two. On this same computer you can use localhost:' + srv.PORT + ' instead.', buttons: ['Copy both', 'Close'] })
    .then((r) => { if (r.response === 0) clipboard.writeText('Address: ' + addr + '\nCode: ' + srv.CODE); });
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
  Menu.setApplicationMenu(null);   // the old App / View bar is gone: those items now live in the page's Tools menu
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (!trayOn) app.quit(); });
app.on('before-quit', () => { quitting = true; });
