'use strict';
// Import aus dem NoRisk Client (Launcher v3, gg.norisk.NoRiskClientV3).
//
// Aufbau beim NoRisk-Launcher (Windows):
//   %APPDATA%\norisk\NoRiskClientV3\            -> root (launcher_config.json, profiles.json [alt], norisk_versions.json)
//   %APPDATA%\norisk\NoRiskClientV3\meta\       -> app.db (Profile seit 2026), mod_cache\ (geladene Mods)
//   %APPDATA%\norisk\NoRiskClientV3\data\profiles\<pfad>   -> Spielordner der Profile
//   ...\data\profiles\noriskclient\new|legacy   -> gemeinsamer Ordner der NoRisk-Standardversionen
// Mods liegen je Profil in mods\nrc-<mc>-<loader>[-xxxx]\ (vom Launcher synchronisiert), eigene Dateien
// in custom_mods\ und lose in mods\. Der NoRisk-Client-Mod selbst funktioniert nur mit deren Launcher
// und wird deshalb nicht übernommen.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { readJson, exists, isInside } = require('./fsutil');

const LOADERS = new Set(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']);
// NoRisk-eigene Dateien (Client-Mod, Hilfsbibliotheken) – laufen nur im NoRisk-Launcher
const NORISK_OWN = /(^|[-_ .])(nrc|norisk)([-_ .]|client|$)/i;

function defaultNoRiskRoots() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [path.join(appData, 'norisk', 'NoRiskClientV3')];
  }
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'gg.norisk.NoRiskClientV3')];
  return [path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'noriskclientv3')];
}

/** Ermittelt aus einem (ggf. vom Nutzer gewählten) Ordner die Launcher-Struktur. */
async function resolveRoot(dir) {
  let root = dir;
  // Nutzer hat evtl. den data- oder profiles-Ordner gewählt
  if (path.basename(root).toLowerCase() === 'profiles') root = path.dirname(root);
  if (path.basename(root).toLowerCase() === 'data' && (await exists(path.join(path.dirname(root), 'meta')))) root = path.dirname(root);
  const looksLikeRoot =
    (await exists(path.join(root, 'meta'))) || (await exists(path.join(root, 'profiles.json'))) || (await exists(path.join(root, 'launcher_config.json'))) || (await exists(path.join(root, 'data', 'profiles')));
  if (!looksLikeRoot) return null;
  const dataDir = (await exists(path.join(root, 'data', 'profiles'))) || process.platform === 'win32' ? path.join(root, 'data') : root;
  const config = (await readJson(path.join(root, 'launcher_config.json'))) || {};
  const custom = typeof config.custom_game_directory === 'string' && config.custom_game_directory ? config.custom_game_directory : null;
  return {
    root,
    profilesDir: custom ? path.join(custom, 'profiles') : path.join(dataDir, 'profiles'),
    metaDir: path.join(root, 'meta'),
    modCacheDirs: [...(custom ? [path.join(custom, 'mod_cache')] : []), path.join(root, 'meta', 'mod_cache')],
  };
}

function toIso(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    let n = Number(v);
    if (n > 1e17) n = n / 1e6; // Nanosekunden
    else if (n > 1e14) n = n / 1e3; // Mikrosekunden
    else if (n < 1e11) n = n * 1000; // Sekunden
    const d = new Date(n);
    return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 ? null : d.toISOString();
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 ? null : d.toISOString();
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
}

