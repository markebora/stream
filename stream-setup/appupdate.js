'use strict';
// Updates the installed program itself from GitHub Releases (electron-updater), the same way Disciples PreCenter does.
// - Only for the installed (Setup) version. "npm start" is skipped.
// - A new version downloads quietly in the background and installs when the app is CLOSED, so a service is never interrupted.
// - Never throws: if anything goes wrong the current version keeps running.

function start(opts) {
  const app = opts.app, log = opts.log || { info() {}, warn() {}, error() {} }, notify = opts.notify || (() => {});
  const delayMs = opts.delayMs == null ? 20 * 1000 : opts.delayMs, everyMs = opts.everyMs == null ? 4 * 60 * 60 * 1000 : opts.everyMs;
  const state = { status: app.isPackaged ? 'idle' : 'off', version: '', checkedAt: 0, error: '' };
  const api = { state, check: async () => state, install: () => false };
  if (!app.isPackaged) { log.info('Program auto-update is off (not an installed build).'); return api; }

  let autoUpdater;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { state.status = 'off'; state.error = 'electron-updater is missing'; log.warn('Program auto-update is unavailable: ' + (e && e.message)); return api; }
  try {
    autoUpdater.logger = { info: (m) => log.info('updater: ' + m), warn: (m) => log.warn('updater: ' + m), error: (m) => log.warn('updater: ' + m), debug() {} };
    autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true; autoUpdater.allowPrerelease = false;
    autoUpdater.on('checking-for-update', () => { state.status = 'checking'; });
    autoUpdater.on('update-not-available', () => { state.status = 'current'; state.checkedAt = Date.now(); });
    autoUpdater.on('update-available', (i) => { state.status = 'downloading'; state.version = (i && i.version) || ''; log.info('Update ' + state.version + ' found, downloading.'); });
    autoUpdater.on('update-downloaded', (i) => { state.status = 'ready'; state.version = (i && i.version) || state.version; state.checkedAt = Date.now(); log.info('Update ' + state.version + ' downloaded. It installs when the app is closed.'); try { notify({ version: state.version }); } catch {} });
    autoUpdater.on('error', (e) => { if (state.status !== 'ready') state.status = 'error'; state.error = (e && e.message) || 'unknown'; log.warn('Update check failed: ' + state.error); });
  } catch (e) { state.status = 'off'; log.warn('Program auto-update could not start: ' + (e && e.message)); return api; }

  const check = async () => {
    if (state.status === 'ready' || state.status === 'downloading') return state;
    try { state.error = ''; await autoUpdater.checkForUpdates(); } catch (e) { state.status = 'error'; state.error = (e && e.message) || 'unknown'; }
    return state;
  };
  api.check = check;
  api.install = () => { if (state.status !== 'ready') return false; try { autoUpdater.quitAndInstall(true, true); return true; } catch { return false; } };
  const t1 = setTimeout(check, delayMs); if (t1.unref) t1.unref();
  const t2 = setInterval(check, everyMs); if (t2.unref) t2.unref();
  return api;
}
module.exports = { start };
