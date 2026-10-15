'use strict';
// Patina-Kern: verbindet alle Module und stellt die API für die Oberfläche bereit.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const { createPaths } = require('./paths');
const { Versions } = require('./versions');
const { Installer } = require('./installer');
const { JavaManager } = require('./java');
const { Loaders, LOADERS } = require('./loaders');
const { buildCommand, startProcess, redact, createLog4jParser } = require('./launch');
const { Accounts } = require('./accounts');
const { Instances, ICONS } = require('./instances');
const { Modrinth, pickVersion, primaryFile } = require('./modrinth');
const { CurseForge } = require('./curseforge');
const { Content, KINDS, modLoaders, activeResourcePacks, setResourcePackActive } = require('./content');
const { Shaders } = require('./shaders');
const { Upgrader } = require('./upgrade');
const { Tasks } = require('./tasks');
const { Settings } = require('./settings');
const importers = require('./importers');
const norisk = require('./norisk');
const crash = require('./crash');
const http = require('./http');
const { ensureDir, exists, dirSize } = require('./fsutil');

const READY_MARKERS = /Setting user:|Backend library|LWJGL Version|ModLauncher running|Loading Minecraft|Launching target|Starting minecraft client|Loading \d+ mods|Sound engine started/i;

class Core extends EventEmitter {
  /**
   * @param o {userDir, crypt, platform:{openPath, trash, notify}}
   */
  constructor({ userDir, crypt, platform = {} }) {
    super();
    this.userDir = userDir;
    this.crypt = crypt;
    this.platform = platform;
    this.settings = new Settings(path.join(userDir, 'settings.json'));
    this.running = new Map();
    this.lastLogs = new Map();
    this.logBuffer = [];
    this.tasks = new Tasks();
    this.tasks.on('update', (list) => this.emit('tasks', list));
  }

  log(level, msg) {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
    this.logBuffer.push(line);
    if (this.logBuffer.length > 500) this.logBuffer.shift();
    if (level === 'error' || level === 'warn') console.warn(line);
    if (this._logFile) fs.appendFile(this._logFile, line + '\n', () => {});
  }

  async init() {
    const s = await this.settings.load();
    this.paths = createPaths(s.dataRoot);
    for (const k of ['versions', 'libraries', 'assets', 'runtime', 'instances', 'cache', 'logs', 'temp']) await ensureDir(this.paths[k]);
    this._logFile = path.join(this.paths.logs, 'launcher.log');
    const log = (l, m) => this.log(l, m);
    this.versions = new Versions(this.paths, log);
    this.java = new JavaManager({ paths: this.paths, log });
    this.loaders = new Loaders({ paths: this.paths, java: this.java, versions: this.versions, log });
    this.installer = new Installer({ paths: this.paths, versions: this.versions, log });
    this.instances = new Instances({ paths: this.paths, log });
    this.modrinth = new Modrinth({ log });
    this.curseforge = new CurseForge({ apiKey: () => this.settings.get('curseforgeApiKey') || '', log });
    this.content = new Content({ instances: this.instances, modrinth: this.modrinth, curseforge: this.curseforge, log });
    this.shaders = new Shaders({ content: this.content, modrinth: this.modrinth, log });
    this.upgrader = new Upgrader({
      instances: this.instances,
      content: this.content,
      modrinth: this.modrinth,
      loaders: this.loaders,
      versions: this.versions,
      installer: this.installer,
      log,
    });
    this.accounts = new Accounts({
      file: path.join(this.userDir, 'accounts.json'),
      crypt: this.crypt,
      customClientId: () => this.settings.get('azureClientId'),
      log,
    });
    await this.accounts.load();
    // Versionsliste im Hintergrund holen + regelmäßig aktualisieren
    this.versions.manifest().catch(() => {});
    this._poll = setInterval(() => this.refreshVersions().catch(() => {}), 30 * 60 * 1000);
    if (this._poll.unref) this._poll.unref();
    return this;
  }

  async refreshVersions() {
    // bewusst ohne Systembenachrichtigung: neue Versionen zeigt nur die Instanz dezent an
    const m = await this.versions.manifest({ force: true });
    this.emit('changed', { what: 'versions' });
    return m.latest;
  }

  // =============== Zustand ===============