/** Profile aus app.db (neu) oder profiles.json (alt). */
async function readProfiles(r, withSqliteCopy) {
  const fromDb = await withSqliteCopy(path.join(r.metaDir, 'app.db'), (db) => {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name));
    if (!tables.has('profiles')) return null;
    // Zeitstempel sind Nanosekunden (zu groß für JS-Zahlen) -> als Text lesen
    const cols = new Set(db.prepare('PRAGMA table_info(profiles)').all().map((c) => c.name));
    const pick = (c, expr = c) => (cols.has(c) ? `${expr} AS ${c}` : `NULL AS ${c}`);
    const profiles = db
      .prepare(
        `SELECT ${[
          pick('id'),
          pick('name'),
          pick('path'),
          pick('game_version'),
          pick('loader'),
          pick('loader_version'),
          pick('last_played', 'CAST(last_played AS TEXT)'),
          pick('group_name'),
          pick('use_shared_minecraft_folder'),
          pick('is_standard_version'),
          pick('source_standard_profile_id'),
          pick('playtime_seconds', 'CAST(playtime_seconds AS TEXT)'),
          pick('settings'),
        ].join(', ')} FROM profiles`
      )
      .all();
    const mods = tables.has('profile_mods') ? db.prepare('SELECT profile_id, source, enabled, file_name_override, display_name FROM profile_mods ORDER BY profile_id, ordinal').all() : [];
    const byProfile = new Map();
    for (const m of mods) {
      if (!byProfile.has(m.profile_id)) byProfile.set(m.profile_id, []);
      byProfile.get(m.profile_id).push({ source: parseJson(m.source, {}), enabled: m.enabled !== 0, file_name_override: m.file_name_override, display_name: m.display_name });
    }
    return profiles.map((p) => ({
      id: p.id,
      name: p.name,
      path: p.path,
      game_version: p.game_version,
      loader: p.loader,
      loader_version: p.loader_version,
      last_played: p.last_played,
      group: p.group_name,
      use_shared_minecraft_folder: Boolean(p.use_shared_minecraft_folder),
      is_standard_version: Boolean(p.is_standard_version),
      source_standard_profile_id: p.source_standard_profile_id,
      playtime_seconds: p.playtime_seconds,
      settings: parseJson(p.settings, {}),
      mods: byProfile.get(p.id) || [],
    }));
  }).catch(() => null);
  if (fromDb && fromDb.length) return fromDb;
  const legacy = await readJson(path.join(r.root, 'profiles.json'));
  if (Array.isArray(legacy)) return legacy;
  if (legacy && typeof legacy === 'object') return Object.values(legacy.profiles || legacy).filter((p) => p && typeof p === 'object' && p.game_version);
  return [];
}

function isNoRiskGroup(g) {
  const n = String(g || '').toLowerCase();
  return n === 'nrc' || n === 'noriskclient' || n === 'norisk client';
}

function isLegacyMc(v) {
  const m = /^1\.(\d+)/.exec(String(v || ''));
  return Boolean(m && Number(m[1]) < 13);
}

function sanitizeGroup(g) {
  return String(g).toLowerCase().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
}

/** Spielordner eines Profils – dieselben Regeln wie im NoRisk-Launcher. */
function instanceDir(r, p) {
  const isolatedGroup = p.group && ['server', 'modpacks'].includes(String(p.group).toLowerCase());
  if (p.use_shared_minecraft_folder && p.group && !isolatedGroup) {
    if (isNoRiskGroup(p.group)) return path.join(r.profilesDir, 'noriskclient', isLegacyMc(p.game_version) ? 'legacy' : 'new');
    return path.join(r.profilesDir, 'groups', sanitizeGroup(p.group));
  }
  return path.join(r.profilesDir, ...String(p.path || '').split('/').filter((s) => s && s !== '..' && s !== '.'));
}

function managedDirNames(p) {
  const loader = String(p.loader || '').toLowerCase();
  if (!['fabric', 'forge', 'neoforge'].includes(loader)) return [];
  const base = `nrc-${p.game_version}-${loader}`;
  const id = String(p.id || '').replace(/-/g, '');
  return id.length >= 4 ? [`${base}-${id.slice(0, 2)}${id.slice(-2)}`, base] : [base];
}

function modFileName(m) {
  if (m.file_name_override) return path.basename(String(m.file_name_override));
  const s = m.source || {};
  if (s.file_name) return path.basename(String(s.file_name));
  return null;
}

/** Version aus dem letzten Spielprotokoll lesen (für den gemeinsamen Standard-Ordner). */
async function versionFromLog(dir) {
  let text;
  try {
    const fd = await fsp.open(path.join(dir, 'logs', 'latest.log'), 'r');
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
    await fd.close();
    text = buf.slice(0, bytesRead).toString('utf8');
  } catch {
    return null;
  }
  let m = /Loading Minecraft (\S+) with Fabric Loader (\S+)/.exec(text);
  if (m) return { game: m[1], loader: 'fabric', loaderVersion: m[2] };
  m = /Loading Minecraft (\S+) with Quilt Loader (\S+)/.exec(text);
  if (m) return { game: m[1], loader: 'quilt', loaderVersion: m[2] };
  m = /Forge Mod Loader version (\S+) for Minecraft (\S+)/.exec(text);
  if (m) return { game: m[2], loader: 'forge', loaderVersion: m[1] };
  m = /NeoForge (\S+) .*Minecraft (\d[\w.\-]*)/.exec(text);
  if (m) return { game: m[2], loader: 'neoforge', loaderVersion: m[1] };
  m = /--fml\.mcVersion,\s*(\S+?),.*--fml\.forgeVersion,\s*(\S+?),/.exec(text);
  if (m) return { game: m[1], loader: 'forge', loaderVersion: m[2] };
  return null;
}

