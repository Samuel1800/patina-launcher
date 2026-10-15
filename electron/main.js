'use strict';
// Electron-Hauptprozess: Fenster, Microsoft-Login, Direktstart, Verknüpfungen, IPC zur Oberfläche.
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, protocol, net, Notification, nativeImage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { isInside } = require('../core/fsutil');
const { Core } = require('../core/app');
const auth = require('../core/auth');
const { defaultDataRoot, legacyDataRoot } = require('../core/paths');
const migrate = require('./migrate');

const isDev = !app.isPackaged && process.env.BW_DEV === '1';
const APP_ID = 'de.samuelerk.patina';

app.setName('Patina');
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
// Vorgängerversion „Blockwerk“: deren Benutzerordner weiterverwenden (Anmeldung + Einstellungen bleiben)
migrate.chooseUserDataDir(app);

protocol.registerSchemesAsPrivileged([{ scheme: 'bwfile', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

// ---------- Einzelinstanz + Argumente ----------
function parseArgs(argv) {
  const i = argv.indexOf('--launch');
  if (i >= 0 && argv[i + 1]) return { launch: argv[i + 1] };
  if (argv.includes('--launch-last')) return { launch: 'last' };
  return {};
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let core;
let mainWindow = null;
let splash = null;
let directMode = false;
let quitWhenGameEnds = false;

const ICON = path.join(__dirname, '..', 'build', 'icon.png');

function crypt() {
  const available = safeStorage.isEncryptionAvailable();
  return {
    encrypt: (s) => (available ? 'v1:' + safeStorage.encryptString(s).toString('base64') : 'b64:' + Buffer.from(s).toString('base64')),
    decrypt: (s) => {
      if (s.startsWith('v1:')) return safeStorage.decryptString(Buffer.from(s.slice(3), 'base64'));
      if (s.startsWith('b64:')) return Buffer.from(s.slice(4), 'base64').toString();
      throw new Error('Unbekanntes Format');
    },
  };
}

function send(name, data) {
  for (const w of [mainWindow, splash]) {
    if (w && !w.isDestroyed()) w.webContents.send('bw:event', name, data);
  }
}

function createMainWindow({ show = true } = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (show) showMain();
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#16181c',
    title: 'Patina',
    icon: ICON,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#16181c', symbolColor: '#eeeae3', height: 56 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.removeMenu();
  if (isDev) mainWindow.loadURL('http://localhost:5173');
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (show) mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost:5173')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  return mainWindow;
}

function showMain() {
  const w = createMainWindow({ show: false });
  if (w.webContents.isLoading()) w.once('ready-to-show', () => w.show());
  else w.show();
  if (w.isMinimized()) w.restore();
  w.focus();
}

function createSplash() {
  splash = new BrowserWindow({
    width: 420,
    height: 150,
    frame: false,
    resizable: false,
    transparent: false,
    backgroundColor: '#16181c',
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  if (isDev) splash.loadURL('http://localhost:5173/#/splash');
  else splash.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: '/splash' });
  splash.once('ready-to-show', () => splash.show());
  splash.on('closed', () => (splash = null));
}

// ---------- Microsoft-Login-Fenster ----------
function openLoginWindow(parent) {
  return new Promise((resolve, reject) => {
    const cfg = auth.configFor(core.settings.get('azureClientId'));
    const { url } = auth.authorizeUrl(cfg);
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: Boolean(parent && !parent.isDestroyed()),
      title: 'Mit Microsoft anmelden',
      backgroundColor: '#ffffff',
      icon: ICON,
      autoHideMenuBar: true,
      webPreferences: { partition: 'persist:blockwerk-msa', contextIsolation: true, sandbox: true },
    });
    let done = false;
    const finish = (err, code) => {
      if (done) return;
      done = true;
      if (!win.isDestroyed()) win.close();
      if (err) reject(err);
      else resolve(code);
    };
    const check = (target) => {
      if (!target || !target.startsWith(cfg.redirect)) return false;
      const u = new URL(target);
      const code = u.searchParams.get('code');
      const error = u.searchParams.get('error');
      if (code) finish(null, code);
      else if (error) finish(new Error(error === 'access_denied' ? 'Anmeldung abgebrochen.' : `Anmeldung fehlgeschlagen: ${u.searchParams.get('error_description') || error}`));
      return true;
    };
    win.webContents.setWindowOpenHandler(({ url: popup }) => {
      if (/^https:\/\//.test(popup)) shell.openExternal(popup);
      return { action: 'deny' };
    });
    win.webContents.on('will-redirect', (e, target) => {
      if (check(target)) e.preventDefault();
      else if (!/^https:\/\//.test(target)) e.preventDefault();
    });
    win.webContents.on('will-navigate', (e, target) => {
      if (check(target)) e.preventDefault();
      else if (!/^https:\/\//.test(target)) e.preventDefault();
    });
    win.webContents.on('did-navigate', (_e, target) => check(target));
    win.webContents.on('did-redirect-navigation', (_e, target) => check(target));
    win.on('closed', () => finish(new Error('Anmeldung abgebrochen.')));
    win.loadURL(url);
  });
}

async function login() {
  const code = await openLoginWindow(mainWindow || splash);
  return core.completeLogin(code);
}

// ---------- Desktop-Verknüpfung ----------
function exePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

/** Über den Installer eingerichtet? (dann legt der Installer die Verknüpfungen an und entfernt sie wieder) */
function isInstalled() {
  try {
    return fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall Patina.exe'));
  } catch {
    return false;
  }
}

async function createShortcut(instanceId) {
  const inst = await core.getInstance(instanceId);
  if (process.platform !== 'win32') throw new Error('Verknüpfungen gibt es nur unter Windows.');
  const desktop = app.getPath('desktop');
  const name = inst.name.replace(/[<>:"/\\|?*]/g, '').trim() || 'Minecraft';
  const file = path.join(desktop, `${name}.lnk`);
  const args = app.isPackaged ? `--launch ${instanceId}` : `"${path.join(__dirname, '..')}" --launch ${instanceId}`;
  const ok = shell.writeShortcutLink(file, fs.existsSync(file) ? 'replace' : 'create', {
    target: exePath(),
    args,
    description: `${inst.name} direkt starten (Minecraft ${inst.game})`,
    icon: exePath(),
    iconIndex: 0,
    appUserModelId: APP_ID,
  });
  if (!ok) throw new Error('Verknüpfung konnte nicht erstellt werden.');
  return file;
}

/**
 * Beim ersten Start: Verknüpfungen für Patina selbst (Desktop + Startmenü) anlegen
 * und alte Blockwerk-Verknüpfungen reparieren bzw. entfernen.
 */
function ensureAppShortcuts() {
  if (process.platform !== 'win32' || !app.isPackaged || core.settings.data.patinaShortcutsCreated) return;
  const desktop = app.getPath('desktop');
  const startMenu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  try {
    const r = migrate.migrateShortcuts({ shell, desktop, startMenu, exePath: exePath(), appUserModelId: APP_ID, log: (l, m) => core.log(l, m) });
    if (r.fixed || r.removed) core.log('info', `Alte Verknüpfungen: ${r.fixed} repariert, ${r.removed} entfernt`);
  } catch (e) {
    core.log('warn', `Verknüpfungen migrieren: ${e.message}`);
  }
  if (isInstalled()) {
    core.settings.set({ patinaShortcutsCreated: true }).catch(() => {});
    return;
  }
  try {
    for (const file of [path.join(desktop, 'Patina.lnk'), path.join(startMenu, 'Patina.lnk')]) {
      if (fs.existsSync(file)) continue;
      shell.writeShortcutLink(file, 'create', { target: exePath(), cwd: path.dirname(exePath()), description: 'Patina – Minecraft-Launcher', icon: exePath(), iconIndex: 0, appUserModelId: APP_ID });
    }
    core.settings.set({ patinaShortcutsCreated: true }).catch(() => {});
  } catch (e) {
    core.log('warn', `Verknüpfungen: ${e.message}`);
  }
}

// ---------- Direktstart ----------
async function directLaunch(target) {
  directMode = true;
  const s = core.settings.data;
  const id = target === 'last' ? s.lastInstanceId : target;
  if (!id) {
    directMode = false;
    return showMain();
  }
  try {
    await core.getInstance(id);
  } catch {
    directMode = false;
    return showMain();
  }
  createSplash();
  try {
    const accs = await core.accounts.list();
    if (!accs.length) await login();
    try {
      await core.launch(id);
    } catch (e) {
      if (e.code === 'MS_EXPIRED' || e.code === 'NO_ACCOUNT') {
        await login();
        await core.launch(id);
      } else throw e;
    }
    quitWhenGameEnds = true;
    setTimeout(() => splash && !splash.isDestroyed() && splash.close(), 600);
  } catch (e) {
    if (splash && !splash.isDestroyed()) splash.close();
    directMode = false;
    showMain();
    setTimeout(() => send('toast', { type: 'error', text: e.message }), 800);
  }
}

// ---------- IPC ----------
const OPENABLE_SUBDIRS = new Set(['saves', 'mods', 'resourcepacks', 'shaderpacks', 'screenshots', 'config', 'logs', 'crash-reports']);

const METHODS = {
  state: () => core.state(),
  versionList: (o) => core.versionList(o),
  refreshVersions: () => core.refreshVersions(),
  loaderAvailability: (g) => core.loaderAvailability(g),
  createInstance: (o) => core.createInstance(o),
  getInstance: (id) => core.getInstance(id),
  instanceDetails: (id) => core.instanceDetails(id),
  instanceSize: (id) => core.instanceSize(id),
  updateInstance: (id, p) => core.updateInstance(id, p),
  duplicateInstance: (id) => core.duplicateInstance(id),
  deleteInstance: (id) => core.deleteInstance(id),
  changeLoader: (id, l, v) => core.changeLoader(id, l, v),
  prefetch: (id) => core.prefetch(id),
  repair: (id) => core.repair(id),
  listContent: (id, k) => core.listContent(id, k),
  installContent: (id, p, o) => core.installContent(id, p, o),
  setContentEnabled: (id, k, e) => core.setContentEnabled(id, k, e),
  removeContent: (id, k) => core.removeContent(id, k),
  addLocalContent: (id, files, kind) => core.addLocalContent(id, files, kind),
  checkUpdates: (id) => core.checkUpdates(id),
  applyUpdates: (id, u) => core.applyUpdates(id, u),
  activateShader: (id, f) => core.activateShader(id, f),
  setResourcePack: (id, f, a) => core.setResourcePack(id, f, a),
  search: (q) => core.search(q),
  project: (id) => core.project(id),
  projectVersions: (id, o) => core.projectVersions(id, o),
  compatibleInstances: (p, k) => core.compatibleInstances(p, k),
  installModpack: (p, o) => core.installModpack(p, o),
  upgradeTargets: (id) => core.upgradeTargets(id),
  upgradePlan: (id, t) => core.upgradePlan(id, t),
  upgradeApply: (id, plan, o) => core.upgradeApply(id, plan, o),
  backups: (id) => core.backups(id),
  createBackup: (id, o) => core.createBackup(id, o),
  restoreBackup: (id, b) => core.restoreBackup(id, b),
  deleteBackup: (id, b) => core.deleteBackup(id, b),
  checkPending: (id) => core.checkPending(id),
  applyPending: (id, k) => core.applyPending(id, k),
  dismissPending: (id, k) => core.dismissPending(id, k),
  scanCurseForge: (dirs) => core.scanCurseForge(dirs),
  scanModrinth: (dirs) => core.scanModrinth(dirs),
  scanNoRisk: (dirs) => core.scanNoRisk(dirs),
  news: () => core.news(),
  patchNote: (p) => core.patchNote(p),
  guessFolder: (d) => core.guessFolder(d),
  importInstances: (items, o) => core.importInstances(items, o),
  importMrpack: (f) => core.importMrpack(f),
  launch: (id, o) => core.launch(id, o),
  stop: (id) => core.stop(id),
  gameLog: (id) => core.gameLog(id),
  launcherLog: () => core.launcherLog(),
  setSettings: (p) => core.setSettings(p),
  javaRuntimes: () => core.javaRuntimes(),
  storageInfo: () => core.storageInfo(),
  removeAccount: (id) => core.removeAccount(id),
  setActiveAccount: (id) => core.setActiveAccount(id),
  cancelTask: (id) => core.tasks.cancel(id),
  login: () => login(),
  createShortcut: (id) => createShortcut(id),
  openFolder: async (id, sub) => {
    const inst = await core.getInstance(id);
    if (sub && !OPENABLE_SUBDIRS.has(sub)) throw new Error('Ordner nicht erlaubt.');
    const p = sub ? path.join(inst.dir, sub) : inst.dir;
    fs.mkdirSync(p, { recursive: true });
    return shell.openPath(p);
  },
  openDataFolder: () => shell.openPath(core.paths.root),
  openExternal: (url) => (/^https?:\/\//.test(url) ? shell.openExternal(url) : null),
  pickFolder: async (title) => {
    const r = await dialog.showOpenDialog(mainWindow, { title, properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  pickFiles: async (title, filters) => {
    const r = await dialog.showOpenDialog(mainWindow, { title, properties: ['openFile', 'multiSelections'], filters });
    return r.canceled ? [] : r.filePaths;
  },
  changeDataRoot: async (dir) => {
    await core.setSettings({ dataRoot: dir });
    app.relaunch();
    app.exit(0);
  },
  showWindow: () => showMain(),
  appInfo: () => ({ version: app.getVersion(), electron: process.versions.electron, packaged: app.isPackaged, exe: exePath() }),
};

/** Nur die eigene Oberfläche (Hauptfenster/Startbild, Hauptframe, aus dem App-Paket) darf den Hauptprozess ansprechen. */
function isTrustedSender(e) {
  const ours = [mainWindow, splash].some((w) => w && !w.isDestroyed() && w.webContents === e.sender);
  if (!ours) return false;
  const frame = e.senderFrame;
  if (!frame || frame.parent) return false;
  const url = frame.url || '';
  return isDev ? url.startsWith('http://localhost:5173') : url.startsWith('file:');
}

function wireIpc() {
  ipcMain.handle('bw:call', async (e, method, args) => {
    if (!isTrustedSender(e)) return { ok: false, error: 'Nicht erlaubt.' };
    const fn = typeof method === 'string' && Object.prototype.hasOwnProperty.call(METHODS, method) ? METHODS[method] : null;
    if (!fn) return { ok: false, error: `Unbekannte Methode ${method}` };
    if (args != null && !Array.isArray(args)) return { ok: false, error: 'Ungültige Argumente.' };
    try {
      return { ok: true, data: await fn(...(args || [])) };
    } catch (err) {
      core.log('warn', `${method}: ${err && err.stack ? err.stack : err}`);
      return { ok: false, error: err.message || String(err), code: err.code || null };
    }
  });

  for (const ev of ['tasks', 'changed', 'notify', 'game-log', 'game-start', 'pending-available']) {
    core.on(ev, (d) => send(ev, d));
  }
  core.on('game-ready', (d) => {
    send('game-ready', d);
    if (directMode) return;
    const w = mainWindow;
    if (!w || w.isDestroyed()) return;
    if (d.afterLaunch === 'hide') w.hide();
    else if (d.afterLaunch === 'minimize') w.minimize();
    else if (d.afterLaunch === 'close') {
      quitWhenGameEnds = false;
      setTimeout(() => app.quit(), 1500);
    }
  });
  core.on('game-exit', (d) => {
    send('game-exit', d);
    if (d.crashed) {
      showMain();
      setTimeout(() => send('game-exit', d), 900); // falls Fenster neu geladen wurde
      if (Notification.isSupported()) new Notification({ title: 'Minecraft ist abgestürzt', body: 'Patina zeigt dir, woran es lag.', icon: ICON }).show();
      return;
    }
    if (quitWhenGameEnds && directMode && core.running.size === 0) {
      app.quit();
      return;
    }
    if ((!mainWindow || mainWindow.isDestroyed()) && !splash && core.running.size === 0) {
      // Fenster wurde während des Spiels geschlossen -> jetzt ganz beenden
      app.quit();
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible() && core.running.size === 0) showMain();
  });
  core.on('notify', (n) => {
    if (Notification.isSupported()) new Notification({ title: n.title, body: n.body || '', icon: ICON }).show();
  });
  core.on('pending-available', (list) => {
    if (!Notification.isSupported()) return;
    const total = list.reduce((s, x) => s + x.count, 0);
    new Notification({ title: `${total} geparkte Mod${total === 1 ? '' : 's'} jetzt verfügbar`, body: list.map((x) => `${x.name}: ${x.titles.slice(0, 3).join(', ')}`).join('\n'), icon: ICON }).show();
  });
}

const thumbCache = new Map();

function registerProtocol() {
  // bwfile://inst/<id>/<relativer Pfad>[?w=Breite] – nur Bilder innerhalb der Instanz
  protocol.handle('bwfile', async (req) => {
    try {
      const u = new URL(req.url);
      const [id, ...rest] = decodeURIComponent(u.pathname).replace(/^\/+/, '').split('/');
      const inst = await core.instances.get(u.hostname === 'inst' ? id : u.hostname);
      const rel = (u.hostname === 'inst' ? rest : [id, ...rest]).join('/');
      const p = path.resolve(inst._dir, rel);
      if (!isInside(inst._dir, p) || !/\.(png|jpe?g)$/i.test(p)) return new Response('nope', { status: 403 });
      const w = Math.min(1600, Math.max(0, Number(u.searchParams.get('w')) || 0));
      if (!w) return net.fetch(pathToFileURL(p).toString());
      const st = fs.statSync(p);
      const key = `${p}|${st.mtimeMs}|${w}`;
      let buf = thumbCache.get(key);
      if (!buf) {
        const img = nativeImage.createFromPath(p);
        if (img.isEmpty()) return net.fetch(pathToFileURL(p).toString());
        const size = img.getSize();
        buf = (size.width > w ? img.resize({ width: w, quality: 'good' }) : img).toJPEG(84);
        thumbCache.set(key, buf);
        if (thumbCache.size > 80) thumbCache.delete(thumbCache.keys().next().value);
      }
      return new Response(buf, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// ---------- Start ----------
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

app.on('second-instance', (_e, argv) => {
  const a = parseArgs(argv);
  if (a.launch) {
    const id = a.launch === 'last' ? core.settings.data.lastInstanceId : a.launch;
    if (id) core.launch(id).catch((e) => {
      showMain();
      send('toast', { type: 'error', text: e.message });
    });
  } else showMain();
});

app.on('window-all-closed', () => {
  if (core && core.running.size > 0) return; // Spiel läuft weiter, Launcher bleibt im Hintergrund
  app.quit();
});

app.whenReady().then(async () => {
  if (!gotLock) return;
  try {
    migrate.migrateDataRoot(path.join(app.getPath('userData'), 'settings.json'), { legacyRoot: legacyDataRoot(), newRoot: defaultDataRoot() });
  } catch (e) {
    console.warn('Datenordner-Migration:', e.message);
  }
  core = new Core({
    userDir: app.getPath('userData'),
    crypt: crypt(),
    platform: { trash: (p) => shell.trashItem(p) },
  });
  await core.init();
  if (process.env.BW_DEV_OFFLINE && !app.isPackaged) {
    // nur für Entwicklung/Tests: Offline-Konto ohne Microsoft-Login
    await core.accounts.upsert({ id: 'offline-dev', uuid: '00000000000000000000000000000000', name: process.env.BW_DEV_OFFLINE, type: 'offline', accessToken: '0', expiresAt: 4102444800000 }, { activate: true });
  }
  registerProtocol();
  wireIpc();
  ensureAppShortcuts();

  // Microsoft-Login-Fenster: keine Fremd-Berechtigungen
  session.fromPartition('persist:blockwerk-msa').setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  const args = parseArgs(process.argv);
  if (args.launch) {
    directLaunch(args.launch);
  } else if (core.settings.data.startupAction === 'lastInstance' && core.settings.data.lastInstanceId && (await core.accounts.list()).length) {
    directLaunch('last');
  } else {
    createMainWindow();
  }

  // Hintergrund: Versionsliste + geparkte Mods prüfen
  setTimeout(() => {
    core.refreshVersions().catch(() => {});
    core.checkAllPending().catch(() => {});
  }, 4000);

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
  });
});