  async state() {
    const s = await this.settings.load();
    let latest = null;
    try {
      latest = await this.versions.latest();
    } catch {}
    return {
      settings: s,
      accounts: await this.accounts.list(),
      instances: await this.listInstances(),
      running: [...this.running.keys()],
      tasks: this.tasks.list(),
      latest,
      platform: process.platform,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      loaders: Object.values(LOADERS),
      icons: ICONS,
    };
  }

  async listInstances() {
    const list = await this.instances.list();
    const out = [];
    for (const i of list) out.push(await this.presentInstance(i));
    return out;
  }

  async presentInstance(i) {
    let mods = 0;
    try {
      mods = (await fsp.readdir(path.join(i._dir, 'mods'))).filter((f) => f.endsWith('.jar')).length;
    } catch {}
    const upgrade = await this.upgrader.quickInfo(i);
    const cover = await newestScreenshot(i._dir);
    return {
      id: i.id,
      name: i.name,
      game: i.game,
      loader: i.loader,
      loaderName: LOADERS[i.loader] ? LOADERS[i.loader].name : i.loader,
      loaderVersion: i.loaderVersion,
      icon: i.icon,
      lastPlayed: i.lastPlayed,
      playTime: i.playTime || 0,
      created: i.created,
      mods,
      pending: (i.pending || []).length,
      running: this.running.has(i.id),
      upgrade,
      memory: i.memory,
      jvmArgs: i.jvmArgs,
      javaPath: i.javaPath,
      resolution: i.resolution,
      quickPlay: i.quickPlay,
      dir: i._dir,
      importedFrom: i.importedFrom || null,
      cover,
    };
  }

  async getInstance(id) {
    return this.presentInstance(await this.instances.get(id));
  }

  // =============== Neuigkeiten (offizielle Patchnotes) ===============

  async news() {
    const file = path.join(this.paths.cache, 'patchnotes.json');
    let data = null;
    const fresh = this._news && Date.now() - this._news.t < 60 * 60e3;
    if (fresh) data = this._news.v;
    else {
      try {
        data = await http.getJson('https://launchercontent.mojang.com/v2/javaPatchNotes.json', { timeout: 12000, retries: 1 });
        this._news = { t: Date.now(), v: data };
        fs.promises.writeFile(file, JSON.stringify(data)).catch(() => {});
      } catch {
        try {
          data = JSON.parse(await fsp.readFile(file, 'utf8'));
        } catch {
          return null;
        }
      }
    }
    const pick = (e) =>
      e && {
        id: e.id,
        title: e.title,
        version: e.version,
        type: e.type,
        date: e.date,
        text: e.shortText,
        image: e.image && e.image.url ? `https://launchercontent.mojang.com${e.image.url}` : null,
        contentPath: e.contentPath,
      };
    const entries = (data && data.entries) || [];
    return {
      release: pick(entries.find((e) => e.type === 'release')),
      snapshot: pick(entries.find((e) => e.type === 'snapshot')),
    };
  }

  async patchNote(contentPath) {
    if (!/^[\w./-]+\.json$/.test(String(contentPath)) || contentPath.includes('..')) throw new Error('Ungültiger Pfad');
    const d = await http.getJson(`https://launchercontent.mojang.com/v2/${contentPath}`, { timeout: 15000 });
    return { title: d.title, body: d.body, image: d.image && d.image.url ? `https://launchercontent.mojang.com${d.image.url}` : null };
  }

  // =============== Versionen & Loader ===============

  async versionList({ snapshots = false, force = false } = {}) {
    const list = await this.versions.list({ force });
    return list.filter((v) => v.type === 'release' || (snapshots && v.type === 'snapshot'));
  }

  /** Welche Loader gibt es für diese Spielversion? */
  async loaderAvailability(game) {
    const res = { vanilla: { available: true, versions: [] } };
    await Promise.all(
      ['fabric', 'quilt', 'forge', 'neoforge'].map(async (l) => {
        try {
          const versions = await this.loaders.versionsFor(l, game);
          const rec = await this.loaders.recommended(l, game);
          res[l] = { available: versions.length > 0, recommended: rec, versions: versions.slice(0, 60) };
        } catch (e) {
          res[l] = { available: false, error: e.message, versions: [] };
        }
      })
    );
    return res;
  }

