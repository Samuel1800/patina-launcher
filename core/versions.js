'use strict';
// Minecraft-Versionen: Manifest (immer aktuell von Mojang), Version-JSONs, inheritsFrom-Auflösung.
const fsp = require('fs').promises;
const path = require('path');
const http = require('./http');
const { readJson, writeJson, exists } = require('./fsutil');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MANIFEST_TTL = 10 * 60 * 1000;

class Versions {
  constructor(paths, log = () => {}) {
    this.paths = paths;
    this.log = log;
    this._manifest = null;
    this._fetchedAt = 0;
    this._inflight = null;
  }

  get manifestFile() {
    return path.join(this.paths.cache, 'version_manifest_v2.json');
  }

  /** Holt das Versionsmanifest; nutzt Cache, wenn offline. */
  async manifest({ force = false } = {}) {
    if (!force && this._manifest && Date.now() - this._fetchedAt < MANIFEST_TTL) return this._manifest;
    if (this._inflight) return this._inflight;
    this._inflight = (async () => {
      try {
        const m = await http.getJson(MANIFEST_URL, { timeout: 15000, retries: 2 });
        this._manifest = m;
        this._fetchedAt = Date.now();
        await writeJson(this.manifestFile, m).catch(() => {});
        return m;
      } catch (e) {
        this.log('warn', `Versionsmanifest nicht erreichbar, nutze Cache: ${e.message}`);
        const cached = await readJson(this.manifestFile);
        if (cached) {
          this._manifest = cached;
          this._fetchedAt = Date.now() - MANIFEST_TTL + 60000; // in 1 min erneut versuchen
          return cached;
        }
        throw new Error('Keine Internetverbindung und keine zwischengespeicherte Versionsliste.');
      } finally {
        this._inflight = null;
      }
    })();
    return this._inflight;
  }

  async list({ force } = {}) {
    const m = await this.manifest({ force });
    return m.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
  }

  async latest({ force } = {}) {
    const m = await this.manifest({ force });
    return m.latest;
  }

  async entry(id) {
    const m = await this.manifest();
    return m.versions.find((v) => v.id === id) || null;
  }

  /** Ordnet Versionen chronologisch (für "neuer als"). */
  async releaseIndex(id) {
    const m = await this.manifest();
    return m.versions.findIndex((v) => v.id === id);
  }

  /** Lädt (falls nötig) die Version-JSON einer einzelnen Version. */
  async loadJson(id) {
    const file = this.paths.versionJson(id);
    let local = await readJson(file);
    let entry = null;
    try {
      entry = await this.entry(id);
    } catch {
      entry = null;
    }
    if (entry) {
      // Vanilla-Version: lokale Datei nur nehmen, wenn Hash passt
      if (local && (await http.isValidFile(file, { sha1: entry.sha1 }))) return local;
      await http.download(entry.url, file, { sha1: entry.sha1, skipIfValid: false });
      return readJson(file);
    }
    if (local) return local;
    throw new Error(`Version ${id} ist unbekannt und nicht installiert.`);
  }

  /** Löst inheritsFrom-Ketten auf und gibt die zusammengeführte JSON zurück. */
  async resolve(id, depth = 0) {
    if (depth > 6) throw new Error('inheritsFrom-Kette zu tief');
    const json = await this.loadJson(id);
    if (!json.inheritsFrom) {
      return { ...json, _chain: [json.id], _jarId: json.jar || json.id, _rootId: json.id };
    }
    const parent = await this.resolve(json.inheritsFrom, depth + 1);
    return mergeVersion(parent, json);
  }

  async isLocal(id) {
    return exists(this.paths.versionJson(id));
  }
}

function mergeVersion(parent, child) {
  const out = { ...parent, ...child };
  out.libraries = [...(child.libraries || []), ...(parent.libraries || [])];
  const pa = parent.arguments || {};
  const ca = child.arguments || {};
  if (parent.arguments || child.arguments) {
    out.arguments = {
      game: [...(pa.game || []), ...(ca.game || [])],
      jvm: [...(pa.jvm || []), ...(ca.jvm || [])],
    };
    const dj = ca['default-user-jvm'] || pa['default-user-jvm'];
    if (dj) out.arguments['default-user-jvm'] = dj;
  }
  if (child.minecraftArguments) out.minecraftArguments = child.minecraftArguments;
  else if (parent.minecraftArguments) out.minecraftArguments = parent.minecraftArguments;
  out.assetIndex = child.assetIndex || parent.assetIndex;
  out.assets = child.assets || parent.assets;
  out.downloads = child.downloads || parent.downloads;
  out.javaVersion = child.javaVersion || parent.javaVersion;
  out.logging = child.logging && Object.keys(child.logging).length ? child.logging : parent.logging;
  out.mainClass = child.mainClass || parent.mainClass;
  out.type = parent.type || child.type;
  out._chain = [child.id, ...parent._chain];
  out._jarId = child.jar || parent._jarId;
  out._rootId = parent._rootId;
  return out;
}

module.exports = { Versions, mergeVersion, MANIFEST_URL };
