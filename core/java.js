'use strict';
// Java-Laufzeiten: automatisch passende Version (Eclipse Temurin) herunterladen.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const http = require('./http');
const { readJson, writeJson, exists } = require('./fsutil');

const LTS = [8, 11, 17, 21, 25];
const MARKER = '.patina.json';
const LEGACY_MARKER = '.blockwerk.json';

async function readMarker(dir) {
  return (await readJson(path.join(dir, MARKER))) || (await readJson(path.join(dir, LEGACY_MARKER)));
}

/** Welche Java-Hauptversion wir für eine gewünschte Version installieren. */
function pickMajor(required) {
  const r = Number(required) || 8;
  if (LTS.includes(r)) return r;
  if (r === 16) return 17; // MC 1.17 läuft problemlos mit 17
  const higher = LTS.find((x) => x >= r);
  return higher || r;
}

function adoptiumOs() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}
function adoptiumArch() {
  if (process.arch === 'arm64') return 'aarch64';
  if (process.arch === 'ia32') return 'x32';
  return 'x64';
}

class JavaManager {
  constructor({ paths, log = () => {} }) {
    this.paths = paths;
    this.log = log;
    this._locks = new Map();
  }

  runtimeDir(major) {
    return path.join(this.paths.runtime, `java-${major}`);
  }

  executableIn(home, { console = false } = {}) {
    if (process.platform === 'win32') return path.join(home, 'bin', console ? 'java.exe' : 'javaw.exe');
    if (process.platform === 'darwin' && fs.existsSync(path.join(home, 'Contents', 'Home'))) {
      return path.join(home, 'Contents', 'Home', 'bin', 'java');
    }
    return path.join(home, 'bin', 'java');
  }

  async installed() {
    const out = [];
    let entries = [];
    try {
      entries = await fsp.readdir(this.paths.runtime, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const m = /^java-(\d+)$/.exec(e.name);
      if (!m) continue;
      const info = await readMarker(path.join(this.paths.runtime, e.name));
      if (info) out.push({ major: Number(m[1]), ...info });
    }
    return out.sort((a, b) => a.major - b.major);
  }

  /** Liefert Pfad zu java(w) für die benötigte Version, lädt sie bei Bedarf. */
  async ensure(requiredMajor, { progress = () => {}, signal, console = false } = {}) {
    const major = pickMajor(requiredMajor);
    if (this._locks.has(major)) await this._locks.get(major).catch(() => {});
    const dir = this.runtimeDir(major);
    const info = await readMarker(dir);
    if (info && (await exists(path.join(dir, info.home, 'bin')))) {
      return this.executableIn(path.join(dir, info.home), { console });
    }
    const job = this._install(major, { progress, signal });
    this._locks.set(major, job);
    try {
      const home = await job;
      return this.executableIn(home, { console });
    } finally {
      this._locks.delete(major);
    }
  }

  async _install(major, { progress, signal }) {
    const dir = this.runtimeDir(major);
    const api = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${adoptiumArch()}&image_type=jre&os=${adoptiumOs()}&vendor=eclipse`;
    let assets = await http.getJson(api, { timeout: 20000 });
    if (!assets.length) {
      // Fallback: JDK statt JRE
      assets = await http.getJson(api.replace('image_type=jre', 'image_type=jdk'), { timeout: 20000 });
    }
    if (!assets.length) throw new Error(`Keine Java ${major}-Laufzeit für dieses System gefunden.`);
    const pkg = assets[0].binary.package;
    const releaseName = assets[0].release_name;
    this.log('info', `Lade Java ${major} (${releaseName})`);
    const archive = path.join(this.paths.temp, pkg.name);
    await fsp.mkdir(this.paths.temp, { recursive: true });
    await http.download(pkg.link, archive, {
      sha256: pkg.checksum,
      size: pkg.size,
      signal,
      timeout: 120000,
      onProgress: (d, t) => progress({ label: `Lade Java ${major} …`, done: d, total: t || pkg.size }),
    });
    progress({ label: `Entpacke Java ${major} …`, done: 0, total: 1 });
    const staging = `${dir}.staging`;
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.mkdir(staging, { recursive: true });
    if (pkg.name.endsWith('.zip')) {
      const zip = new AdmZip(archive);
      zip.extractAllTo(staging, true);
    } else {
      await new Promise((resolve, reject) => {
        const p = spawn('tar', ['-xzf', archive, '-C', staging]);
        p.on('error', reject);
        p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`tar exit ${c}`))));
      });
    }
    const top = (await fsp.readdir(staging)).filter((n) => !n.startsWith('.'));
    const home = top.length === 1 ? top[0] : '.';
    if (process.platform !== 'win32') {
      // Ausführungsrechte sicherstellen
      const bin = path.join(staging, home, 'bin');
      for (const f of await fsp.readdir(bin).catch(() => [])) await fsp.chmod(path.join(bin, f), 0o755).catch(() => {});
    }
    await writeJson(path.join(staging, MARKER), { home, release: releaseName, installedAt: new Date().toISOString() });
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rename(staging, dir);
    await fsp.rm(archive, { force: true });
    progress({ label: `Java ${major} bereit`, done: 1, total: 1 });
    return path.join(dir, home);
  }

  /** Prüft eine benutzerdefinierte Java-Installation. */
  async probe(javaPath) {
    return new Promise((resolve) => {
      const exe = javaPath.replace(/javaw\.exe$/i, 'java.exe');
      const p = spawn(exe, ['-version'], { windowsHide: true });
      let out = '';
      p.stderr.on('data', (d) => (out += d));
      p.stdout.on('data', (d) => (out += d));
      p.on('error', () => resolve(null));
      p.on('exit', () => {
        const m = /version "([^"]+)"/.exec(out);
        if (!m) return resolve(null);
        const v = m[1];
        const major = v.startsWith('1.') ? Number(v.split('.')[1]) : Number(v.split(/[.+-]/)[0]);
        resolve({ version: v, major });
      });
    });
  }
}

module.exports = { JavaManager, pickMajor };