  // =============== Instanzen ===============

  async createInstance({ name, game, loader = 'vanilla', loaderVersion = null, icon }) {
    if (!game) throw new Error('Bitte eine Minecraft-Version wählen.');
    if (loader !== 'vanilla' && !loaderVersion) {
      loaderVersion = await this.loaders.recommended(loader, game);
      if (!loaderVersion) throw new Error(`${LOADERS[loader].name} gibt es nicht für ${game}.`);
    }
    const inst = await this.instances.create({ name, game, loader, loaderVersion, icon });
    this.emit('changed', { what: 'instances' });
    if (this.settings.get('prefetch')) this.prefetch(inst.id).catch(() => {});
    return this.presentInstance(inst);
  }

  /** Lädt Spieldateien im Hintergrund vor, damit „Spielen“ sofort startet. */
  async prefetch(id) {
    const inst = await this.instances.get(id);
    return this.tasks.run(
      `Bereite ${inst.name} vor`,
      async ({ progress, signal }) => {
        const vid = await this.loaders.install(inst.loader, inst.game, inst.loaderVersion, { progress, signal });
        const plan = await this.installer.prepare(vid, { progress, signal });
        await this.java.ensure(plan.javaMajor, { progress, signal });
      },
      { instanceId: id }
    );
  }

  async updateInstance(id, patch) {
    const allowed = ['name', 'icon', 'memory', 'jvmArgs', 'javaPath', 'resolution', 'quickPlay', 'loaderVersion'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    const inst = await this.instances.update(id, clean);
    this.emit('changed', { what: 'instances' });
    return this.presentInstance(inst);
  }

  async duplicateInstance(id) {
    const inst = await this.tasks.run('Instanz duplizieren', () => this.instances.duplicate(id), { instanceId: id });
    this.emit('changed', { what: 'instances' });
    return this.presentInstance(inst);
  }

  async deleteInstance(id) {
    if (this.running.has(id)) throw new Error('Die Instanz läuft gerade.');
    await this.instances.remove(id, { trash: this.platform.trash });
    this.emit('changed', { what: 'instances' });
  }

  /** Loader wechseln (z. B. Vanilla -> Fabric für Mods/Shader). */
  async changeLoader(id, loader, loaderVersion = null) {
    const inst = await this.instances.get(id);
    if (loader !== 'vanilla' && !loaderVersion) loaderVersion = await this.loaders.recommended(loader, inst.game);
    if (loader !== 'vanilla' && !loaderVersion) throw new Error(`${LOADERS[loader].name} gibt es nicht für ${inst.game}.`);
    inst.loader = loader;
    inst.loaderVersion = loaderVersion;
    for (const d of ['mods', 'config', 'shaderpacks']) await ensureDir(path.join(inst._dir, d));
    await this.instances.save(inst);
    this.emit('changed', { what: 'instances' });
    if (this.settings.get('prefetch')) this.prefetch(id).catch(() => {});
    return this.presentInstance(inst);
  }

  async instanceDetails(id) {
    const inst = await this.instances.get(id);
    return {
      ...(await this.presentInstance(inst)),
      worlds: await this.instances.worlds(id),
      servers: await this.instances.servers(id),
      history: inst.history || [],
    };
  }

  async instanceSize(id) {
    return this.instances.size(id);
  }

  // =============== Inhalte ===============

  async listContent(id, kind) {
    const inst = await this.instances.get(id);
    const items = await this.content.scan(inst, [kind]);
    const extra = {};
    if (kind === 'shader') {
      extra.active = await this.shaders.active(inst);
      extra.status = await this.shaders.status(inst).catch(() => ({ supported: false }));
    }
    if (kind === 'resourcepack') {
      const act = await activeResourcePacks(inst);
      for (const it of items) it.active = act.includes(`file/${it.file}`);
    }
    return { items, ...extra };
  }

  async installContent(id, projectId, { kind = 'mod', versionId = null, title } = {}) {
    const inst = await this.instances.get(id);
    try {
      projectId = (await this.modrinth.project(projectId)).id;
    } catch {}
    const res = await this.tasks.run(
      `Installiere ${title || 'Inhalt'}`,
      ({ progress, signal }) =>
        kind === 'shader' ? this.shaders.installAndActivate(inst, projectId, { versionId, progress }) : this.content.install(inst, projectId, { kind, versionId, progress, signal }),
      { instanceId: id }
    );
    if (kind === 'resourcepack') {
      const items = await this.content.scan(inst, ['resourcepack'], { identify: false });
      const it = items.find((i) => i.projectId === projectId || (res.installed[0] && i.title === res.installed[0].title));
      if (it) await setResourcePackActive(inst, it.file, true);
    }
    this.emit('changed', { what: 'content', instanceId: id });
    return res;
  }

  async setContentEnabled(id, key, enabled) {
    const inst = await this.instances.get(id);
    await this.content.setEnabled(inst, key, enabled);
    this.emit('changed', { what: 'content', instanceId: id });
  }

  async removeContent(id, key) {
    const inst = await this.instances.get(id);
    await this.content.remove(inst, key);
    this.emit('changed', { what: 'content', instanceId: id });
  }

  async addLocalContent(id, files, kind) {
    const inst = await this.instances.get(id);
    const out = [];
    for (const f of files) out.push(await this.content.addLocalFile(inst, f, kind));
    this.emit('changed', { what: 'content', instanceId: id });
    return out;
  }

  async checkUpdates(id) {
    const inst = await this.instances.get(id);
    return this.tasks.run('Suche Updates', () => this.content.checkUpdates(inst), { instanceId: id, quiet: true });
  }

  async applyUpdates(id, updates) {
    const inst = await this.instances.get(id);
    const n = await this.tasks.run(`Aktualisiere ${updates.length} Inhalte`, ({ progress, signal }) => this.content.applyUpdates(inst, updates, { progress, signal }), { instanceId: id });
    this.emit('changed', { what: 'content', instanceId: id });
    return n;
  }

  async activateShader(id, file) {
    const inst = await this.instances.get(id);
    if (file) await this.shaders.ensureSupport(inst);
    await this.shaders.activate(inst, file);
    this.emit('changed', { what: 'content', instanceId: id });
  }

  async setResourcePack(id, file, active) {
    const inst = await this.instances.get(id);
    await setResourcePackActive(inst, file, active);
    this.emit('changed', { what: 'content', instanceId: id });
  }

  // =============== Entdecken (Modrinth) ===============

  async search(q) {
    return this.modrinth.search(q);
  }

  async project(idOrSlug) {
    const p = await this.modrinth.project(idOrSlug);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      body: p.body,
      icon: p.icon_url,
      downloads: p.downloads,
      followers: p.followers,
      type: p.project_type,
      categories: p.categories,
      loaders: p.loaders,
      gameVersions: p.game_versions,
      gallery: (p.gallery || []).map((g) => ({ url: g.url, title: g.title, featured: g.featured })),
      links: { source: p.source_url, issues: p.issues_url, wiki: p.wiki_url, discord: p.discord_url, page: `https://modrinth.com/${p.project_type}/${p.slug}` },
      updated: p.updated,
      license: p.license && p.license.id,
      clientSide: p.client_side,
    };
  }

