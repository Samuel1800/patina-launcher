'use strict';
// Inhalte einer Instanz: Mods, Shader, Ressourcenpakete – Erkennen, Installieren (mit Abhängigkeiten),
// Aktualisieren, Aktivieren/Deaktivieren.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('./http');
const { readJson, writeJson, exists, ensureDir } = require('./fsutil');
const { readModMeta, readPackMeta } = require('./jarmeta');
const { pickVersion, primaryFile } = require('./modrinth');
const { META_DIR } = require('./instances');
const { fingerprintFile, pickFile } = require('./curseforge');

const KINDS = {
  mod: { dir: 'mods', exts: ['.jar', '.litemod'], folders: false },
  shader: { dir: 'shaderpacks', exts: ['.zip'], folders: true },
  resourcepack: { dir: 'resourcepacks', exts: ['.zip'], folders: true },
};

const DISABLED = '.disabled';

function modLoaders(loader) {
  switch (loader) {
    case 'fabric':
      return ['fabric'];
    case 'quilt':
      return ['quilt', 'fabric'];
    case 'forge':
      return ['forge'];
    case 'neoforge':
      return ['neoforge'];
    default:
      return [];
  }
}

function loaderFilter(inst, kind) {
  if (kind === 'mod') return modLoaders(inst.loader);
  if (kind === 'shader') return ['iris', 'optifine'];
  if (kind === 'resourcepack') return ['minecraft'];
  return [];
}

function baseName(file) {
  return file.endsWith(DISABLED) ? file.slice(0, -DISABLED.length) : file;
}

class NoCompatibleVersionError extends Error {
  constructor(title, inst) {
    super(`„${title}“ gibt es (noch) nicht für Minecraft ${inst.game}${inst.loader !== 'vanilla' ? ` mit ${inst.loader}` : ''}.`);
    this.code = 'NO_VERSION';
  }
}

class Content {
  constructor({ instances, modrinth, curseforge = null, log = () => {} }) {
    this.instances = instances;
    this.modrinth = modrinth;
    this.curseforge = curseforge;
    this.log = log;
    this._scanLocks = new Map();
  }

  cacheFile(inst) {
    return path.join(inst._dir, META_DIR, 'content.json');
  }
  iconDir(inst) {
    return path.join(inst._dir, META_DIR, 'icons');
  }

  async loadCache(inst) {
    return (await readJson(this.cacheFile(inst))) || { files: {} };
  }
  async saveCache(inst, cache) {
    await writeJson(this.cacheFile(inst), cache);
  }

  /** Einträge einer Art auflisten, unbekannte Dateien identifizieren. */
  async scan(inst, kinds = Object.keys(KINDS), { identify = true } = {}) {
    const lockKey = `${inst.id}`;
    while (this._scanLocks.has(lockKey)) await this._scanLocks.get(lockKey).catch(() => {});
    const job = this._scan(inst, kinds, { identify });
    this._scanLocks.set(lockKey, job);
    try {
      return await job;
    } finally {
      this._scanLocks.delete(lockKey);
    }
  }

  async _scan(inst, kinds, { identify }) {
    const cache = await this.loadCache(inst);
    const items = [];
    const seenKeys = new Set();
    for (const kind of kinds) {
      const spec = KINDS[kind];
      const dir = path.join(inst._dir, spec.dir);
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const enabled = !e.name.endsWith(DISABLED);
        const base = baseName(e.name);
        const isFolder = e.isDirectory();
        if (isFolder && !spec.folders) continue;
        if (!isFolder && !spec.exts.some((x) => base.toLowerCase().endsWith(x))) continue;
        const key = `${kind}/${base}`;
        seenKeys.add(key);
        const full = path.join(dir, e.name);
        let st;
        try {
          st = await fsp.stat(full);
        } catch {
          continue;
        }
        let c = cache.files[key];
        const changed = !c || c.size !== st.size || Math.abs((c.mtimeMs || 0) - st.mtimeMs) > 2000;
        if (changed && !isFolder) {
          const sha1 = await http.hashFile(full, 'sha1');
          if (!c || c.sha1 !== sha1) {
            c = { sha1 };
            if (kind === 'mod') {
              const m = readModMeta(full);
              if (m) {
                c.modId = m.id;
                c.modName = m.name;
                c.modVersion = m.version;
                c.modLoader = m.loader;
                if (m.iconData) c.localIcon = await this._saveIcon(inst, sha1, m.iconData);
              }
            } else {
              const m = readPackMeta(full);
              if (m) {
                c.description = m.description;
                if (m.iconData) c.localIcon = await this._saveIcon(inst, sha1, m.iconData);
              }
            }
          }
          c.size = st.size;
          c.mtimeMs = st.mtimeMs;
          cache.files[key] = c;
        } else if (!c) {
          c = { folder: true, size: 0, mtimeMs: st.mtimeMs };
          cache.files[key] = c;
        }
        items.push({ key, kind, file: e.name, base, enabled, folder: isFolder, ...c });
      }
    }
    // gelöschte Dateien aus dem Cache entfernen
    for (const k of Object.keys(cache.files)) {
      const kind = k.split('/')[0];
      if (kinds.includes(kind) && !seenKeys.has(k)) delete cache.files[k];
    }

