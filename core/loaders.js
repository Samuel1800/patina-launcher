'use strict';
// Modloader: Fabric, Quilt, Forge, NeoForge – Versionslisten und Installation.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const http = require('./http');
const { readJson, writeJson, exists } = require('./fsutil');
const { mavenPath } = require('./maven');

const LOADERS = {
  vanilla: { id: 'vanilla', name: 'Vanilla' },
  fabric: { id: 'fabric', name: 'Fabric' },
  quilt: { id: 'quilt', name: 'Quilt' },
  forge: { id: 'forge', name: 'Forge' },
  neoforge: { id: 'neoforge', name: 'NeoForge' },
};

const FABRIC = 'https://meta.fabricmc.net/v2';
const QUILT = 'https://meta.quiltmc.org/v3';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const NEO_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

/** NeoForge-Version -> Minecraft-Version ("21.1.77" -> "1.21.1", "26.1.0.19-beta" -> "26.1") */
function neoToMc(v) {
  const core = v.split('-')[0];
  const p = core.split('.').map(Number);
  if (p.some(Number.isNaN)) return null;
  if (p[0] >= 26) {
    // Jahres-Versionen: 26.1.0.x -> 26.1 ; 26.1.2.x -> 26.1.2
    return p[2] ? `${p[0]}.${p[1]}.${p[2]}` : `${p[0]}.${p[1]}`;
  }
  if (p[0] < 20) return null;
  return p[1] ? `1.${p[0]}.${p[1]}` : `1.${p[0]}`;
}