  async projectVersions(idOrSlug, { loaders, gameVersions } = {}) {
    const list = await this.modrinth.versions(idOrSlug, { loaders, gameVersions });
    return list.slice(0, 50).map((v) => ({ id: v.id, name: v.name, number: v.version_number, type: v.version_type, loaders: v.loaders, gameVersions: v.game_versions, date: v.date_published, downloads: v.downloads }));
  }

  /** Für welche Instanzen passt ein Projekt? (für den „Installieren in …“-Dialog) */
  async compatibleInstances(projectId, kind) {
    const p = await this.modrinth.project(projectId);
    const list = await this.instances.list();
    const out = [];
    for (const i of list) {
      let ok = true;
      let installed = false;
      try {
        installed = (await this.content.installedProjectIds(i, kind === 'modpack' ? 'mod' : kind)).has(p.id);
      } catch {}
      if (kind === 'mod') ok = i.loader !== 'vanilla' && p.game_versions.includes(i.game) && (p.loaders || []).some((l) => modLoaders(i.loader).includes(l));
      else if (kind === 'resourcepack') ok = true;
      else if (kind === 'shader') ok = true;
      out.push({ id: i.id, name: i.name, game: i.game, loader: i.loader, icon: i.icon, compatible: ok, installed });
    }
    return out;
  }