    if (identify) {
      try {
        await this._identify(inst, cache, items);
      } catch (e) {
        this.log('warn', `Identifizierung fehlgeschlagen: ${e.message}`);
      }
    }
    await this.saveCache(inst, cache);
    return items
      .map((it) => this._present(inst, { ...it, ...cache.files[it.key] }))
      .sort((a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
  }

  async _saveIcon(inst, sha1, data) {
    const dir = this.iconDir(inst);
    await ensureDir(dir);
    await fsp.writeFile(path.join(dir, `${sha1}.png`), data);
    return true;
  }

  _present(inst, it) {
    const title = it.title || it.cfTitle || it.modName || it.base.replace(/\.(jar|zip|litemod)$/i, '');
    let icon = it.iconUrl || it.cfIconUrl || null;
    if (!icon && it.localIcon) icon = `bwicon://${inst.id}/${it.sha1}.png`;
    return {
      key: it.key,
      kind: it.kind,
      file: it.file,
      enabled: it.enabled,
      folder: Boolean(it.folder),
      title,
      version: it.versionNumber || it.cfVersion || it.modVersion || null,
      icon,
      projectId: it.projectId || null,
      versionId: it.versionId || null,
      slug: it.slug || null,
      cfProjectId: it.cfProjectId || null,
      cfFileId: it.cfFileId || null,
      cfUrl: it.cfUrl || null,
      source: it.projectId ? it.source || 'modrinth' : it.cfProjectId ? 'curseforge' : 'local',
      modId: it.modId || null,
      size: it.size || 0,
      description: it.description || null,
      author: it.author || null,
      sha1: it.sha1 || null,
    };
  }

  async _identify(inst, cache, items) {
    const now = Date.now();
    const unknown = items.filter((it) => {
      const c = cache.files[it.key];
      return c && c.sha1 && !c.projectId && (!c.checkedAt || now - c.checkedAt > 12 * 3600e3);
    });
    if (!unknown.length) return;
    const byHash = await this.modrinth.identify(unknown.map((it) => cache.files[it.key].sha1));
    const projectIds = new Set();
    for (const it of unknown) {
      const c = cache.files[it.key];
      c.checkedAt = now;
      const v = byHash[c.sha1];
      if (v) {
        c.projectId = v.project_id;
        c.versionId = v.id;
        c.versionNumber = v.version_number;
        c.source = 'modrinth';
        projectIds.add(v.project_id);
      }
    }
    // Mods ohne Hash-Treffer: über Mod-ID als Slug versuchen
    const loaders = modLoaders(inst.loader);
    for (const it of unknown) {
      const c = cache.files[it.key];
      if (c.projectId || it.kind !== 'mod' || !c.modId) continue;
      const slug = String(c.modId).replace(/_/g, '-');
      for (const s of [...new Set([c.modId, slug])]) {
        try {
          const p = await this.modrinth.project(s);
          if (p && p.project_type === 'mod' && (!loaders.length || (p.loaders || []).some((l) => loaders.includes(l)))) {
            c.projectId = p.id;
            c.source = 'modrinth-modid';
            c.title = p.title;
            c.iconUrl = p.icon_url;
            c.slug = p.slug;
            break;
          }
        } catch {}
      }
    }
    // CurseForge (nur mit API-Schlüssel): per Fingerprint
    if (this.curseforge && this.curseforge.enabled()) {
      try {
        await this._identifyCurseForge(inst, cache, unknown.filter((it) => !cache.files[it.key].projectId && !cache.files[it.key].cfProjectId));
      } catch (e) {
        this.log('warn', `CurseForge-Erkennung: ${e.message}`);
      }
    }
    const missingMeta = [...projectIds].filter((id) => !Object.values(cache.files).some((c) => c.projectId === id && c.title));
    if (missingMeta.length) {
      const projects = await this.modrinth.projects(missingMeta);
      const map = new Map(projects.map((p) => [p.id, p]));
      for (const c of Object.values(cache.files)) {
        const p = map.get(c.projectId);
        if (p) {
          c.title = p.title;
          c.iconUrl = p.icon_url;
          c.slug = p.slug;
        }
      }
    }
    for (const c of Object.values(cache.files)) {
      if (c.projectId && !c.title) {
        const twin = Object.values(cache.files).find((x) => x.projectId === c.projectId && x.title);
        if (twin) {
          c.title = twin.title;
          c.iconUrl = twin.iconUrl;
          c.slug = twin.slug;
        }
      }
    }
  }

  async _identifyCurseForge(inst, cache, items) {
    if (!items.length) return;
    const fps = {};
    for (const it of items) {
      const c = cache.files[it.key];
      if (!c.cfFingerprint) c.cfFingerprint = await fingerprintFile(path.join(inst._dir, KINDS[it.kind].dir, it.file));
      fps[c.cfFingerprint] = it.key;
    }
    const matches = await this.curseforge.matchFingerprints(Object.keys(fps).map(Number));
    const ids = new Set();
    for (const [fp, m] of Object.entries(matches)) {
      const c = cache.files[fps[fp]];
      if (!c) continue;
      c.cfProjectId = m.modId;
      c.cfFileId = m.file.id;
      c.cfVersion = m.file.displayName;
      ids.add(m.modId);
    }
    if (ids.size) {
      const mods = await this.curseforge.mods([...ids]);
      const map = new Map(mods.map((x) => [x.id, x]));
      for (const c of Object.values(cache.files)) {
        const x = map.get(c.cfProjectId);
        if (x) {
          c.cfTitle = x.name;
          c.cfIconUrl = x.logo && x.logo.thumbnailUrl;
          c.cfUrl = x.links && x.links.websiteUrl;
        }
      }
    }
  }

  /** Übernimmt CurseForge-Zuordnungen aus einer minecraftinstance.json (Import, ohne API-Schlüssel). */
  async applyCurseForgeManifest(inst, manifest) {
    const cache = await this.loadCache(inst);
    const dirToKind = { mods: 'mod', shaderpacks: 'shader', resourcepacks: 'resourcepack' };
    let n = 0;
    for (const a of manifest.installedAddons || []) {
      const f = a.installedFile;
      if (!f || !f.fileNameOnDisk) continue;
      const kind = dirToKind[(a.categorySection && a.categorySection.path) || 'mods'] || 'mod';
      const key = `${kind}/${baseName(f.fileNameOnDisk)}`;
      const c = cache.files[key];
      if (!c) continue;
      c.cfProjectId = a.addonID;
      c.cfFileId = f.id;
      c.cfVersion = f.displayName || null;
      c.cfTitle = a.name;
      c.cfIconUrl = a.thumbnailUrl || null;
      c.cfUrl = a.webSiteURL || null;
      n++;
    }
    await this.saveCache(inst, cache);
    return n;
  }

  /** Lädt eine CurseForge-Datei und ersetzt die alte. */
  async placeCurseForgeFile(inst, file, kind, { cache, replaceKey, signal } = {}) {
    if (!file.downloadUrl) {
      const e = new Error('Der Autor erlaubt keine Downloads über andere Launcher – bitte manuell von CurseForge laden.');
      e.code = 'CF_NO_DOWNLOAD';
      throw e;
    }
    const own = !cache;
    cache = cache || (await this.loadCache(inst));
    const spec = KINDS[kind] || KINDS.mod;
    const dir = path.join(inst._dir, spec.dir);
    const safe = path.basename(file.fileName);
    const sha1 = ((file.hashes || []).find((h) => h.algo === 1) || {}).value;
    await http.download(file.downloadUrl, path.join(dir, safe), { sha1, size: file.fileLength, signal });
    const old = replaceKey ? cache.files[replaceKey] : null;
    if (replaceKey && replaceKey !== `${kind}/${safe}`) {
      const base = replaceKey.slice(kind.length + 1);
      for (const n of [base, base + DISABLED]) await fsp.rm(path.join(dir, n), { force: true }).catch(() => {});
      delete cache.files[replaceKey];
    }
    await fsp.rm(path.join(dir, safe + DISABLED), { force: true }).catch(() => {});
    const st = await fsp.stat(path.join(dir, safe));
    cache.files[`${kind}/${safe}`] = {
      sha1: sha1 || (await http.hashFile(path.join(dir, safe))),
      size: st.size,
      mtimeMs: st.mtimeMs,
      cfProjectId: file.modId,
      cfFileId: file.id,
      cfVersion: file.displayName,
      cfTitle: old ? old.cfTitle : undefined,
      cfIconUrl: old ? old.cfIconUrl : undefined,
      cfUrl: old ? old.cfUrl : undefined,
      cfFingerprint: file.fileFingerprint,
      checkedAt: Date.now(),
    };
    if (own) await this.saveCache(inst, cache);
    return safe;
  }

  /** Passende CurseForge-Datei (oder null). */
  async compatibleCurseForgeFile(inst, cfProjectId, { game } = {}) {
    if (!this.curseforge || !this.curseforge.enabled()) return null;
    return this.curseforge.compatibleFile(cfProjectId, { gameVersion: game || inst.game, loader: inst.loader });
  }

  async installedProjectIds(inst, kind = 'mod') {
    const cache = await this.loadCache(inst);
    const ids = new Set();
    for (const [k, c] of Object.entries(cache.files)) if (k.startsWith(`${kind}/`) && c.projectId) ids.add(c.projectId);
    return ids;
  }

  /** Passende Version eines Projekts für die Instanz. */
  async compatibleVersion(inst, projectId, kind, { game } = {}) {
    const gv = game || inst.game;
    const loaders = loaderFilter(inst, kind);
    if (kind === 'shader') {
      return pickVersion(await this.modrinth.versions(projectId, { loaders }));
    }
    const list = await this.modrinth.versions(projectId, { loaders, gameVersions: [gv] });
    const v = pickVersion(list);
    if (v || kind !== 'resourcepack') return v;
    // Ressourcenpakete funktionieren meist auch versionsübergreifend
    return pickVersion(await this.modrinth.versions(projectId, { loaders }));
  }

  /**
   * Installiert ein Projekt inkl. benötigter Abhängigkeiten.
   * @returns {{installed: Array<{title, version}>, skipped: string[], warnings: string[]}}
   */
  async install(inst, projectId, { kind = 'mod', versionId = null, progress = () => {}, signal } = {}) {
    if (kind === 'mod' && inst.loader === 'vanilla') {
      const e = new Error('Vanilla-Instanzen können keine Mods laden. Stell die Instanz zuerst auf Fabric um.');
      e.code = 'NEEDS_LOADER';
      throw e;
    }
    const result = { installed: [], skipped: [], warnings: [] };
    const installed = await this.installedProjectIds(inst, kind);
    const visiting = new Set();
    const cache = await this.loadCache(inst);

    const rec = async (pid, vid, depth) => {
      if (visiting.has(pid)) return;
      visiting.add(pid);
      let version = null;
      if (vid) version = await this.modrinth.version(vid);
      else version = await this.compatibleVersion(inst, pid, kind);
      if (!version) {
        let title = pid;
        try {
          title = (await this.modrinth.project(pid)).title;
        } catch {}
        if (depth === 0) throw new NoCompatibleVersionError(title, inst);
        result.warnings.push(`Abhängigkeit „${title}“ ist für ${inst.game} nicht verfügbar.`);
        return;
      }
      if (version.project_id && version.project_id !== pid) {
        // Slug -> echte Projekt-ID
        if (visiting.has(version.project_id) && depth > 0) return;
        visiting.add(version.project_id);
        pid = version.project_id;
      }
      if (depth > 0 && installed.has(pid)) {
        result.skipped.push(pid);
        return;
      }
      await this.placeVersion(inst, version, kind, { cache, progress, signal });
      installed.add(pid);
      const proj = await this.modrinth.project(pid).catch(() => null);
      result.installed.push({ title: proj ? proj.title : version.name, version: version.version_number, dependency: depth > 0 });
      if (kind !== 'mod' && kind !== 'modpack') return;
      for (const dep of version.dependencies || []) {
        if (dep.dependency_type === 'incompatible' && dep.project_id && installed.has(dep.project_id)) {
          const p = await this.modrinth.project(dep.project_id).catch(() => null);
          result.warnings.push(`${proj ? proj.title : 'Mod'} ist laut Autor nicht kompatibel mit ${p ? p.title : dep.project_id}.`);
        }
        if (dep.dependency_type !== 'required') continue;
        let depPid = dep.project_id;
        if (!depPid && dep.version_id) {
          try {
            depPid = (await this.modrinth.version(dep.version_id)).project_id;
          } catch {}
        }
        if (!depPid || installed.has(depPid)) continue;
        try {
          await rec(depPid, null, depth + 1);
        } catch (e) {
          if (dep.version_id) await rec(depPid, dep.version_id, depth + 1).catch(() => result.warnings.push(e.message));
          else result.warnings.push(e.message);
        }
      }
    };
    await rec(projectId, versionId, 0);
    await this.saveCache(inst, cache);
    return result;
  }

  /** Lädt eine bestimmte Modrinth-Version herunter und ersetzt alte Dateien desselben Projekts. */
  async placeVersion(inst, version, kind, { cache, progress = () => {}, signal, targetDir } = {}) {
    const own = !cache;
    cache = cache || (await this.loadCache(inst));
    const file = primaryFile(version);
    if (!file) throw new Error(`Version ${version.version_number} hat keine Datei.`);
    const spec = KINDS[kind] || KINDS.mod;
    const dir = targetDir || path.join(inst._dir, spec.dir);
    await ensureDir(dir);
    const safe = path.basename(file.filename);
    const dest = path.join(dir, safe);
    await http.download(file.url, dest, {
      sha1: file.hashes && file.hashes.sha1,
      size: file.size,
      signal,
      onProgress: (d, t) => progress({ label: `Lade ${safe}`, done: d, total: t }),
    });
    // alte Dateien desselben Projekts entfernen
    for (const [k, c] of Object.entries(cache.files)) {
      if (!k.startsWith(`${kind}/`) || c.projectId !== version.project_id) continue;
      const base = k.slice(kind.length + 1);
      if (base === safe) continue;
      for (const n of [base, base + DISABLED]) await fsp.rm(path.join(dir, n), { force: true, recursive: true }).catch(() => {});
      delete cache.files[k];
    }
    // Falls die neue Datei deaktiviert daneben liegt: entfernen
    await fsp.rm(dest + DISABLED, { force: true }).catch(() => {});
    const st = await fsp.stat(dest);
    const proj = await this.modrinth.project(version.project_id).catch(() => null);
    cache.files[`${kind}/${safe}`] = {
      ...(cache.files[`${kind}/${safe}`] || {}),
      sha1: file.hashes && file.hashes.sha1 ? file.hashes.sha1 : await http.hashFile(dest),
      size: st.size,
      mtimeMs: st.mtimeMs,
      projectId: version.project_id,
      versionId: version.id,
      versionNumber: version.version_number,
      source: 'modrinth',
      title: proj ? proj.title : undefined,
      iconUrl: proj ? proj.icon_url : undefined,
      slug: proj ? proj.slug : undefined,
      checkedAt: Date.now(),
    };
    if (own) await this.saveCache(inst, cache);
    return safe;
  }

  async setEnabled(inst, key, enabled) {
    const [kind, ...rest] = key.split('/');
    const base = rest.join('/');
    const dir = path.join(inst._dir, KINDS[kind].dir);
    const on = path.join(dir, base);
    const off = on + DISABLED;
    if (enabled && (await exists(off))) await fsp.rename(off, on);
    if (!enabled && (await exists(on))) await fsp.rename(on, off);
  }

  async remove(inst, key) {
    const [kind, ...rest] = key.split('/');
    const base = rest.join('/');
    const dir = path.join(inst._dir, KINDS[kind].dir);
    for (const n of [base, base + DISABLED]) await fsp.rm(path.join(dir, n), { force: true, recursive: true });
    const cache = await this.loadCache(inst);
    delete cache.files[key];
    await this.saveCache(inst, cache);
  }

  /** Lokale Datei (z. B. per Drag & Drop) hinzufügen. */
  async addLocalFile(inst, srcPath, kind) {
    const spec = KINDS[kind];
    const dir = path.join(inst._dir, spec.dir);
    await ensureDir(dir);
    const dest = path.join(dir, path.basename(srcPath));
    await fsp.copyFile(srcPath, dest);
    return path.basename(dest);
  }

  /**
   * Prüft auf Updates für die aktuelle Spielversion.
   * @returns {Array<{key, title, from, to, versionId}>}
   */
  async checkUpdates(inst, kinds = ['mod', 'shader', 'resourcepack']) {
    const items = (await this.scan(inst, kinds)).filter((i) => i.projectId || i.cfProjectId);
    const out = [];
    for (const kind of kinds) {
      const group = items.filter((i) => i.kind === kind);
      if (!group.length) continue;
      const loaders = loaderFilter(inst, kind);
      const gameVersions = kind === 'mod' ? [inst.game] : undefined;
      const hashed = group.filter((i) => i.sha1 && i.source === 'modrinth');
      let latest = {};
      try {
        latest = await this.modrinth.latestForHashes(hashed.map((i) => i.sha1), { loaders, gameVersions });
      } catch (e) {
        this.log('warn', `Update-Prüfung fehlgeschlagen: ${e.message}`);
      }
      if (this.curseforge && this.curseforge.enabled()) {
        for (const it of group.filter((i) => !i.projectId && i.cfProjectId)) {
          try {
            const f = await this.compatibleCurseForgeFile(inst, it.cfProjectId);
            if (f && f.id !== it.cfFileId && f.downloadUrl) out.push({ key: it.key, kind, title: it.title, icon: it.icon, from: it.version, to: f.displayName, cfFileId: f.id, cfProjectId: it.cfProjectId });
          } catch {}
        }
      }
      for (const it of hashed) {
        let v = latest[it.sha1];
        if (v && v.version_type !== 'release') {
          // Release bevorzugen, falls vorhanden
          const better = await this.compatibleVersion(inst, it.projectId, kind).catch(() => null);
          if (better) v = better;
        }
        if (v && v.id !== it.versionId && v.project_id === it.projectId) {
          out.push({ key: it.key, kind, title: it.title, icon: it.icon, from: it.version, to: v.version_number, versionId: v.id, projectId: it.projectId });
        }
      }
    }
    return out;
  }

  async applyUpdates(inst, updates, { progress = () => {}, signal } = {}) {
    const cache = await this.loadCache(inst);
    let n = 0;
    for (const u of updates) {
      progress({ label: `Aktualisiere ${u.title} (${++n}/${updates.length})`, done: n - 1, total: updates.length });
      const wasDisabled = (await this.scan(inst, [u.kind], { identify: false })).find((i) => i.key === u.key && !i.enabled);
      let name;
      if (u.cfFileId) {
        const f = await this.curseforge.file(u.cfProjectId, u.cfFileId);
        name = await this.placeCurseForgeFile(inst, f, u.kind, { cache, replaceKey: u.key, signal });
      } else {
        const v = await this.modrinth.version(u.versionId);
        name = await this.placeVersion(inst, v, u.kind, { cache, signal });
      }
      if (wasDisabled) await this.setEnabled(inst, `${u.kind}/${name}`, false);
    }
    await this.saveCache(inst, cache);
    return n;
  }
}

// ---------- options.txt (Ressourcenpakete aktivieren) ----------

async function readOptions(inst) {
  const file = path.join(inst._dir, 'options.txt');
  try {
    const txt = await fsp.readFile(file, 'utf8');
    const map = new Map();
    for (const line of txt.split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) map.set(line.slice(0, i), line.slice(i + 1));
    }
    return map;
  } catch {
    return new Map();
  }
}

