'use strict';
// Instanzen: jede Instanz ist ein eigener Spielordner (mods, config, saves, options.txt …).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson, exists, ensureDir, copyDir, safeName, uniqueDir, dirSize } = require('./fsutil');

const META_DIR = '.patina';
const LEGACY_META_DIRS = ['.blockwerk'];

const ICONS = ['grass', 'stone', 'copper', 'deepslate', 'gold', 'amethyst', 'sand', 'snow', 'nether', 'oak', 'ice', 'obsidian'];

class Instances {
  constructor({ paths, log = () => {} }) {
    this.paths = paths;
    this.log = log;
    this._cache = new Map(); // id -> {dir, data}
  }

  metaDir(inst) {
    return path.join(inst._dir, META_DIR);
  }
  metaFile(dir) {
    return path.join(dir, META_DIR, 'instance.json');
  }

  _attach(dir, data) {
    Object.defineProperty(data, '_dir', { value: dir, enumerable: false, writable: true, configurable: true });
    return data;
  }

  async list() {
    await ensureDir(this.paths.instances);
    const out = [];
    for (const e of await fsp.readdir(this.paths.instances, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const dir = path.join(this.paths.instances, e.name);
      await migrateMetaDir(dir);
      const data = await readJson(this.metaFile(dir));
      if (!data || !data.id) continue;
      this._attach(dir, data);
      this._cache.set(data.id, data);
      out.push(data);
    }
    out.sort((a, b) => String(b.lastPlayed || b.created).localeCompare(String(a.lastPlayed || a.created)));
    return out;
  }

  async get(id) {
    if (this._cache.has(id)) {
      const c = this._cache.get(id);
      if (await exists(this.metaFile(c._dir))) {
        const fresh = await readJson(this.metaFile(c._dir));
        if (fresh) {
          this._attach(c._dir, fresh);
          this._cache.set(id, fresh);
          return fresh;
        }
      }
    }
    const all = await this.list();
    const hit = all.find((i) => i.id === id);
    if (!hit) throw new Error('Instanz nicht gefunden.');
    return hit;
  }

  async save(inst) {
    await writeJson(this.metaFile(inst._dir), inst);
    this._cache.set(inst.id, inst);
    return inst;
  }

  async update(id, patch) {
    const inst = await this.get(id);
    Object.assign(inst, patch);
    return this.save(inst);
  }

  async create({ name, game, loader = 'vanilla', loaderVersion = null, icon, extra = {} }) {
    await ensureDir(this.paths.instances);
    const clean = safeName(name || `${loader === 'vanilla' ? 'Minecraft' : loader} ${game}`);
    const folder = await uniqueDir(this.paths.instances, clean);
    const dir = path.join(this.paths.instances, folder);
    await ensureDir(dir);
    for (const sub of ['mods', 'config', 'resourcepacks', 'shaderpacks', 'saves']) {
      if (loader === 'vanilla' && (sub === 'mods' || sub === 'config' || sub === 'shaderpacks')) continue;
      await ensureDir(path.join(dir, sub));
    }
    const data = this._attach(dir, {
      id: crypto.randomUUID(),
      name: name || clean,
      game,
      loader,
      loaderVersion,
      icon: icon || ICONS[Math.floor(Math.random() * ICONS.length)],
      created: new Date().toISOString(),
      lastPlayed: null,
      playTime: 0,
      memory: null,
      jvmArgs: '',
      javaPath: '',
      resolution: null,
      quickPlay: null,
      pending: [],
      history: [],
      ...extra,
    });
    await this.save(data);
    return data;
  }

  async duplicate(id, { name, skipSaves = false } = {}) {
    const src = await this.get(id);
    const newName = name || `${src.name} (Kopie)`;
    const folder = await uniqueDir(this.paths.instances, safeName(newName));
    const dir = path.join(this.paths.instances, folder);
    await copyDir(src._dir, dir, {
      filter: (p) => {
        const rel = path.relative(src._dir, p).split(path.sep);
        if (rel[0] === META_DIR && rel[1] === 'backups') return false;
        if (rel[0] === 'logs' || rel[0] === 'crash-reports') return false;
        if (skipSaves && rel[0] === 'saves') return false;
        return true;
      },
    });
    const data = await readJson(this.metaFile(dir));
    data.id = crypto.randomUUID();
    data.name = newName;
    data.created = new Date().toISOString();
    data.lastPlayed = null;
    data.playTime = 0;
    data.history = [];
    this._attach(dir, data);
    await this.save(data);
    return data;
  }

  async remove(id, { trash } = {}) {
    const inst = await this.get(id);
    if (trash) await trash(inst._dir);
    else await fsp.rm(inst._dir, { recursive: true, force: true });
    this._cache.delete(id);
  }

  async rename(id, name) {
    const inst = await this.get(id);
    inst.name = String(name).trim().slice(0, 64) || inst.name;
    return this.save(inst);
  }

  async size(id) {
    const inst = await this.get(id);
    return dirSize(inst._dir);
  }

  async worlds(id) {
    const inst = await this.get(id);
    const savesDir = path.join(inst._dir, 'saves');
    const out = [];
    for (const e of await fsp.readdir(savesDir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const lvl = path.join(savesDir, e.name, 'level.dat');
      try {
        const st = await fsp.stat(lvl);
        const icon = path.join(savesDir, e.name, 'icon.png');
        out.push({ folder: e.name, lastPlayed: st.mtime.toISOString(), hasIcon: await exists(icon) });
      } catch {}
    }
    return out.sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
  }

  async servers(id) {
    // servers.dat ist NBT – wir lesen nur die Namen/IPs grob aus
    const inst = await this.get(id);
    try {
      const buf = await fsp.readFile(path.join(inst._dir, 'servers.dat'));
      return parseServersDat(buf);
    } catch {
      return [];
    }
  }
}

/** Alte Metadaten-Ordner (.blockwerk) auf den neuen Namen umziehen. */
async function migrateMetaDir(dir) {
  const target = path.join(dir, META_DIR);
  if (await exists(target)) return;
  for (const old of LEGACY_META_DIRS) {
    const src = path.join(dir, old);
    if (!(await exists(src))) continue;
    try {
      await fsp.rename(src, target);
    } catch {
      // gesperrt (z. B. Spiel läuft) -> kopieren
      await copyDir(src, target).catch(() => {});
    }
    return;
  }
}

/** Minimaler NBT-Leser für servers.dat (unkomprimiert). */
function parseServersDat(buf) {
  let o = 0;
  const u8 = () => buf.readUInt8(o++);
  const i16 = () => {
    const v = buf.readInt16BE(o);
    o += 2;
    return v;
  };
  const i32 = () => {
    const v = buf.readInt32BE(o);
    o += 4;
    return v;
  };
  const str = () => {
    const len = buf.readUInt16BE(o);
    o += 2;
    const s = buf.toString('utf8', o, o + len);
    o += len;
    return s;
  };
  const readPayload = (type) => {
    switch (type) {
      case 1:
        return u8();
      case 2:
        return i16();
      case 3:
        return i32();
      case 4:
        o += 8;
        return 0;
      case 5:
        o += 4;
        return 0;
      case 6:
        o += 8;
        return 0;
      case 7: {
        const n = i32();
        o += n;
        return null;
      }
      case 8:
        return str();
      case 9: {
        const t = u8();
        const n = i32();
        const arr = [];
        for (let i = 0; i < n; i++) arr.push(readPayload(t));
        return arr;
      }
      case 10: {
        const obj = {};
        for (;;) {
          const t = u8();
          if (t === 0) break;
          const name = str();
          obj[name] = readPayload(t);
        }
        return obj;
      }
      case 11: {
        const n = i32();
        o += n * 4;
        return null;
      }
      case 12: {
        const n = i32();
        o += n * 8;
        return null;
      }
      default:
        throw new Error('NBT-Typ unbekannt');
    }
  };
  try {
    const t = u8();
    if (t !== 10) return [];
    str();
    const root = readPayload(10);
    return (root.servers || []).map((s) => ({ name: s.name, ip: s.ip })).filter((s) => s.ip);
  } catch {
    return [];
  }
}

module.exports = { Instances, ICONS, META_DIR, LEGACY_META_DIRS, parseServersDat };
