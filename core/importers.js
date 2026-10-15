'use strict';
// Import: CurseForge-Instanzen, beliebige Ordner (.minecraft, Lunar, …) und Modrinth-Modpacks (.mrpack).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const http = require('./http');
const { readJson, exists, copyDir, dirSize, ensureDir, isInside } = require('./fsutil');

const CF_LOADER_TYPES = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' };
const SKIP_DIRS = new Set(['logs', 'crash-reports', 'downloads', 'debug', '.cache', 'profileImage', 'essential', '.fabric', '.mixin.out']);
const SKIP_FILES = new Set(['minecraftinstance.json', 'manifest.json', 'modlist.html', 'usercache.json', 'usernamecache.json', 'profile.json']);

function defaultCurseForgeDirs() {
  const home = os.homedir();
  return [path.join(home, 'curseforge', 'minecraft', 'Instances'), path.join(home, 'Documents', 'Curse', 'Minecraft', 'Instances')];
}

/** "fabric-0.16.9-1.21.1" / "forge-47.4.0" / "neoforge-21.1.77" -> {loader, version} */
function parseCfLoader(bml, game) {
  if (!bml || !bml.name) return { loader: 'vanilla', version: null };
  const name = String(bml.name);
  let loader = CF_LOADER_TYPES[bml.type] || name.split('-')[0];
  if (!['fabric', 'quilt', 'forge', 'neoforge'].includes(loader)) loader = 'vanilla';
  let version = bml.forgeVersion || null;
  if (!version) {
    const rest = name.slice(name.indexOf('-') + 1);
    version = game && rest.endsWith(`-${game}`) ? rest.slice(0, -(game.length + 1)) : rest;
  }
  if ((loader === 'fabric' || loader === 'quilt') && game && version.endsWith(`-${game}`)) version = version.slice(0, -(game.length + 1));
  return { loader, version };
}

async function scanCurseForge(dirs = defaultCurseForgeDirs()) {
  const out = [];
  for (const root of dirs) {
    let entries = [];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      const j = await readJson(path.join(dir, 'minecraftinstance.json'));
      if (!j || !j.gameVersion) continue;
      const { loader, version } = parseCfLoader(j.baseModLoader, j.gameVersion);
      let mods = 0;
      try {
        mods = (await fsp.readdir(path.join(dir, 'mods'))).filter((f) => /\.jar$/i.test(f)).length;
      } catch {}
      let worlds = 0;
      try {
        worlds = (await fsp.readdir(path.join(dir, 'saves'), { withFileTypes: true })).filter((x) => x.isDirectory()).length;
      } catch {}
      out.push({
        source: 'curseforge',
        path: dir,
        name: j.name || e.name,
        game: j.gameVersion,
        loader,
        loaderVersion: version,
        mods,
        worlds,
        lastPlayed: j.lastPlayed && !String(j.lastPlayed).startsWith('0001') ? j.lastPlayed : null,
        memory: j.allocatedMemory && j.isMemoryOverride ? j.allocatedMemory : null,
        javaArgs: j.javaArgsOverride || null,
      });
    }
  }
  return out.sort((a, b) => String(b.lastPlayed || '').localeCompare(String(a.lastPlayed || '')));
}

/** Versucht Version + Loader aus einem beliebigen Ordner zu erraten. */
async function guessFolder(dir) {
  const info = { path: dir, name: path.basename(dir), game: null, loader: 'vanilla', loaderVersion: null };
  const cf = await readJson(path.join(dir, 'minecraftinstance.json'));
  if (cf && cf.gameVersion) {
    const l = parseCfLoader(cf.baseModLoader, cf.gameVersion);
    return { ...info, name: cf.name || info.name, game: cf.gameVersion, loader: l.loader, loaderVersion: l.version, source: 'curseforge' };
  }
  const mmc = path.join(dir, '..', 'mmc-pack.json');
  const pack = await readJson(mmc);
  if (pack && pack.components) {
    for (const c of pack.components) {
      if (c.uid === 'net.minecraft') info.game = c.version;
      if (c.uid === 'net.fabricmc.fabric-loader') Object.assign(info, { loader: 'fabric', loaderVersion: c.version });
      if (c.uid === 'org.quiltmc.quilt-loader') Object.assign(info, { loader: 'quilt', loaderVersion: c.version });
      if (c.uid === 'net.minecraftforge') Object.assign(info, { loader: 'forge', loaderVersion: c.version });
      if (c.uid === 'net.neoforged') Object.assign(info, { loader: 'neoforge', loaderVersion: c.version });
    }
    info.source = 'prism';
    return info;
  }
  // Mods anschauen
  const mods = await fsp.readdir(path.join(dir, 'mods')).catch(() => []);
  if (mods.length) {
    const { readModMeta } = require('./jarmeta');
    const counts = {};
    for (const m of mods.filter((f) => f.endsWith('.jar')).slice(0, 30)) {
      const meta = readModMeta(path.join(dir, 'mods', m));
      if (meta) counts[meta.loader] = (counts[meta.loader] || 0) + 1;
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best) info.loader = best[0];
  }
  info.source = 'folder';
  return info;
}