async function writeOptions(inst, map) {
  const file = path.join(inst._dir, 'options.txt');
  const lines = [...map.entries()].map(([k, v]) => `${k}:${v}`);
  await fsp.writeFile(file, lines.join('\n') + '\n', 'utf8');
}

async function activeResourcePacks(inst) {
  const opts = await readOptions(inst);
  try {
    return JSON.parse(opts.get('resourcePacks') || '[]');
  } catch {
    return [];
  }
}

async function setResourcePackActive(inst, fileName, active) {
  const opts = await readOptions(inst);
  let list = [];
  try {
    list = JSON.parse(opts.get('resourcePacks') || '["vanilla"]');
  } catch {
    list = ['vanilla'];
  }
  if (!list.includes('vanilla')) list.unshift('vanilla');
  const id = `file/${fileName}`;
  list = list.filter((x) => x !== id);
  if (active) list.push(id); // zuletzt = höchste Priorität
  opts.set('resourcePacks', JSON.stringify(list));
  let inc = [];
  try {
    inc = JSON.parse(opts.get('incompatibleResourcePacks') || '[]');
  } catch {}
  if (active && !inc.includes(id)) {
    // Kompatibilitätswarnung beim Laden vermeiden
    inc.push(id);
    opts.set('incompatibleResourcePacks', JSON.stringify(inc));
  }
  await writeOptions(inst, opts);
}

module.exports = {
  Content,
  KINDS,
  modLoaders,
  loaderFilter,
  NoCompatibleVersionError,
  readOptions,
  writeOptions,
  activeResourcePacks,
  setResourcePackActive,
  DISABLED,
};
