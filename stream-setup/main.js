// Disciples Stream desktop shell: runs the server inside the app, with ffmpeg bundled (ffmpeg-static).
const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, clipboard, session, desktopCapturer, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
if (!app.requestSingleInstanceLock()) app.quit();

let ff = ''; try { ff = require('ffmpeg-static') || ''; } catch {}
process.env.FFMPEG_PATH = ff.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep).replace('app.asar/', 'app.asar.unpacked/');
process.env.DATA_DIR = app.getPath('userData');
process.env.PUBLIC_DIR = path.join(__dirname, 'public');
process.env.PORT = process.env.PORT || '3000';

let appUpd = null, win, srv, tray = null, trayOn = false, quitting = false;
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


/* ---- interface updates: the app pulls the newest index.html from your Vercel site and uses it instead of the built-in copy ---- */
let UPD = { url: '', intervalMinutes: 30 };
try { UPD = Object.assign(UPD, JSON.parse(fs.readFileSync(path.join(__dirname, 'update.json'), 'utf8'))); } catch {}
try { const o = fs.readFileSync(path.join(app.getPath('userData'), 'update-url.txt'), 'utf8').trim(); if (/^https:\/\//i.test(o)) UPD.url = o; } catch {}
if (process.env.DS_UPDATE_URL) UPD.url = process.env.DS_UPDATE_URL;
const UI_DIR = path.join(app.getPath('userData'), 'ui-cache'), UI_META = path.join(UI_DIR, 'meta.json');
process.env.UI_CACHE_DIR = UI_DIR;
const readMeta = () => { try { return JSON.parse(fs.readFileSync(UI_META, 'utf8')); } catch { return null; } };
function useCacheOk() {   // a cache made by an older installer is ignored
  const m = readMeta(); if (!m || m.appVersion !== app.getVersion()) { try { fs.rmSync(UI_DIR, { recursive: true, force: true }); } catch {} return false; } return fs.existsSync(path.join(UI_DIR, 'index.html'));
}
async function pullUi() {
  if (!/^https:\/\//i.test(UPD.url || '')) return { ok: false, msg: 'No update site is set (update.json).' };
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await net.fetch(UPD.url.replace(/\/+$/, '') + '/index.html?t=' + Date.now(), { signal: ac.signal, headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) return { ok: false, msg: 'The update site answered ' + r.status + '.' };
    const txt = await r.text();
    if (txt.length < 100000 || !txt.includes('Disciples Stream') || !txt.includes('id="app"') || !txt.includes('</html>')) return { ok: false, msg: 'The file on the update site does not look like Stream, so it was ignored.' };
    fs.mkdirSync(UI_DIR, { recursive: true });
    const cur = path.join(UI_DIR, 'index.html'), had = fs.existsSync(cur) ? fs.readFileSync(cur, 'utf8') : null;
    const changed = had !== txt;
    if (changed) { fs.writeFileSync(cur + '.tmp', txt); fs.renameSync(cur + '.tmp', cur); }
    fs.writeFileSync(UI_META, JSON.stringify({ appVersion: app.getVersion(), url: UPD.url, at: Date.now(), bytes: txt.length }));
    return { ok: true, changed, bytes: txt.length };
  } catch (e) { return { ok: false, msg: 'Could not reach the update site (' + (e.name === 'AbortError' ? 'timed out' : e.message) + ').' }; }
  finally { clearTimeout(t); }
}
let uiLoadedSig = '';   // what the open window is showing
ipcMain.handle('ds:updInfo', () => { const m = readMeta(); return { source: m && fs.existsSync(path.join(UI_DIR, 'index.html')) ? 'site' : 'built-in', url: UPD.url, at: m && m.at }; });
ipcMain.handle('ds:updCheck', async () => {
  const r = await pullUi(); if (!r.ok) return { msg: r.msg };
  const sig = String(readMeta() && readMeta().bytes) + ':' + fs.statSync(path.join(UI_DIR, 'index.html')).mtimeMs;
  if (r.changed) return { changed: true, msg: 'A new version was downloaded. Press Reload now to use it.' };
  return { msg: 'You have the latest version.' };
});

function createWindow() {
  const opts = { width: 1440, height: 900, minWidth: 960, minHeight: 600, backgroundColor: '#000000', title: 'Disciples Stream', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } };   // keep drawing/streaming when the window is hidden or minimized
  // Windows: draw the page's own menu bar in the title bar (like PreCenter) and keep the native min/max/close buttons.
  if (process.platform === 'win32') { opts.titleBarStyle = 'hidden'; opts.titleBarOverlay = { color: '#000000', symbolColor: '#f7f7f7', height: 38 }; }
  opts.icon = path.join(__dirname, 'public', 'icon.png');
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
  win.on('closed', () => { win = null; [...bwins.keys()].forEach(closeB); });
}

/* actions the page asks for from Tools > App / View */
const zoom = (d) => { if (!win) return; const w = win.webContents; w.setZoomLevel(d === 0 ? 0 : Math.max(-3, Math.min(4, w.getZoomLevel() + d))); };
function setTray(on) {
  trayOn = !!on;
  if (on && !tray) {
    const img = nativeImage.createFromPath(path.join(__dirname, 'public', 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(img); tray.setToolTip('Disciples Stream');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show', click: () => { if (win) { win.show(); win.focus(); } } }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }]));
    tray.on('click', () => { if (win) { win.show(); win.focus(); } });
  } else if (!on && tray) { tray.destroy(); tray = null; }
}

/* ---- Browser sources: each one is a hidden off-screen page whose pictures are sent to the Stream window ---- */
const bwins = new Map();
function closeB(id) { const w = bwins.get(id); if (w) { bwins.delete(id); try { if (!w.isDestroyed()) w.destroy(); } catch {} } }
ipcMain.on('ds:b-open', (e, o) => {
  if (!win || e.sender !== win.webContents || !o) return;
  let u; try { u = new URL(String(o.url || '')); } catch { return; }
  if (!['http:', 'https:', 'file:'].includes(u.protocol)) return;
  const id = +o.id; closeB(id);
  const w = Math.max(64, Math.min(3840, +o.w || 1280)), h = Math.max(64, Math.min(2160, +o.h || 720));
  const bw = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000', skipTaskbar: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'persist:browser-source' } });
  bwins.set(id, bw);
  bw.webContents.setFrameRate(Math.max(1, Math.min(60, +o.fps || 30)));
  bw.webContents.setAudioMuted(true);
  bw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  bw.webContents.on('dom-ready', () => { if (o.css) bw.webContents.insertCSS(String(o.css)).catch(() => {}); });
  bw.webContents.on('paint', (ev, dirty, img) => {
    if (!win || win.isDestroyed() || bw.isDestroyed()) return;
    const s = img.getSize(); if (s.width < 1) return;
    win.webContents.send('ds:b-frame', id, s.width, s.height, img.toBitmap());
  });
  bw.loadURL(u.href).catch(() => {});
});
ipcMain.on('ds:b-close', (e, id) => { if (win && e.sender === win.webContents) closeB(+id); });
ipcMain.on('ds:b-reload', (e, id) => { if (!win || e.sender !== win.webContents) return; const w = bwins.get(+id); if (w && !w.isDestroyed()) w.webContents.reloadIgnoringCache(); });
ipcMain.handle('ds:appCheck', async (e) => { if (!win || e.sender !== win.webContents) return { status: 'off' }; if (!appUpd) return { status: 'off' }; await appUpd.check(); return { version: app.getVersion(), ...appUpd.state }; });
ipcMain.handle('ds:appInfo', () => ({ version: app.getVersion(), packaged: app.isPackaged, ...(appUpd ? appUpd.state : { status: 'off' }) }));
ipcMain.handle('ds:appInstall', (e) => !!(win && e.sender === win.webContents && appUpd && appUpd.install()));
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

app.whenReady().then(async () => {
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
  useCacheOk();
  await Promise.race([pullUi(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {});   // newest interface from your site (falls back to the built-in copy offline)
  useCacheOk();
  createWindow();
  appUpd = require('./appupdate').start({ app, log: { info: (t) => console.log(t), warn: (t) => console.log(t), error: (t) => console.log(t) }, notify: (i) => { if (win && !win.isDestroyed()) win.webContents.send('ds:app-update', i); } });
  setInterval(async () => { const r = await pullUi(); if (r.ok && r.changed && win) win.webContents.send('ds:ui-new'); }, Math.max(5, +UPD.intervalMinutes || 30) * 60000);
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (!trayOn) app.quit(); });
app.on('before-quit', () => { quitting = true; });