  /** Modrinth-Modpack als neue Instanz installieren. */
  async installModpack(projectId, { versionId = null } = {}) {
    const p = await this.modrinth.project(projectId);
    return this.tasks.run(`Installiere Modpack ${p.title}`, async ({ progress, signal }) => {
      let v;
      if (versionId) v = await this.modrinth.version(versionId);
      else v = pickVersion(await this.modrinth.versions(projectId));
      if (!v) throw new Error('Keine Version des Modpacks gefunden.');
      const file = primaryFile(v);
      const tmp = path.join(this.paths.temp, `${p.slug}-${v.id}.mrpack`);
      progress({ label: 'Lade Modpack …', done: 0, total: 1 });
      await http.download(file.url, tmp, { sha1: file.hashes.sha1, signal, onProgress: (d, t) => progress({ label: 'Lade Modpack …', done: d, total: t }) });
      return this._installMrpackFile(tmp, { name: p.title, iconUrl: p.icon_url, progress, signal, modpack: { projectId: p.id, versionId: v.id, version: v.version_number } });
    });
  }

  async importMrpack(file) {
    return this.tasks.run('Importiere Modpack', ({ progress, signal }) => this._installMrpackFile(file, { progress, signal }));
  }

  async _installMrpackFile(file, { name, progress, signal, modpack }) {
    const pack = importers.readMrpack(file);
    const inst = await this.instances.create({
      name: name || pack.name,
      game: pack.game,
      loader: pack.loader,
      loaderVersion: pack.loaderVersion,
      extra: { modpack: modpack || { name: pack.name } },
    });
    try {
      await importers.installMrpackFiles(pack, inst._dir, { progress, signal });
      await this.content.scan(inst);
    } catch (e) {
      await this.instances.remove(inst.id).catch(() => {});
      throw e;
    }
    this.emit('changed', { what: 'instances' });
    if (this.settings.get('prefetch')) this.prefetch(inst.id).catch(() => {});
    return this.presentInstance(inst);
  }

  // =============== Upgrade ===============

  async upgradeTargets(id) {
    const inst = await this.instances.get(id);
    return this.upgrader.targets(inst, { snapshots: this.settings.get('showSnapshots') });
  }

  async upgradePlan(id, target) {
    const inst = await this.instances.get(id);
    return this.tasks.run(`Prüfe Kompatibilität mit ${target}`, ({ progress }) => this.upgrader.plan(inst, target, { progress }), { instanceId: id, quiet: true });
  }

  async upgradeApply(id, plan, opts) {
    if (this.running.has(id)) throw new Error('Bitte erst das Spiel beenden.');
    const inst = await this.instances.get(id);
    const report = await this.tasks.run(
      `Upgrade ${inst.name} auf ${plan.to}`,
      ({ progress, signal }) => this.upgrader.apply(inst, plan, { backupWorlds: this.settings.get('backupWorldsOnUpgrade'), ...opts }, { progress, signal }),
      { instanceId: id, cancellable: false }
    );
    this.emit('changed', { what: 'instances' });
    return report;
  }

  async backups(id) {
    return this.upgrader.listBackups(await this.instances.get(id));
  }

  async restoreBackup(id, backupId) {
    if (this.running.has(id)) throw new Error('Bitte erst das Spiel beenden.');
    const inst = await this.instances.get(id);
    await this.tasks.run('Stelle Sicherung wieder her', ({ progress }) => this.upgrader.restore(inst, backupId, { progress }), { instanceId: id, cancellable: false });
    this.emit('changed', { what: 'instances' });
  }

  async deleteBackup(id, backupId) {
    await this.upgrader.deleteBackup(await this.instances.get(id), backupId);
  }

  async createBackup(id, { includeWorlds = true } = {}) {
    const inst = await this.instances.get(id);
    return this.tasks.run('Erstelle Sicherung', ({ progress }) => this.upgrader.createBackup(inst, { includeWorlds, reason: 'manuell', progress }), { instanceId: id });
  }

  async checkPending(id) {
    return this.upgrader.checkPending(await this.instances.get(id));
  }

  async applyPending(id, keys) {
    const inst = await this.instances.get(id);
    const n = await this.tasks.run('Aktiviere nachgereichte Mods', ({ progress }) => this.upgrader.applyPending(inst, keys, { progress }), { instanceId: id });
    this.emit('changed', { what: 'instances' });
    return n;
  }

