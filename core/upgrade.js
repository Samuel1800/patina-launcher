'use strict';
// 1-Klick-Versionsupgrade: Instanz inkl. aller Mods/Shader/Pakete auf eine neue Minecraft-Version heben.
// Einstellungen, Configs und Welten bleiben erhalten. Vorher wird automatisch gesichert,
// bei Fehlern automatisch zurückgerollt. Mods ohne passende Version werden geparkt und
// später automatisch nachgezogen, sobald es sie gibt.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson, exists, ensureDir, copyDir, dirSize } = require('./fsutil');
const { modLoaders, loaderFilter, KINDS, DISABLED } = require('./content');
const { META_DIR } = require('./instances');
const { LOADERS } = require('./loaders');

const BACKUP_ITEMS = ['mods', 'config', 'shaderpacks', 'resourcepacks', 'options.txt', 'optionsof.txt', 'optionsshaders.txt', 'defaultconfigs', 'kubejs'];

class Upgrader {
  constructor({ instances, content, modrinth, loaders, versions, installer, log = () => {} }) {
    this.instances = instances;
    this.content = content;
    this.modrinth = modrinth;
    this.loaders = loaders;
    this.versions = versions;
    this.installer = installer;
    this.log = log;
    this._planCache = new Map();
  }

  backupsDir(inst) {
    return path.join(inst._dir, META_DIR, 'backups');
  }

  /** Neuere Versionen als die der Instanz (neueste zuerst). */
  async targets(inst, { snapshots = false } = {}) {
    const list = await this.versions.list();
    const idx = list.findIndex((v) => v.id === inst.game);
    const newer = (idx < 0 ? list : list.slice(0, idx)).filter((v) => v.type === 'release' || (snapshots && v.type === 'snapshot'));
    return newer.map((v) => v.id);
  }

  /** Schnelle Info für die Bibliothek: gibt es eine neuere Release-Version? */
  async quickInfo(inst) {
    try {
      const latest = (await this.versions.latest()).release;
      const t = await this.targets(inst);
      if (!t.length || t[0] !== latest) return { newer: false, latest };
      const cached = this._planCache.get(`${inst.id}:${latest}`);
      return { newer: true, latest, summary: cached && Date.now() - cached.t < 3600e3 ? cached.summary : null };
    } catch {
      return { newer: false };
    }
  }