async function listJars(dir) {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && /\.jar(\.disabled)?$/i.test(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}

async function mtimeIso(file) {
  try {
    return (await fsp.stat(file)).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Sammelt alle Mod-Dateien eines NoRisk-Profils.
 * Ergebnis: [{ src, name, enabled }] – NoRisk-eigene Dateien sind schon aussortiert.
 */
async function collectMods(r, p, dir) {
  const out = new Map();
  const add = (src, name, enabled) => {
    const clean = name.replace(/\.disabled$/i, '');
    if (!/\.jar$/i.test(clean) || NORISK_OWN.test(clean)) return;
    if (!out.has(clean.toLowerCase())) out.set(clean.toLowerCase(), { src, name: clean, enabled });
  };
  // 1) vom NoRisk-Launcher synchronisierte Mods (Paket + eigene)
  const modsDir = path.join(dir, 'mods');
  const subdirs = await fsp.readdir(modsDir, { withFileTypes: true }).catch(() => []);
  const wanted = managedDirNames(p);
  let managed = wanted.find((n) => subdirs.some((e) => e.isDirectory() && e.name === n));
  if (!managed && p.game_version && p.loader) {
    const prefix = `nrc-${p.game_version}-${String(p.loader).toLowerCase()}`;
    const hit = subdirs.find((e) => e.isDirectory() && e.name.startsWith(prefix));
    managed = hit && hit.name;
  }
  if (managed) for (const f of await listJars(path.join(modsDir, managed))) add(path.join(modsDir, managed, f), f, !/\.disabled$/i.test(f));
  // 2) eigene Mods des Profils aus dem Mod-Cache (falls noch nie synchronisiert)
  for (const m of p.mods || []) {
    const name = modFileName(m);
    if (!name || out.has(name.toLowerCase())) continue;
    for (const c of r.modCacheDirs) {
      const src = path.join(c, name);
      if (isInside(c, src) && (await exists(src))) {
        add(src, name, m.enabled !== false);
        break;
      }
    }
  }
  // Im Profil deaktivierte Mods auch hier deaktivieren
  for (const m of p.mods || []) {
    const name = modFileName(m);
    const hit = name && out.get(name.toLowerCase());
    if (hit && m.enabled === false) hit.enabled = false;
  }
  // 3) eigene Dateien (custom_mods) und lose Dateien in mods\
  for (const f of await listJars(path.join(dir, 'custom_mods'))) add(path.join(dir, 'custom_mods', f), f, !/\.disabled$/i.test(f));
  for (const f of await listJars(modsDir)) add(path.join(modsDir, f), f, !/\.disabled$/i.test(f));
  return [...out.values()];
}

async function countWorlds(dir) {
  try {
    return (await fsp.readdir(path.join(dir, 'saves'), { withFileTypes: true })).filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

function normLoader(l) {
  const s = String(l || 'vanilla').toLowerCase();
  return LOADERS.has(s) ? s : 'vanilla';
}

/** Findet NoRisk-Profile. Ergebnis wie bei den anderen Importern (+ noriskMods für den Import). */
async function scanNoRisk(dirs = defaultNoRiskRoots(), { withSqliteCopy }) {
  const out = [];
  const seenDirs = new Set();
  for (const dir of dirs) {
    let r;
    try {
      r = await resolveRoot(dir);
    } catch {
      r = null;
    }
    if (!r) continue;
    const profiles = await readProfiles(r, withSqliteCopy).catch(() => []);
    // Eigene Profile
    for (const p of profiles) {
      if (!p || (p.is_standard_version && !p.source_standard_profile_id)) continue;
      const d = instanceDir(r, p);
      if (!isInside(r.profilesDir, d) || !(await exists(d))) continue;
      const settings = p.settings || {};
      const lv = settings.use_overwrite_loader_version && settings.overwrite_loader_version ? settings.overwrite_loader_version : p.loader_version;
      const mods = await collectMods(r, p, d);
      out.push({
        source: 'norisk',
        path: d,
        key: `${d}#${p.id || p.name}`,
        name: p.name || path.basename(d),
        game: p.game_version || null,
        loader: normLoader(p.loader),
        loaderVersion: normLoader(p.loader) === 'vanilla' ? null : lv || null,
        lastPlayed: toIso(p.last_played),
        memory: settings.memory && settings.memory.max ? Number(settings.memory.max) : null,
        playTime: Number(p.playtime_seconds) || 0,
        mods: mods.filter((m) => m.enabled).length,
        worlds: await countWorlds(d),
        noriskMods: mods,
        excludeDirs: [],
      });
      seenDirs.add(path.resolve(d));
    }
    // Gemeinsame Ordner der NoRisk-Standardversionen (dort liegen Welten/Einstellungen der meisten Spieler)
    const standard = ((await readJson(path.join(r.root, 'norisk_versions.json'))) || {}).profiles || [];
    for (const sub of ['new', 'legacy', '']) {
      const d = sub ? path.join(r.profilesDir, 'noriskclient', sub) : path.join(r.profilesDir, 'noriskclient');
      if (seenDirs.has(path.resolve(d)) || !(await exists(d))) continue;
      const hasContent = (await exists(path.join(d, 'options.txt'))) || (await exists(path.join(d, 'saves'))) || (await exists(path.join(d, 'mods')));
      if (!hasContent) continue;
      const fromLog = await versionFromLog(d);
      const candidates = standard.filter((s) => s && s.game_version && (sub ? isLegacyMc(s.game_version) === (sub === 'legacy') : String(s.path || '').replace(/\/+$/, '') === 'noriskclient'));
      const fallback = candidates.sort((a, b) => String(b.game_version).localeCompare(String(a.game_version), undefined, { numeric: true }))[0];
      const info = fromLog || (fallback ? { game: fallback.game_version, loader: normLoader(fallback.loader), loaderVersion: fallback.loader_version || null } : { game: null, loader: 'fabric', loaderVersion: null });
      const pseudo = { id: '', game_version: info.game, loader: info.loader, mods: [] };
      const mods = await collectMods(r, pseudo, d);
      out.push({
        source: 'norisk',
        path: d,
        key: d,
        name: `NoRisk Client${info.game ? ` ${info.game}` : ''}`,
        game: info.game,
        loader: normLoader(info.loader),
        loaderVersion: normLoader(info.loader) === 'vanilla' ? null : info.loaderVersion || null,
        lastPlayed: (await mtimeIso(path.join(d, 'logs', 'latest.log'))) || (await mtimeIso(path.join(d, 'options.txt'))),
        memory: null,
        playTime: 0,
        mods: mods.filter((m) => m.enabled).length,
        worlds: await countWorlds(d),
        noriskMods: mods,
        excludeDirs: sub ? [] : ['new', 'legacy', 'temp'],
      });
      seenDirs.add(path.resolve(d));
    }
  }
  // Ordner, die andere Profile enthalten (z. B. „noriskclient“ als Elternordner von „new“), nicht doppelt kopieren
  for (const it of out) {
    it.excludeDirs = [...new Set([...it.excludeDirs, ...[...seenDirs].filter((d) => d !== path.resolve(it.path) && isInside(it.path, d)).map((d) => path.relative(path.resolve(it.path), d).split(path.sep)[0])])];
  }
  return out.sort((a, b) => String(b.lastPlayed || '').localeCompare(String(a.lastPlayed || '')));
}

/** Kopiert die gesammelten Mod-Dateien in den mods-Ordner der neuen Instanz. */
async function placeNoRiskMods(mods, destModsDir) {
  await fsp.mkdir(destModsDir, { recursive: true });
  let n = 0;
  for (const m of mods || []) {
    const name = path.basename(String(m.name || ''));
    if (!/\.jar$/i.test(name) || NORISK_OWN.test(name)) continue;
    const src = String(m.src || '');
    if (!/\.jar(\.disabled)?$/i.test(src) || !(await exists(src))) continue;
    const target = path.join(destModsDir, m.enabled === false ? `${name}.disabled` : name);
    await fsp.copyFile(src, target);
    n++;
  }
  return n;
}

module.exports = { defaultNoRiskRoots, scanNoRisk, placeNoRiskMods, versionFromLog, NORISK_OWN };