  async dismissPending(id, key) {
    await this.upgrader.dismissPending(await this.instances.get(id), key);
    this.emit('changed', { what: 'instances' });
  }

  /** Beim Start: geparkte Mods prüfen und ggf. melden. */
  async checkAllPending() {
    const list = await this.instances.list();
    const found = [];
    for (const i of list) {
      if (!(i.pending || []).length) continue;
      const res = await this.upgrader.checkPending(i).catch(() => []);
      const avail = res.filter((r) => r.available);
      if (avail.length) found.push({ instanceId: i.id, name: i.name, count: avail.length, titles: avail.map((a) => a.title) });
    }
    if (found.length) this.emit('pending-available', found);
    return found;
  }

  // =============== Import ===============

  async scanCurseForge(extraDirs = []) {
    const dirs = [...importers.defaultCurseForgeDirs(), ...extraDirs];
    const list = await importers.scanCurseForge(dirs);
    const existing = new Set((await this.instances.list()).map((i) => i.importedFrom).filter(Boolean));
    return list.map((x) => ({ ...x, alreadyImported: existing.has(x.path) }));
  }

  async scanModrinth(extraDirs = []) {
    const dirs = [...importers.defaultModrinthDirs(), ...extraDirs];
    const list = await importers.scanModrinthApp(dirs);
    const existing = new Set((await this.instances.list()).map((i) => i.importedFrom).filter(Boolean));
    return list.map((x) => ({ ...x, alreadyImported: existing.has(x.path) }));
  }

  async scanNoRisk(extraDirs = []) {
    const dirs = [...norisk.defaultNoRiskRoots(), ...extraDirs];
    const list = await norisk.scanNoRisk(dirs, { withSqliteCopy: importers.withSqliteCopy });
    const existing = new Set((await this.instances.list()).map((i) => i.importedFrom).filter(Boolean));
    return list.map((x) => ({ ...x, alreadyImported: existing.has(x.key) }));
  }

  async guessFolder(dir) {
    return importers.guessFolder(dir);
  }

  /** Importiert Instanzen (CurseForge oder Ordner). items: [{path, name, game, loader, loaderVersion, memory}] */
  async importInstances(items, { includeWorlds = true } = {}) {
    const results = [];
    for (const it of items) {
      const res = await this.tasks.run(`Importiere ${it.name}`, async ({ progress }) => {
        if (!it.game) throw new Error(`Für „${it.name}“ ist keine Minecraft-Version bekannt.`);
        let loaderVersion = it.loaderVersion;
        if (it.loader !== 'vanilla' && !loaderVersion) loaderVersion = await this.loaders.recommended(it.loader, it.game);
        const inst = await this.instances.create({
          name: it.name,
          game: it.game,
          loader: it.loader,
          loaderVersion,
          extra: {
            importedFrom: it.source === 'norisk' && it.key ? it.key : it.path,
            memory: it.memory ? { max: it.memory } : null,
            playTime: it.source === 'norisk' ? Number(it.playTime) || 0 : 0,
          },
        });
        try {
          progress({ label: 'Kopiere Mods, Configs und Welten …', done: 0, total: 0 });
          if (it.source === 'norisk') {
            // mods/ ist beim NoRisk-Launcher in Unterordner aufgeteilt -> Mods gezielt übernehmen
            const skipTop = ['mods', 'custom_mods', 'noriskclient', ...(Array.isArray(it.excludeDirs) ? it.excludeDirs : [])];
            await importers.copyInstanceContent(it.path, inst._dir, { includeWorlds, progress, skipTop });
            progress({ label: 'Übernehme Mods …', done: 0, total: 0 });
            await norisk.placeNoRiskMods(it.noriskMods, path.join(inst._dir, 'mods'));
          } else {
            await importers.copyInstanceContent(it.path, inst._dir, { includeWorlds, progress });
          }
          progress({ label: 'Erkenne Mods …', done: 0, total: 0 });
          await this.content.scan(inst);
          const cfManifest = await readJsonSafe(path.join(it.path, 'minecraftinstance.json'));
          if (cfManifest) await this.content.applyCurseForgeManifest(inst, cfManifest);
        } catch (e) {
          await this.instances.remove(inst.id).catch(() => {});
          throw e;
        }
        return inst;
      });
      results.push(res.id);
    }
    this.emit('changed', { what: 'instances' });
    return results;
  }