/** Kopiert Spielinhalte aus einem Fremdordner in eine Patina-Instanz. */
async function copyInstanceContent(src, dest, { includeWorlds = true, progress = () => {}, skipTop = [] } = {}) {
  const skip = new Set(skipTop.map((x) => String(x).toLowerCase()));
  let n = 0;
  await copyDir(src, dest, {
    filter: (p, e) => {
      const rel = path.relative(src, p);
      const top = rel.split(path.sep)[0];
      if (SKIP_DIRS.has(top) || skip.has(top.toLowerCase())) return false;
      if (!rel.includes(path.sep) && e.isFile() && SKIP_FILES.has(e.name)) return false;
      if (top === '.patina' || top === '.blockwerk') return false;
      if (!includeWorlds && top === 'saves') return false;
      if (top === 'versions' || top === 'libraries' || top === 'assets' || top === 'runtime' || top === 'webcache2' || top === 'launcher_accounts.json') return false;
      return true;
    },
    onFile: () => {
      n++;
      if (n % 50 === 0) progress({ label: `Kopiere Dateien … (${n})`, done: 0, total: 0 });
    },
  });
  return n;
}

// ---------- Modrinth App (Profile/Instanzen) ----------

function defaultModrinthDirs() {
  const home = os.homedir();
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
      : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return [path.join(base, 'ModrinthApp'), path.join(base, 'com.modrinth.theseus')];
}

const MR_LOADERS = { fabric: 'fabric', quilt: 'quilt', forge: 'forge', neoforge: 'neoforge', vanilla: 'vanilla' };