  /**
   * Kompatibilitäts-Vorschau.
   * status: update | compatible | missing | unknown | keep
   */
  async plan(inst, target, { progress = () => {} } = {}) {
    progress({ label: 'Prüfe Modloader …', done: 0, total: 1 });
    let loaderVersion = null;
    let loaderAvailable = true;
    if (inst.loader !== 'vanilla') {
      loaderVersion = await this.loaders.recommended(inst.loader, target).catch(() => null);
      loaderAvailable = Boolean(loaderVersion);
    }
    progress({ label: 'Lese installierte Inhalte …', done: 0, total: 1 });
    const items = await this.content.scan(inst, ['mod', 'shader', 'resourcepack']);
    const result = [];

    // Mods
    const mods = items.filter((i) => i.kind === 'mod');
    const loaders = modLoaders(inst.loader);
    const hashed = mods.filter((m) => m.projectId && m.sha1 && m.source === 'modrinth');
    let latest = {};
    if (hashed.length && loaders.length) {
      latest = await this.modrinth.latestForHashes(hashed.map((m) => m.sha1), { loaders, gameVersions: [target] }).catch(() => ({}));
    }
    let done = 0;
    // Alpha/Beta-Treffer aus der Sammelabfrage: lieber per Projekt nach einem Release suchen
    for (const [h, v] of Object.entries(latest)) if (v && v.version_type !== 'release') delete latest[h];
    const perProject = mods.filter((m) => m.projectId && !(m.sha1 && latest[m.sha1]));
    const perProjectRes = new Map();
    await poolSimple(perProject, 6, async (m) => {
      try {
        const v = await this.content.compatibleVersion(inst, m.projectId, 'mod', { game: target });
        perProjectRes.set(m.key, v);
      } catch {
        perProjectRes.set(m.key, null);
      }
      progress({ label: `Prüfe Mods … (${++done}/${perProject.length})`, done, total: perProject.length });
    });
    // CurseForge-Mods (nur mit API-Schlüssel automatisch)
    const cfEnabled = Boolean(this.content.curseforge && this.content.curseforge.enabled());
    const cfRes = new Map();
    if (cfEnabled) {
      const cfMods = mods.filter((m) => !m.projectId && m.cfProjectId);
      let cdone = 0;
      await poolSimple(cfMods, 4, async (m) => {
        try {
          cfRes.set(m.key, await this.content.compatibleCurseForgeFile(inst, m.cfProjectId, { game: target }));
        } catch {
          cfRes.set(m.key, null);
        }
        progress({ label: `Prüfe CurseForge-Mods … (${++cdone}/${cfMods.length})`, done: cdone, total: cfMods.length });
      });
    }
    for (const m of mods) {
      const base = { key: m.key, kind: 'mod', title: m.title, icon: m.icon, from: m.version, enabled: m.enabled, projectId: m.projectId, cfProjectId: m.cfProjectId, source: m.source };
      if (!m.projectId && m.cfProjectId) {
        if (!cfEnabled) {
          result.push({ ...base, status: 'unknown', note: 'cf-key' });
          continue;
        }
        const f = cfRes.get(m.key);
        if (!f) result.push({ ...base, status: 'missing' });
        else if (!f.downloadUrl) result.push({ ...base, status: 'missing', note: 'cf-no-download' });
        else if (f.id === m.cfFileId) result.push({ ...base, status: 'compatible', to: f.displayName, cfFileId: f.id });
        else result.push({ ...base, status: 'update', to: f.displayName, cfFileId: f.id });
        continue;
      }
      if (!m.projectId) {
        result.push({ ...base, status: 'unknown' });
        continue;
      }
      const v = (m.sha1 && latest[m.sha1]) || perProjectRes.get(m.key) || null;
      if (!v) result.push({ ...base, status: 'missing' });
      else if (v.id === m.versionId) result.push({ ...base, status: 'compatible', to: v.version_number, versionId: v.id });
      else result.push({ ...base, status: 'update', to: v.version_number, versionId: v.id });
    }

    // Shader & Ressourcenpakete (meist versionsunabhängig)
    for (const it of items.filter((i) => i.kind !== 'mod')) {
      const base = { key: it.key, kind: it.kind, title: it.title, icon: it.icon, from: it.version, enabled: it.enabled, projectId: it.projectId };
      if (!it.projectId) {
        result.push({ ...base, status: 'keep' });
        continue;
      }
      let v = null;
      try {
        v = await this.content.compatibleVersion(inst, it.projectId, it.kind, { game: target });
      } catch {}
      if (v && v.id !== it.versionId) result.push({ ...base, status: 'update', to: v.version_number, versionId: v.id });
      else result.push({ ...base, status: 'keep' });
    }

    const enabledMods = result.filter((r) => r.kind === 'mod' && r.enabled);
    const summary = {
      total: enabledMods.length,
      ready: enabledMods.filter((r) => r.status === 'update' || r.status === 'compatible').length,
      missing: enabledMods.filter((r) => r.status === 'missing').length,
      unknown: enabledMods.filter((r) => r.status === 'unknown').length,
      cfKeyNeeded: enabledMods.filter((r) => r.note === 'cf-key').length,
      updates: result.filter((r) => r.status === 'update').length,
      loaderAvailable,
    };
    const worldsSize = await dirSize(path.join(inst._dir, 'saves'));
    const plan = {
      instanceId: inst.id,
      from: inst.game,
      to: target,
      loader: inst.loader,
      loaderName: LOADERS[inst.loader] ? LOADERS[inst.loader].name : inst.loader,
      loaderVersion,
      loaderAvailable,
      items: result.sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.title.localeCompare(b.title)),
      summary,
      worldsSize,
      createdAt: Date.now(),
    };
    this._planCache.set(`${inst.id}:${target}`, { t: Date.now(), summary });
    return plan;
  }

  // ---------- Backups ----------

  async createBackup(inst, { includeWorlds = false, reason = 'upgrade', progress = () => {} } = {}) {
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}_${inst.game}`;
    const dir = path.join(this.backupsDir(inst), id);
    await ensureDir(dir);
    progress({ label: 'Sichere Mods, Configs und Einstellungen …', done: 0, total: 1 });
    for (const item of [...BACKUP_ITEMS, ...(includeWorlds ? ['saves'] : [])]) {
      const src = path.join(inst._dir, item);
      if (!(await exists(src))) continue;
      const st = await fsp.stat(src);
      if (st.isDirectory()) {
        if (item === 'saves') progress({ label: 'Sichere Welten …', done: 0, total: 1 });
        await copyDir(src, path.join(dir, item));
      } else await fsp.copyFile(src, path.join(dir, item));
    }
    const cache = await readJson(path.join(inst._dir, META_DIR, 'content.json'));
    const snapshot = { ...inst };
    await writeJson(path.join(dir, 'backup.json'), {
      id,
      at: new Date().toISOString(),
      reason,
      game: inst.game,
      loader: inst.loader,
      loaderVersion: inst.loaderVersion,
      includesWorlds: includeWorlds,
      instance: snapshot,
      contentCache: cache,
    });
    return id;
  }

  async listBackups(inst) {
    const dir = this.backupsDir(inst);
    const out = [];
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const meta = await readJson(path.join(dir, e.name, 'backup.json'));
      if (!meta) continue;
      out.push({ id: meta.id, at: meta.at, game: meta.game, loader: meta.loader, loaderVersion: meta.loaderVersion, includesWorlds: meta.includesWorlds, reason: meta.reason, size: await dirSize(path.join(dir, e.name)) });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }

  async deleteBackup(inst, id) {
    const dir = path.join(this.backupsDir(inst), path.basename(id));
    await fsp.rm(dir, { recursive: true, force: true });
  }

  /** Stellt eine Sicherung wieder her (Version, Mods, Configs, ggf. Welten). */
  async restore(inst, backupId, { progress = () => {} } = {}) {
    const dir = path.join(this.backupsDir(inst), path.basename(backupId));
    const meta = await readJson(path.join(dir, 'backup.json'));
    if (!meta) throw new Error('Sicherung nicht gefunden.');
    progress({ label: 'Stelle Sicherung wieder her …', done: 0, total: 1 });
    for (const item of [...BACKUP_ITEMS, 'saves']) {
      const src = path.join(dir, item);
      if (!(await exists(src))) {
        // Ordner, die es zum Sicherungszeitpunkt nicht gab, leeren wir nicht – außer mods
        continue;
      }
      const dest = path.join(inst._dir, item);
      const st = await fsp.stat(src);
      if (st.isDirectory()) {
        if (item === 'saves') {
          // nur gesicherte Welten zurückspielen, neue Welten bleiben
          for (const w of await fsp.readdir(src)) {
            await fsp.rm(path.join(dest, w), { recursive: true, force: true });
            await copyDir(path.join(src, w), path.join(dest, w));
          }
        } else {
          await fsp.rm(dest, { recursive: true, force: true });
          await copyDir(src, dest);
        }
      } else await fsp.copyFile(src, dest);
    }
    if (meta.contentCache) await writeJson(path.join(inst._dir, META_DIR, 'content.json'), meta.contentCache);
    const snap = meta.instance || {};
    inst.game = meta.game;
    inst.loader = meta.loader;
    inst.loaderVersion = meta.loaderVersion;
    inst.pending = snap.pending || [];
    inst.history = [...(inst.history || []), { type: 'restore', at: new Date().toISOString(), backupId, to: meta.game }];
    await this.instances.save(inst);
    return inst;
  }

  // ---------- Upgrade ausführen ----------

  /**
   * @param opts {mode:'inplace'|'copy', backupWorlds:boolean, disableMissing:boolean, disableUnknown:boolean, prefetch:boolean}
   */
  async apply(instIn, plan, opts = {}, { progress = () => {}, signal } = {}) {
    const { mode = 'inplace', backupWorlds = true, disableMissing = true, disableUnknown = true, prefetch = true } = opts;
    if (!plan.loaderAvailable) throw new Error(`${plan.loaderName} gibt es noch nicht für Minecraft ${plan.to}.`);
    let inst = instIn;
    let backupId = null;
    if (mode === 'copy') {
      progress({ label: 'Kopiere Instanz …', done: 0, total: 1 });
      inst = await this.instances.duplicate(instIn.id, { name: opts.newName || `${instIn.name} ${plan.to}` });
    } else {
      backupId = await this.createBackup(inst, { includeWorlds: backupWorlds, reason: `Upgrade ${plan.from} → ${plan.to}`, progress });
    }

    const report = { updated: [], kept: [], parked: [], deps: [], warnings: [], backupId, instanceId: inst.id };
    try {
      const cache = await this.content.loadCache(inst);
      const updates = plan.items.filter((i) => i.status === 'update');
      let n = 0;
      const newVersions = [];
      progress({ label: `Aktualisiere ${updates.length} Inhalte …`, done: 0, total: updates.length || 1 });
      await poolSimple(updates, 6, async (u) => {
        if (signal && signal.aborted) throw new Error('Abgebrochen');
        let name;
        if (u.cfFileId) {
          const f = await this.content.curseforge.file(u.cfProjectId, u.cfFileId);
          name = await this.content.placeCurseForgeFile(inst, f, u.kind, { cache, replaceKey: u.key, signal });
        } else {
          const v = await this.modrinth.version(u.versionId);
          name = await this.content.placeVersion(inst, v, u.kind, { cache, signal });
          newVersions.push(v);
        }
        if (!u.enabled) await this.content.setEnabled(inst, `${u.kind}/${name}`, false);
        report.updated.push({ title: u.title, from: u.from, to: u.to, kind: u.kind });
        n++;
        progress({ label: `Aktualisiert: ${u.title} (${n}/${updates.length})`, done: n, total: updates.length });
      });
      await this.content.saveCache(inst, cache);
      for (const i of plan.items.filter((x) => x.status === 'compatible' || x.status === 'keep')) report.kept.push({ title: i.title, kind: i.kind });

      // Mods ohne passende Version parken
      // Bereits geparkte Mods warten jetzt auf die neue Version
      const pending = (inst.pending || []).map((p) => ({ ...p, forGame: plan.to }));
      for (const m of plan.items.filter((i) => i.kind === 'mod' && i.enabled && (i.status === 'missing' || i.status === 'unknown'))) {
        const disable = m.status === 'missing' ? disableMissing : disableUnknown;
        if (!disable) continue;
        await this.content.setEnabled(inst, m.key, false);
        if (pending.some((p) => p.key === m.key)) continue;
        pending.push({ key: m.key, projectId: m.projectId || null, cfProjectId: m.cfProjectId || null, title: m.title, icon: m.icon || null, forGame: plan.to, since: new Date().toISOString(), reason: m.status });
        report.parked.push({ title: m.title, reason: m.status });
      }

      // Neue Pflicht-Abhängigkeiten nachinstallieren
      progress({ label: 'Prüfe Abhängigkeiten …', done: 0, total: 1 });
      inst.game = plan.to;
      inst.loaderVersion = plan.loaderVersion;
      const installedIds = await this.content.installedProjectIds(inst, 'mod');
      for (const v of newVersions) {
        for (const dep of v.dependencies || []) {
          if (dep.dependency_type !== 'required' || !dep.project_id || installedIds.has(dep.project_id)) continue;
          try {
            const r = await this.content.install(inst, dep.project_id, { kind: 'mod', signal });
            for (const x of r.installed) {
              report.deps.push(x.title);
            }
            installedIds.add(dep.project_id);
          } catch (e) {
            report.warnings.push(e.message);
          }
        }
      }

      inst.pending = pending;
      inst.history = [...(inst.history || []), { type: 'upgrade', from: plan.from, to: plan.to, at: new Date().toISOString(), backupId }];
      await this.instances.save(inst);

      // Loader installieren (Fehler hier -> Rollback)
      const versionId = await this.loaders.install(inst.loader, inst.game, inst.loaderVersion, { progress, signal });
      if (prefetch && this.installer) {
        try {
          await this.installer.prepare(versionId, { progress, signal });
        } catch (e) {
          report.warnings.push(`Spieldateien werden beim ersten Start geladen (${e.message}).`);
        }
      }
    } catch (err) {
      if (backupId) {
        this.log('warn', `Upgrade fehlgeschlagen, rolle zurück: ${err.message}`);
        progress({ label: 'Fehler – stelle alten Zustand wieder her …', done: 0, total: 1 });
        try {
          await this.restore(inst, backupId);
        } catch (e2) {
          this.log('error', `Rollback fehlgeschlagen: ${e2.message}`);
        }
      } else if (mode === 'copy' && inst.id !== instIn.id) {
        await this.instances.remove(inst.id).catch(() => {});
      }
      throw err;
    }
    this._planCache.delete(`${instIn.id}:${plan.to}`);
    return report;
  }

  // ---------- Geparkte Mods ----------

  /** Prüft, welche geparkten Mods inzwischen verfügbar sind. */
  async checkPending(inst) {
    const out = [];
    for (const p of inst.pending || []) {
      if (!p.projectId && p.cfProjectId) {
        let f = null;
        try {
          f = await this.content.compatibleCurseForgeFile(inst, p.cfProjectId);
        } catch {}
        out.push({ ...p, available: Boolean(f && f.downloadUrl), version: f ? f.displayName : null, cfFileId: f ? f.id : null, needsKey: !(this.content.curseforge && this.content.curseforge.enabled()) });
        continue;
      }
      if (!p.projectId) {
        out.push({ ...p, available: false });
        continue;
      }
      let v = null;
      try {
        v = await this.content.compatibleVersion(inst, p.projectId, 'mod');
      } catch {}
      out.push({ ...p, available: Boolean(v), version: v ? v.version_number : null, versionId: v ? v.id : null });
    }
    return out;
  }

  async applyPending(inst, keys, { progress = () => {} } = {}) {
    const checked = await this.checkPending(inst);
    const done = [];
    for (const p of checked.filter((x) => x.available && (!keys || keys.includes(x.key)))) {
      progress({ label: `Aktiviere ${p.title} …`, done: done.length, total: checked.length });
      if (!p.projectId && p.cfFileId) {
        const f = await this.content.curseforge.file(p.cfProjectId, p.cfFileId);
        await this.content.placeCurseForgeFile(inst, f, 'mod', { replaceKey: p.key });
      } else await this.content.install(inst, p.projectId, { kind: 'mod' });
      done.push(p.key);
    }
    inst.pending = (inst.pending || []).filter((p) => !done.includes(p.key));
    await this.instances.save(inst);
    return done.length;
  }

  async dismissPending(inst, key) {
    inst.pending = (inst.pending || []).filter((p) => p.key !== key);
    await this.instances.save(inst);
  }
}

function statusOrder(s) {
  return { missing: 0, unknown: 1, update: 2, compatible: 3, keep: 4 }[s] ?? 5;
}

async function poolSimple(items, n, fn) {
  let i = 0;
  await Promise.all(
    new Array(Math.min(n, items.length)).fill(0).map(async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

module.exports = { Upgrader };