function cmpLoose(a, b) {
  const pa = a.split(/[.\-+]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = b.split(/[.\-+]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y;
    } else if (String(x) !== String(y)) return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

class Loaders {
  constructor({ paths, java, versions, log = () => {} }) {
    this.paths = paths;
    this.java = java;
    this.versions = versions;
    this.log = log;
    this.cache = new Map();
    this._installLock = Promise.resolve();
  }

  async cached(key, ttl, fn) {
    const c = this.cache.get(key);
    if (c && Date.now() - c.t < ttl) return c.v;
    const file = path.join(this.paths.cache, 'loaders', `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);
    try {
      const v = await fn();
      this.cache.set(key, { t: Date.now(), v });
      await writeJson(file, v).catch(() => {});
      return v;
    } catch (e) {
      const old = await readJson(file);
      if (old) {
        this.log('warn', `${key}: offline, nutze Cache (${e.message})`);
        return old;
      }
      throw e;
    }
  }

  // ---------- Versionslisten ----------

  /** Spielversionen, die ein Loader unterstützt (Set von IDs). */
  async supportedGameVersions(loader) {
    switch (loader) {
      case 'vanilla':
        return null; // alle
      case 'fabric':
        return new Set((await this.cached('fabric-game', 30 * 60e3, () => http.getJson(`${FABRIC}/versions/game`))).map((g) => g.version));
      case 'quilt':
        return new Set((await this.cached('quilt-game', 30 * 60e3, () => http.getJson(`${QUILT}/versions/game`))).map((g) => g.version));
      case 'forge': {
        const all = await this.forgeAll();
        return new Set(Object.keys(all));
      }
      case 'neoforge': {
        const all = await this.neoAll();
        return new Set(Object.keys(all));
      }
      default:
        return new Set();
    }
  }

  async forgeAll() {
    return this.cached('forge-all', 30 * 60e3, async () => {
      const xml = await http.getText(`${FORGE_MAVEN}/maven-metadata.xml`);
      const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
      const byMc = {};
      for (const full of versions) {
        const i = full.indexOf('-');
        if (i < 0) continue;
        const mc = full.slice(0, i);
        (byMc[mc] = byMc[mc] || []).push(full);
      }
      return byMc;
    });
  }

  async forgePromos() {
    return this.cached('forge-promos', 30 * 60e3, async () => (await http.getJson(FORGE_PROMOS)).promos || {});
  }

  async neoAll() {
    return this.cached('neoforge-all', 30 * 60e3, async () => {
      const d = await http.getJson(NEO_API);
      const byMc = {};
      for (const v of d.versions || []) {
        const mc = neoToMc(v);
        if (!mc) continue;
        (byMc[mc] = byMc[mc] || []).push(v);
      }
      for (const k of Object.keys(byMc)) byMc[k].sort(cmpLoose);
      return byMc;
    });
  }

  /**
   * Loader-Versionen für eine Spielversion, neueste zuerst.
   * @returns {Array<{version, stable, recommended?}>}
   */
  async versionsFor(loader, game) {
    switch (loader) {
      case 'vanilla':
        return [];
      case 'fabric': {
        const list = await this.cached(`fabric-loader-${game}`, 15 * 60e3, () => http.getJson(`${FABRIC}/versions/loader/${encodeURIComponent(game)}`));
        return list.map((e) => ({ version: e.loader.version, stable: e.loader.stable !== false }));
      }
      case 'quilt': {
        const list = await this.cached(`quilt-loader-${game}`, 15 * 60e3, () => http.getJson(`${QUILT}/versions/loader/${encodeURIComponent(game)}`));
        return list.map((e) => ({ version: e.loader.version, stable: !/beta|alpha|pre|rc/i.test(e.loader.version) }));
      }
      case 'forge': {
        const all = await this.forgeAll();
        const promos = await this.forgePromos();
        const list = (all[game] || []).slice();
        const rec = promos[`${game}-recommended`];
        const latest = promos[`${game}-latest`];
        return list.map((full) => {
          const short = full.slice(game.length + 1).replace(new RegExp(`-${game.replace(/\./g, '\\.')}$`), '');
          return { version: short, full, stable: true, recommended: short === rec, latest: short === latest };
        });
      }
      case 'neoforge': {
        const all = await this.neoAll();
        return (all[game] || []).slice().reverse().map((v) => ({ version: v, stable: !/beta|alpha/i.test(v) }));
      }
      default:
        throw new Error(`Unbekannter Loader: ${loader}`);
    }
  }

  /** Empfohlene Loader-Version (oder null, wenn nicht verfügbar). */
  async recommended(loader, game) {
    if (loader === 'vanilla') return null;
    const list = await this.versionsFor(loader, game);
    if (!list.length) return null;
    if (loader === 'forge') {
      return (list.find((x) => x.recommended) || list.find((x) => x.latest) || list[0]).version;
    }
    return (list.find((x) => x.stable) || list[0]).version;
  }

  async isAvailable(loader, game) {
    if (loader === 'vanilla') return true;
    try {
      return Boolean(await this.recommended(loader, game));
    } catch {
      return false;
    }
  }

  // ---------- Installation ----------

  /** Installiert Loader (falls nötig) und gibt die zu startende Versions-ID zurück. */
  async install(loader, game, loaderVersion, { progress = () => {}, signal } = {}) {
    if (loader === 'vanilla' || !loader) return game;
    const run = this._installLock.then(() => this._install(loader, game, loaderVersion, { progress, signal }));
    this._installLock = run.catch(() => {});
    return run;
  }

  async _install(loader, game, lv, { progress, signal }) {
    if (!lv) lv = await this.recommended(loader, game);
    if (!lv) throw new Error(`${LOADERS[loader].name} gibt es (noch) nicht für Minecraft ${game}.`);
    switch (loader) {
      case 'fabric':
      case 'quilt': {
        const id = `${loader === 'fabric' ? 'fabric-loader' : 'quilt-loader'}-${lv}-${game}`;
        if (await exists(this.paths.versionJson(id))) return id;
        progress({ label: `Installiere ${LOADERS[loader].name} ${lv} …`, done: 0, total: 1 });
        const base = loader === 'fabric' ? FABRIC : QUILT;
        const profile = await http.getJson(`${base}/versions/loader/${encodeURIComponent(game)}/${encodeURIComponent(lv)}/profile/json`);
        profile.id = id;
        await writeJson(this.paths.versionJson(id), profile);
        return id;
      }
      case 'forge':
        return this._installForgeLike('forge', game, lv, { progress, signal });
      case 'neoforge':
        return this._installForgeLike('neoforge', game, lv, { progress, signal });
      default:
        throw new Error(`Unbekannter Loader: ${loader}`);
    }
  }

  async _installForgeLike(kind, game, lv, { progress, signal }) {
    let full;
    let url;
    if (kind === 'forge') {
      const list = await this.versionsFor('forge', game);
      const hit = list.find((x) => x.version === lv || x.full === lv);
      full = hit ? hit.full : `${game}-${lv}`;
      url = `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`;
    } else {
      full = lv;
      url = `${NEO_MAVEN}/${full}/neoforge-${full}-installer.jar`;
    }
    const markerKey = `${kind}-${full}`;
    const markers = (await readJson(path.join(this.paths.versions, '.patina-loaders.json'))) || (await readJson(path.join(this.paths.versions, '.blockwerk-loaders.json'))) || {};
    if (markers[markerKey] && (await exists(this.paths.versionJson(markers[markerKey])))) return markers[markerKey];

    const name = kind === 'forge' ? 'Forge' : 'NeoForge';
    progress({ label: `Lade ${name}-Installer …`, done: 0, total: 1 });
    const installer = path.join(this.paths.temp, `${kind}-${full}-installer.jar`);
    await fsp.mkdir(this.paths.temp, { recursive: true });
    // Prüfsumme vom offiziellen Maven holen (falls vorhanden) – der Installer führt Code aus
    let sha1 = null;
    try {
      const t = (await http.getText(`${url}.sha1`, { timeout: 15000, retries: 1, signal })).trim();
      if (/^[0-9a-f]{40}/i.test(t)) sha1 = t.slice(0, 40).toLowerCase();
    } catch {}
    await http.download(url, installer, { signal, timeout: 120000, sha1, skipIfValid: Boolean(sha1) });

    const zip = new AdmZip(installer);
    const profEntry = zip.getEntry('install_profile.json');
    if (!profEntry) throw new Error(`${name}-Installer ist ungültig.`);
    const prof = JSON.parse(profEntry.getData().toString('utf8'));
    let versionId;

    if (prof.versionInfo) {
      // Sehr altes Forge (≤1.11): manuell installieren
      versionId = prof.versionInfo.id;
      const json = { ...prof.versionInfo };
      await writeJson(this.paths.versionJson(versionId), json);
      const libRel = mavenPath(prof.install.path);
      const target = this.paths.library(libRel);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const uni = zip.getEntry(prof.install.filePath);
      if (!uni) throw new Error('Forge-Universal-JAR fehlt im Installer.');
      await fsp.writeFile(target, uni.getData());
    } else {
      const vEntry = zip.getEntry('version.json');
      versionId = prof.version || (vEntry && JSON.parse(vEntry.getData().toString('utf8')).id);
      // Installer braucht launcher_profiles.json im Zielordner
      const lp = path.join(this.paths.root, 'launcher_profiles.json');
      if (!(await exists(lp))) await writeJson(lp, { profiles: {}, selectedProfile: '', clientToken: '' });
      // Installer-Java: neuere Installer brauchen mind. Java 17 / die Spielversion
      const javaMajor = await this._javaForGame(game);
      const javaPath = await this.java.ensure(javaMajor, { progress, signal, console: true });
      progress({ label: `Installiere ${name} ${lv} (kann 1–3 Minuten dauern) …`, done: 0, total: 1 });
      const flag = kind === 'forge' ? '--installClient' : '--install-client';
      const out = await runJava(javaPath, ['-jar', installer, flag, this.paths.root], {
        cwd: this.paths.temp,
        signal,
        onLine: (l) => {
          const m = /Processor (\d+)\/(\d+)|^\s*(\d+)\/(\d+)/.exec(l);
          if (/Downloading library|Processor|Patching|Injecting|Extracting/i.test(l)) {
            progress({ label: `${name}: ${l.trim().slice(0, 80)}`, done: m ? Number(m[1] || m[3]) : 0, total: m ? Number(m[2] || m[4]) : 1 });
          }
        },
      });
      if (out.code !== 0 || !(await exists(this.paths.versionJson(versionId)))) {
        const tail = out.lines.slice(-15).join('\n');
        throw new Error(`${name}-Installation fehlgeschlagen (Code ${out.code}).\n${tail}`);
      }
    }
    markers[markerKey] = versionId;
    await writeJson(path.join(this.paths.versions, '.patina-loaders.json'), markers);
    await fsp.rm(installer, { force: true }).catch(() => {});
    return versionId;
  }

  async _javaForGame(game) {
    try {
      const vj = this.versions ? await this.versions.loadJson(game) : await readJson(this.paths.versionJson(game));
      if (vj && vj.javaVersion) return Math.max(vj.javaVersion.majorVersion, 8);
    } catch {}
    return 21;
  }
}

function runJava(java, args, { cwd, signal, onLine }) {
  return new Promise((resolve, reject) => {
    const p = spawn(java, args, { cwd, windowsHide: true, env: process.env });
    const lines = [];
    let buf = '';
    const feed = (d) => {
      buf += d.toString();
      const parts = buf.split(/\r?\n/);
      buf = parts.pop();
      for (const l of parts) {
        lines.push(l);
        if (lines.length > 400) lines.shift();
        if (onLine) onLine(l);
      }
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', reject);
    const onAbort = () => p.kill();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    p.on('exit', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code, lines });
    });
  });
}

module.exports = { Loaders, LOADERS, neoToMc, cmpLoose };
