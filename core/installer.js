'use strict';
// Stellt sicher, dass eine (aufgelöste) Version vollständig installiert ist:
// Client-JAR, Libraries, Natives, Assets, Log-Konfiguration.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const AdmZip = require('adm-zip');
const http = require('./http');
const { readJson, writeJson, exists, isInside } = require('./fsutil');
const { mavenPath, mavenKey } = require('./maven');
const { rulesAllow, currentEnv, osName } = require('./rules');

const LIB_BASE = 'https://libraries.minecraft.net/';
const RESOURCES = 'https://resources.download.minecraft.net/';

function archBits() {
  return process.arch === 'ia32' ? '32' : '64';
}

/** Filtert Native-Varianten für andere CPU-Architekturen heraus. */
function wrongArchClassifier(name) {
  const cls = name.split('@')[0].split(':')[3];
  if (!cls || !cls.startsWith('natives-')) return false;
  const isArm = /-(arm64|aarch_64|aarch64)$/.test(cls);
  const isX86 = /-x86$/.test(cls);
  if (process.arch === 'arm64') return isX86;
  if (isArm) return true;
  if (isX86 && process.arch === 'x64') return true;
  return false;
}

/**
 * Liefert für eine Library alle benötigten Dateien.
 * @returns {Array<{key, path, urls, sha1, size, classpath:boolean, native:boolean, extract?}>}
 */
function libraryFiles(lib, env, paths) {
  if (!rulesAllow(lib.rules, env)) return [];
  if (lib.clientreq === false) return [];
  if (lib.name && wrongArchClassifier(lib.name)) return [];
  const out = [];
  const os = env.os;
  const nativeCls = lib.natives && lib.natives[os] ? lib.natives[os].replace('${arch}', archBits()) : null;

  const dl = lib.downloads;
  if (dl && dl.artifact && !(nativeCls && !dl.artifact.url && !dl.artifact.path)) {
    const a = dl.artifact;
    const rel = a.path || (lib.name ? mavenPath(lib.name) : null);
    if (rel) {
      out.push({
        key: lib.name ? mavenKey(lib.name) : rel,
        path: paths.library(rel),
        urls: a.url ? [a.url] : [],
        sha1: a.sha1,
        size: a.size,
        classpath: true,
        native: false,
      });
    }
  } else if (!dl && lib.name && !nativeCls) {
    // Maven-Stil (Fabric/Quilt/altes Forge)
    const rel = mavenPath(lib.name);
    const base = lib.url ? (lib.url.endsWith('/') ? lib.url : `${lib.url}/`) : LIB_BASE;
    const urls = [base + rel];
    if (base !== LIB_BASE) urls.push(LIB_BASE + rel);
    out.push({
      key: mavenKey(lib.name),
      path: paths.library(rel),
      urls,
      sha1: lib.sha1 || (Array.isArray(lib.checksums) && lib.checksums.length === 1 ? lib.checksums[0] : undefined),
      size: lib.size,
      classpath: true,
      native: false,
    });
  }

  if (nativeCls) {
    let rel;
    let url;
    let sha1;
    let size;
    if (dl && dl.classifiers && dl.classifiers[nativeCls]) {
      const c = dl.classifiers[nativeCls];
      rel = c.path;
      url = c.url;
      sha1 = c.sha1;
      size = c.size;
    } else if (lib.name) {
      rel = mavenPath(`${lib.name}:${nativeCls}`);
      const base = lib.url ? (lib.url.endsWith('/') ? lib.url : `${lib.url}/`) : LIB_BASE;
      url = base + rel;
    }
    if (rel) {
      out.push({
        key: `${lib.name ? mavenKey(lib.name) : rel}#${nativeCls}`,
        path: paths.library(rel),
        urls: url ? [url] : [],
        sha1,
        size,
        classpath: false,
        native: true,
        extract: lib.extract,
      });
    }
  }
  return out;
}

class Installer {
  constructor({ paths, versions, log = () => {} }) {
    this.paths = paths;
    this.versions = versions;
    this.log = log;
  }