/** Öffnet eine Kopie einer SQLite-Datenbank (samt -wal/-shm), damit eine laufende App nicht stört. */
async function withSqliteCopy(dbFile, fn) {
  let sqlite;
  try {
    sqlite = require('node:sqlite');
  } catch {
    return null;
  }
  if (!(await exists(dbFile))) return null;
  const tmp = path.join(os.tmpdir(), `patina-db-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await ensureDir(tmp);
  try {
    for (const ext of ['', '-wal', '-shm']) {
      if (await exists(dbFile + ext)) await fsp.copyFile(dbFile + ext, path.join(tmp, `app.db${ext}`));
    }
    const db = new sqlite.DatabaseSync(path.join(tmp, 'app.db'));
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Liest die SQLite-Datenbank der Modrinth App. */
async function readModrinthDb(dbFile) {
  return withSqliteCopy(dbFile, (db) => {
    {
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
      let customDir = null;
      if (tables.has('settings')) {
        try {
          const row = db.prepare('SELECT custom_dir FROM settings LIMIT 1').get();
          customDir = row && row.custom_dir ? row.custom_dir : null;
        } catch {}
      }
      let rows = [];
      if (tables.has('instances') && tables.has('instance_content_sets')) {
        rows = db
          .prepare(
            `SELECT i.path AS path, i.name AS name, i.last_played AS last_played, c.game_version AS game_version, c.loader AS loader, c.loader_version AS loader_version
             FROM instances i LEFT JOIN instance_content_sets c ON c.id = i.applied_content_set_id`
          )
          .all();
      } else if (tables.has('profiles')) {
        rows = db.prepare('SELECT path, name, last_played, game_version, mod_loader AS loader, mod_loader_version AS loader_version, override_mc_memory_max AS memory FROM profiles').all();
      }
      return { customDir, rows };
    }
  });
}

function normalizeLoaderVersion(v) {
  if (!v) return null;
  if (typeof v === 'object') return v.id || null;
  const s = String(v);
  if (s.startsWith('{')) {
    try {
      return JSON.parse(s).id || null;
    } catch {}
  }
  return s;
}

async function countEntries(dir, filter) {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true })).filter(filter).length;
  } catch {
    return 0;
  }
}

/** Findet Modrinth-App-Instanzen. dirs: Datenordner der App (mit app.db und/oder profiles/). */
async function scanModrinthApp(dirs = defaultModrinthDirs()) {
  const out = [];
  const seen = new Set();
  for (const root of dirs) {
    if (!(await exists(root))) continue;
    let meta = null;
    try {
      if (await exists(path.join(root, 'app.db'))) meta = await readModrinthDb(path.join(root, 'app.db'));
    } catch {
      meta = null;
    }
    const profilesDir = path.join((meta && meta.customDir) || root, 'profiles');
    const byPath = new Map(((meta && meta.rows) || []).map((r) => [r.path, r]));
    let folders = [];
    try {
      folders = (await fsp.readdir(profilesDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {}
    for (const r of byPath.keys()) if (!folders.includes(r)) folders.push(r);
    for (const name of folders) {
      const dir = path.join(profilesDir, name);
      if (seen.has(dir) || !(await exists(dir))) continue;
      seen.add(dir);
      const row = byPath.get(name);
      let info = null;
      if (row) {
        info = {
          name: row.name || name,
          game: row.game_version || null,
          loader: MR_LOADERS[row.loader] || 'vanilla',
          loaderVersion: normalizeLoaderVersion(row.loader_version),
          lastPlayed: row.last_played ? new Date(Number(row.last_played) * (Number(row.last_played) < 1e12 ? 1000 : 1)).toISOString() : null,
          memory: row.memory || null,
        };
      } else {
        // sehr alte App-Versionen: profile.json im Profilordner
        const pj = await readJson(path.join(dir, 'profile.json'));
        if (pj && pj.metadata) {
          info = {
            name: pj.metadata.name || name,
            game: pj.metadata.game_version || null,
            loader: MR_LOADERS[pj.metadata.loader] || 'vanilla',
            loaderVersion: normalizeLoaderVersion(pj.metadata.loader_version),
            lastPlayed: pj.metadata.date_played || null,
          };
        } else {
          const g = await guessFolder(dir);
          info = { name: g.name, game: g.game, loader: g.loader, loaderVersion: g.loaderVersion, lastPlayed: null };
        }
      }
      if (info.loader === 'vanilla') info.loaderVersion = null;
      out.push({
        source: 'modrinth',
        path: dir,
        ...info,
        mods: await countEntries(path.join(dir, 'mods'), (e) => e.isFile() && /\.jar$/i.test(e.name)),
        worlds: await countEntries(path.join(dir, 'saves'), (e) => e.isDirectory()),
      });
    }
  }
  return out.sort((a, b) => String(b.lastPlayed || '').localeCompare(String(a.lastPlayed || '')));
}

// ---------- Modrinth-Modpacks (.mrpack) ----------

const MRPACK_LOADERS = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' };

function readMrpack(file) {
  const zip = new AdmZip(file);
  const idx = zip.getEntry('modrinth.index.json');
  if (!idx) throw new Error('Keine gültige .mrpack-Datei.');
  const index = JSON.parse(idx.getData().toString('utf8'));
  const deps = index.dependencies || {};
  let loader = 'vanilla';
  let loaderVersion = null;
  for (const [k, v] of Object.entries(MRPACK_LOADERS)) {
    if (deps[k]) {
      loader = v;
      loaderVersion = deps[k];
    }
  }
  return { zip, index, game: deps.minecraft, loader, loaderVersion, name: index.name, summary: index.summary };
}

// Laut Modrinth-Spezifikation erlaubte Download-Quellen für Modpack-Dateien
const MRPACK_HOSTS = new Set(['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com']);

function allowedMrpackUrls(list) {
  return (Array.isArray(list) ? list : [list]).filter((u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'https:' && MRPACK_HOSTS.has(x.hostname);
    } catch {
      return false;
    }
  });
}

async function installMrpackFiles(pack, gameDir, { progress = () => {}, signal } = {}) {
  const files = (pack.index.files || []).filter((f) => !f.env || f.env.client !== 'unsupported');
  // erst alles prüfen, dann laden – ein manipuliertes Paket schreibt so gar nichts
  for (const f of files) {
    if (typeof f.path !== 'string' || !isInside(gameDir, path.resolve(gameDir, f.path))) throw new Error(`Unsicherer Pfad im Modpack: ${f.path}`);
    if (!allowedMrpackUrls(f.downloads).length) throw new Error(`Unzulässige Download-Quelle im Modpack: ${f.path}`);
    if (!f.hashes || !/^[0-9a-f]{40}$/i.test(f.hashes.sha1 || '')) throw new Error(`Prüfsumme fehlt im Modpack: ${f.path}`);
  }
  let done = 0;
  await http.pool(files, 8, async (f) => {
    const target = path.resolve(gameDir, f.path);
    await http.download(allowedMrpackUrls(f.downloads), target, { sha1: f.hashes.sha1, size: f.fileSize, signal });
    progress({ label: `Lade Modpack-Dateien … (${++done}/${files.length})`, done, total: files.length });
  });
  // overrides
  for (const e of pack.zip.getEntries()) {
    if (e.isDirectory) continue;
    let rel = null;
    if (e.entryName.startsWith('overrides/')) rel = e.entryName.slice('overrides/'.length);
    else if (e.entryName.startsWith('client-overrides/')) rel = e.entryName.slice('client-overrides/'.length);
    if (!rel) continue;
    const target = path.resolve(gameDir, rel);
    if (!isInside(gameDir, target)) continue;
    await ensureDir(path.dirname(target));
    await fsp.writeFile(target, e.getData());
  }
  return files.length;
}

module.exports = { withSqliteCopy, scanCurseForge, scanModrinthApp, defaultModrinthDirs, guessFolder, copyInstanceContent, readMrpack, installMrpackFiles, parseCfLoader, defaultCurseForgeDirs };
