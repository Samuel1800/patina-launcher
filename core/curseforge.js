'use strict';
// CurseForge (optional, braucht einen eigenen API-Schlüssel von console.curseforge.com).
// Ohne Schlüssel werden CurseForge-Mods aus Importen trotzdem mit Namen/Icon angezeigt.
const fsp = require('fs').promises;
const http = require('./http');

const API = 'https://api.curseforge.com';
const GAME_ID = 432; // Minecraft
const LOADER_TYPES = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const REL = { required: 3, incompatible: 5 };

/** MurmurHash2 (32 bit, Seed 1) über die Datei ohne Whitespace-Bytes – CurseForge-Fingerprint. */
function murmur2(buf, seed = 1) {
  const m = 0x5bd1e995;
  let len = buf.length;
  let h = (seed ^ len) >>> 0;
  let i = 0;
  while (len >= 4) {
    let k = buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24);
    k = Math.imul(k, m);
    k ^= k >>> 24;
    k = Math.imul(k, m);
    h = Math.imul(h, m) ^ k;
    i += 4;
    len -= 4;
  }
  switch (len) {
    case 3:
      h ^= buf[i + 2] << 16;
    // falls through
    case 2:
      h ^= buf[i + 1] << 8;
    // falls through
    case 1:
      h ^= buf[i];
      h = Math.imul(h, m);
  }
  h ^= h >>> 13;
  h = Math.imul(h, m);
  h ^= h >>> 15;
  return h >>> 0;
}

function fingerprintBuffer(data) {
  const out = Buffer.allocUnsafe(data.length);
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b !== 9 && b !== 10 && b !== 13 && b !== 32) out[n++] = b;
  }
  return murmur2(out.subarray(0, n), 1);
}

async function fingerprintFile(file) {
  return fingerprintBuffer(await fsp.readFile(file));
}

/** Neueste Datei bevorzugt als Release (1), dann Beta (2), dann Alpha (3). */
function pickFile(files) {
  if (!files || !files.length) return null;
  const sorted = files.filter((f) => f.isAvailable !== false && !f.isServerPack).sort((a, b) => String(b.fileDate).localeCompare(String(a.fileDate)));
  return sorted.find((f) => f.releaseType === 1) || sorted.find((f) => f.releaseType === 2) || sorted[0] || null;
}

class CurseForge {
  constructor({ apiKey = () => '', log = () => {} } = {}) {
    this.apiKey = apiKey;
    this.log = log;
    this.cache = new Map();
  }

  enabled() {
    return Boolean(this.apiKey() && this.apiKey().trim());
  }

  async _req(path, { method = 'GET', json, ttl = 5 * 60e3 } = {}) {
    if (!this.enabled()) {
      const e = new Error('Kein CurseForge-API-Schlüssel hinterlegt.');
      e.code = 'CF_NO_KEY';
      throw e;
    }
    const key = `${method} ${path} ${json ? JSON.stringify(json) : ''}`;
    const c = this.cache.get(key);
    if (c && Date.now() - c.t < ttl) return c.v;
    try {
      const r = await http.getJson(`${API}${path}`, { method, json, headers: { 'x-api-key': this.apiKey().trim(), Accept: 'application/json' }, timeout: 20000 });
      this.cache.set(key, { t: Date.now(), v: r.data });
      return r.data;
    } catch (e) {
      if (e.status === 403 || e.status === 401) {
        const err = new Error('CurseForge hat den API-Schlüssel abgelehnt.');
        err.code = 'CF_KEY_INVALID';
        throw err;
      }
      throw e;
    }
  }

  /** Dateien eines Projekts für Version + Loader. */
  async files(modId, { gameVersion, loader } = {}) {
    const q = new URLSearchParams({ pageSize: '50' });
    if (gameVersion) q.set('gameVersion', gameVersion);
    if (loader && LOADER_TYPES[loader]) q.set('modLoaderType', String(LOADER_TYPES[loader]));
    return this._req(`/v1/mods/${modId}/files?${q.toString()}`);
  }

  async file(modId, fileId) {
    return this._req(`/v1/mods/${modId}/files/${fileId}`, { ttl: 60 * 60e3 });
  }

  async mods(ids) {
    if (!ids.length) return [];
    return this._req('/v1/mods', { method: 'POST', json: { modIds: ids.map(Number), filterPcOnly: true }, ttl: 30 * 60e3 });
  }

  /** {fingerprint: {modId, file}} */
  async matchFingerprints(fps) {
    if (!fps.length) return {};
    const data = await this._req(`/v1/fingerprints/${GAME_ID}`, { method: 'POST', json: { fingerprints: fps } });
    const out = {};
    for (const m of data.exactMatches || []) out[m.file.fileFingerprint] = { modId: m.id, file: m.file };
    return out;
  }

  /** Beste kompatible Datei oder null. */
  async compatibleFile(modId, { gameVersion, loader }) {
    const list = await this.files(modId, { gameVersion, loader });
    // Loader-Filter der API ist manchmal lückenhaft: zusätzlich über gameVersions prüfen
    const names = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };
    const filtered = list.filter((f) => (!gameVersion || (f.gameVersions || []).includes(gameVersion)) && (!loader || !names[loader] || (f.gameVersions || []).some((g) => g === names[loader] || (loader === 'quilt' && g === 'Fabric'))));
    return pickFile(filtered.length ? filtered : []);
  }
}

module.exports = { CurseForge, murmur2, fingerprintBuffer, fingerprintFile, pickFile, LOADER_TYPES, REL };