  // =============== Konten ===============

  async completeLogin(code) {
    const acc = await this.accounts.completeLogin(code);
    this.emit('changed', { what: 'accounts' });
    return { name: acc.name, uuid: acc.uuid };
  }

  async removeAccount(id) {
    await this.accounts.remove(id);
    this.emit('changed', { what: 'accounts' });
  }

  async setActiveAccount(id) {
    await this.accounts.setActive(id);
    this.emit('changed', { what: 'accounts' });
  }

  // =============== Starten ===============

  async launch(id, { quickPlay = null } = {}) {
    if (this.running.has(id)) throw new Error('Diese Instanz läuft bereits.');
    const inst = await this.instances.get(id);
    const s = this.settings.data;
    return this.tasks.run(
      `Starte ${inst.name}`,
      async ({ progress, signal }) => {
        progress({ label: 'Prüfe Anmeldung …', done: 0, total: 1 });
        const account = await this.accounts.ensureValid();
        progress({ label: inst.loader === 'vanilla' ? 'Prüfe Spieldateien …' : `Prüfe ${LOADERS[inst.loader].name} …`, done: 0, total: 1 });
        const versionId = await this.loaders.install(inst.loader, inst.game, inst.loaderVersion, { progress, signal });
        const plan = await this.installer.prepare(versionId, { progress, signal });
        let javaPath = inst.javaPath;
        if (javaPath && !(await exists(javaPath))) javaPath = null;
        if (!javaPath) javaPath = await this.java.ensure(plan.javaMajor, { progress, signal });
        const memMax = (inst.memory && inst.memory.max) || s.memoryMax;
        const jvmArgs = [...splitArgs(s.jvmArgs), ...splitArgs(inst.jvmArgs)];
        const qp = quickPlay || inst.quickPlay || null;
        const cmd = buildCommand(plan, {
          account,
          gameDir: inst._dir,
          javaPath,
          memory: { min: Math.min(s.memoryMin, memMax), max: memMax },
          jvmArgs,
          resolution: inst.resolution,
          quickPlay: qp,
          clientId: s.launcherClientId,
          libraryDir: this.paths.libraries,
        });
        await ensureDir(path.join(inst._dir, 'logs'));
        this.log('info', `Starte ${inst.name}: ${cmd.java} ${redact(cmd.args, account.accessToken).join(' ').slice(0, 4000)}`);
        progress({ label: 'Starte Minecraft …', done: 1, total: 1 });
        const startedAt = Date.now();
        inst.lastPlayed = new Date().toISOString();
        await this.instances.save(inst);
        await this.settings.set({ lastInstanceId: inst.id });

        const lines = [];
        let pendingLines = [];
        let flush = null;
        let resolveReady;
        const ready = new Promise((r) => (resolveReady = r));
        const run = { startedAt, lines, child: null, stoppedByUser: false };
        const tok = account.accessToken && account.accessToken.length > 12 ? account.accessToken : null;
        const parser = createLog4jParser((l) => {
          const clean = tok && l.includes(tok) ? l.split(tok).join('••••') : l;
          lines.push(clean);
          if (lines.length > 4000) lines.shift();
          pendingLines.push(clean);
          if (READY_MARKERS.test(clean)) resolveReady('ready');
          if (!flush) {
            flush = setTimeout(() => {
              this.emit('game-log', { instanceId: id, lines: pendingLines });
              pendingLines = [];
              flush = null;
            }, 250);
          }
        });
        const child = await startProcess(cmd, {
          logFile: path.join(inst._dir, 'logs', 'patina-launch.log'),
          javaMajor: plan.javaMajor,
          onLine: (l) => parser.feed(l),
          onExit: async ({ code, error }) => {
            parser.end();
            resolveReady('exit');
            this.running.delete(id);
            this.lastLogs.set(id, lines.slice());
            const secs = Math.round((Date.now() - startedAt) / 1000);
            try {
              const fresh = await this.instances.get(id);
              fresh.playTime = (fresh.playTime || 0) + secs;
              await this.instances.save(fresh);
            } catch {}
            const report = await crash.latestCrashReport(inst._dir, startedAt);
            const normalStop = lines.slice(-40).some((l) => /\bStopping!|Stopping server|Shutting down/.test(l)) && !report;
            const killed = [130, 137, 143, -1073741510, 3221225786].includes(code);
            const crashed = !run.stoppedByUser && !normalStop && !killed && (code !== 0 || Boolean(error));
            let analysis = null;
            if (crashed) {
              let text = lines.slice(-600).join('\n');
              if (report) text += '\n' + (await fsp.readFile(report, 'utf8').catch(() => ''));
              analysis = { hints: crash.analyze(text), report, tail: lines.slice(-80), code };
            }
            this.emit('game-exit', { instanceId: id, code, crashed: Boolean(crashed), analysis, seconds: secs, error: error ? error.message : null });
            this.emit('changed', { what: 'instances' });
          },
        });
        run.child = child;
        this.running.set(id, run);
        this.emit('game-start', { instanceId: id, afterLaunch: s.afterLaunch });
        this.emit('changed', { what: 'instances' });
        // warten bis das Spielfenster kommt (oder max. 25 s)
        const r = await Promise.race([ready, new Promise((res) => setTimeout(() => res('timeout'), 25000))]);
        if (r === 'exit') {
          throw new Error('Minecraft wurde direkt wieder beendet. Details im Absturz-Dialog.');
        }
        this.emit('game-ready', { instanceId: id, afterLaunch: s.afterLaunch });
        return { started: true };
      },
      { instanceId: id }
    );
  }