  /**
   * Installiert alles, was die Version braucht, und gibt den Launch-Plan zurück.
   * progress({label, done, total})
   */
  async prepare(versionId, { progress = () => {}, features = {}, signal } = {}) {
    const env = currentEnv(features);
    progress({ label: 'Lese Versionsdaten …', done: 0, total: 1 });
    const v = await this.versions.resolve(versionId);

    // --- Libraries sammeln
    const seen = new Set();
    const files = [];
    for (const lib of v.libraries || []) {
      for (const f of libraryFiles(lib, env, this.paths)) {
        if (seen.has(f.key)) continue;
        seen.add(f.key);
        files.push(f);
      }
    }

    // --- Client-JAR
    const jarId = v._jarId;
    const jarPath = this.paths.versionJar(jarId);
    const clientDl = v.downloads && v.downloads.client;
    const jobs = [];
    if (clientDl) jobs.push({ urls: [clientDl.url], path: jarPath, sha1: clientDl.sha1, size: clientDl.size, label: 'Minecraft' });
    else if (!(await exists(jarPath))) throw new Error(`Client-JAR für ${jarId} fehlt.`);

    for (const f of files) {
      if (!f.urls.length) {
        if (!(await exists(f.path))) {
          throw new Error(`Datei fehlt und hat keine Download-Quelle: ${path.basename(f.path)} – Modloader bitte neu installieren.`);
        }
        continue;
      }
      jobs.push({ urls: f.urls, path: f.path, sha1: f.sha1, size: f.size, label: path.basename(f.path) });
    }

    // --- Log-Konfiguration
    let logArg = null;
    const lc = v.logging && v.logging.client;
    if (lc && lc.file && lc.argument) {
      const lp = this.paths.logConfig(lc.file.id);
      jobs.push({ urls: [lc.file.url], path: lp, sha1: lc.file.sha1, size: lc.file.size, label: 'log config' });
      logArg = lc.argument.replace('${path}', lp);
    }

    // --- Asset-Index
    let assetObjects = [];
    let assetIndexJson = null;
    if (v.assetIndex) {
      const idxPath = this.paths.assetIndex(v.assetIndex.id);
      await http.download(v.assetIndex.url, idxPath, { sha1: v.assetIndex.sha1, signal });
      assetIndexJson = await readJson(idxPath);
      const seenHash = new Set();
      for (const [name, o] of Object.entries(assetIndexJson.objects || {})) {
        if (seenHash.has(o.hash)) continue;
        seenHash.add(o.hash);
        assetObjects.push({ name, hash: o.hash, size: o.size });
      }
    }

    // --- Was fehlt? (schneller Größen-Check, Hash nur bei Libraries)
    const missing = [];
    for (const j of jobs) {
      if (!(await http.isValidFile(j.path, { sha1: j.sha1, size: j.size }))) missing.push(j);
    }
    const missingAssets = [];
    for (const o of assetObjects) {
      const p = this.paths.assetObject(o.hash);
      try {
        const st = await fsp.stat(p);
        if (st.size === o.size) continue;
      } catch {}
      missingAssets.push({ urls: [`${RESOURCES}${o.hash.slice(0, 2)}/${o.hash}`], path: p, sha1: o.hash, size: o.size });
    }

    const all = [...missing, ...missingAssets];
    const totalBytes = all.reduce((s, j) => s + (j.size || 0), 0) || all.length;
    let doneBytes = 0;
    let doneCount = 0;
    if (all.length) {
      this.log('info', `Lade ${all.length} Dateien für ${versionId} herunter`);
      await http.pool(all, 16, async (j) => {
        let last = 0;
        await http.download(j.urls, j.path, {
          sha1: j.sha1,
          size: j.size,
          signal,
          skipIfValid: false,
          onProgress: (rcv) => {
            if (j.size) {
              doneBytes += rcv - last;
              last = rcv;
            }
          },
        });
        if (!j.size) doneBytes += 1;
        doneCount++;
        progress({ label: `Lade Spieldateien … (${doneCount}/${all.length})`, done: doneBytes, total: totalBytes });
      });
    }

    // --- Launch-JAR: Kopie unter versions/<id>/<id>.jar (wie der offizielle Launcher)
    let launchJar = jarPath;
    if (v.id !== jarId) {
      launchJar = this.paths.versionJar(v.id);
      const src = await fsp.stat(jarPath);
      let need = true;
      try {
        const dst = await fsp.stat(launchJar);
        need = dst.size !== src.size;
      } catch {}
      if (need) {
        await fsp.mkdir(path.dirname(launchJar), { recursive: true });
        await fsp.copyFile(jarPath, launchJar);
      }
    }

    // --- Natives entpacken (alte Versionen)
    const nativesDir = path.join(this.paths.natives, v.id);
    const nativeFiles = files.filter((f) => f.native);
    await this.extractNatives(nativeFiles, nativesDir);

    // --- Legacy-Assets (virtual / map_to_resources)
    let virtualDir = null;
    if (assetIndexJson && (assetIndexJson.virtual || assetIndexJson.map_to_resources)) {
      virtualDir = path.join(this.paths.assets, 'virtual', v.assetIndex.id);
      await this.copyLegacyAssets(assetIndexJson, virtualDir);
    }

    const classpath = files.filter((f) => f.classpath).map((f) => f.path);
    classpath.push(launchJar);

    progress({ label: 'Bereit', done: 1, total: 1 });
    return {
      version: v,
      classpath,
      nativesDir,
      logArg,
      assetsRoot: this.paths.assets,
      assetIndexId: v.assetIndex ? v.assetIndex.id : v.assets,
      virtualDir,
      mapToResources: Boolean(assetIndexJson && assetIndexJson.map_to_resources),
      javaMajor: (v.javaVersion && v.javaVersion.majorVersion) || 8,
    };
  }

  async extractNatives(nativeFiles, dir) {
    await fsp.mkdir(dir, { recursive: true });
    if (!nativeFiles.length) return;
    const marker = path.join(dir, '.extracted.json');
    const want = nativeFiles.map((f) => path.basename(f.path)).sort();
    const have = await readJson(marker, []);
    if (JSON.stringify(have) === JSON.stringify(want)) return;
    for (const f of nativeFiles) {
      const zip = new AdmZip(f.path);
      const exclude = (f.extract && f.extract.exclude) || ['META-INF/'];
      for (const e of zip.getEntries()) {
        if (e.isDirectory) continue;
        if (exclude.some((x) => e.entryName.startsWith(x))) continue;
        const target = path.resolve(dir, e.entryName);
        if (!isInside(dir, target)) continue;
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, e.getData());
      }
    }
    await writeJson(marker, want);
  }

  async copyLegacyAssets(index, dir) {
    for (const [name, o] of Object.entries(index.objects || {})) {
      const target = path.join(dir, ...name.split('/'));
      if (await exists(target)) continue;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(this.paths.assetObject(o.hash), target).catch(() => {});
    }
  }
}

module.exports = { Installer, libraryFiles };