  stop(id) {
    const r = this.running.get(id);
    if (!r) return false;
    r.stoppedByUser = true;
    try {
      if (process.platform === 'win32') require('child_process').spawn('taskkill', ['/pid', String(r.child.pid), '/T', '/F'], { windowsHide: true });
      else r.child.kill('SIGTERM');
    } catch {}
    return true;
  }

  gameLog(id) {
    const r = this.running.get(id);
    return r ? r.lines.slice(-2000) : (this.lastLogs.get(id) || []).slice(-2000);
  }

  launcherLog() {
    return this.logBuffer.slice();
  }

  /** Dateien neu prüfen (alle Libraries & Assets mit Hash). */
  async repair(id) {
    const inst = await this.instances.get(id);
    return this.tasks.run(`Repariere ${inst.name}`, async ({ progress, signal }) => {
      const vid = await this.loaders.install(inst.loader, inst.game, inst.loaderVersion, { progress, signal });
      await fsp.rm(path.join(this.paths.natives, vid), { recursive: true, force: true });
      await this.installer.prepare(vid, { progress, signal });
    }, { instanceId: id });
  }

  // =============== Einstellungen & Java ===============

  async setSettings(patch) {
    const s = await this.settings.set(patch);
    this.emit('changed', { what: 'settings' });
    return s;
  }

  async javaRuntimes() {
    return this.java.installed();
  }

  async storageInfo() {
    const parts = {};
    for (const k of ['instances', 'libraries', 'assets', 'versions', 'runtime']) parts[k] = await dirSize(this.paths[k]);
    return { root: this.paths.root, parts };
  }

  dispose() {
    clearInterval(this._poll);
  }
}

/** Neuester Screenshot einer Instanz (relativer Pfad) – dient als Titelbild. */
async function newestScreenshot(dir) {
  const sdir = path.join(dir, 'screenshots');
  let names;
  try {
    names = (await fsp.readdir(sdir)).filter((n) => /\.(png|jpe?g)$/i.test(n));
  } catch {
    return null;
  }
  if (!names.length) return null;
  // Dateinamen sind Zeitstempel (2026-10-14_18.03.12.png) -> sortieren reicht meist; mtime als Absicherung
  let best = null;
  for (const n of names.sort().slice(-40)) {
    try {
      const st = await fsp.stat(path.join(sdir, n));
      if (!best || st.mtimeMs > best.t) best = { n, t: st.mtimeMs };
    } catch {}
  }
  return best ? `screenshots/${best.n}` : null;
}

async function readJsonSafe(f) {
  try {
    return JSON.parse((await fsp.readFile(f, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function splitArgs(s) {
  if (!s) return [];
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

module.exports = { Core, splitArgs };
