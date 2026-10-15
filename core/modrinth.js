'use strict';
// Modrinth-API v2 (Mods, Shader, Ressourcenpakete, Modpacks).
const http = require('./http');

const API = 'https://api.modrinth.com/v2';

class Modrinth {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.cache = new Map();
  }

  async _get(path, ttl = 5 * 60e3) {
    const key = path;
    const c = this.cache.get(key);
    if (c && Date.now() - c.t < ttl) return c.v;
    const v = await http.getJson(`${API}${path}`, { timeout: 20000 });
    this.cache.set(key, { t: Date.now(), v });
    if (this.cache.size > 800) this.cache.delete(this.cache.keys().next().value);
    return v;
  }

  /**
   * Suche.
   * @param {object} q {query, type:'mod'|'shader'|'resourcepack'|'modpack', gameVersion, loaders:[], categories:[], index, offset, limit}
   */
  async search(q = {}) {
    const facets = [[`project_type:${q.type || 'mod'}`]];
    if (q.gameVersion) facets.push([`versions:${q.gameVersion}`]);
    if (q.loaders && q.loaders.length) facets.push(q.loaders.map((l) => `categories:${l}`));
    for (const c of q.categories || []) facets.push([`categories:${c}`]);
    if (q.clientOnly !== false && (q.type === 'mod' || !q.type)) facets.push(['client_side:required', 'client_side:optional']);
    const params = new URLSearchParams({
      query: q.query || '',
      facets: JSON.stringify(facets),
      index: q.index || (q.query ? 'relevance' : 'downloads'),
      offset: String(q.offset || 0),
      limit: String(Math.min(q.limit || 24, 100)),
    });
    const r = await this._get(`/search?${params.toString()}`, 2 * 60e3);
    return {
      total: r.total_hits,
      offset: r.offset,
      hits: r.hits.map((h) => ({
        id: h.project_id,
        slug: h.slug,
        title: h.title,
        description: h.description,
        author: h.author,
        icon: h.icon_url,
        downloads: h.downloads,
        follows: h.follows,
        categories: h.display_categories || h.categories,
        type: h.project_type,
        versions: h.versions,
        updated: h.date_modified,
        gallery: h.featured_gallery || (h.gallery && h.gallery[0]) || null,
        color: h.color,
      })),
    };
  }

  project(idOrSlug) {
    return this._get(`/project/${encodeURIComponent(idOrSlug)}`, 10 * 60e3);
  }

  async projects(ids) {
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80);
      out.push(...(await this._get(`/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`, 10 * 60e3)));
    }
    return out;
  }

  /** Versionen eines Projekts (neueste zuerst), optional gefiltert. */
  async versions(projectId, { loaders, gameVersions } = {}) {
    const p = new URLSearchParams();
    if (loaders && loaders.length) p.set('loaders', JSON.stringify(loaders));
    if (gameVersions && gameVersions.length) p.set('game_versions', JSON.stringify(gameVersions));
    const qs = p.toString();
    return this._get(`/project/${encodeURIComponent(projectId)}/version${qs ? `?${qs}` : ''}`, 3 * 60e3);
  }

  version(id) {
    return this._get(`/version/${encodeURIComponent(id)}`, 30 * 60e3);
  }

  /** Datei-Hashes -> Versionen ({hash: version}). */
  async identify(hashes, algorithm = 'sha1') {
    if (!hashes.length) return {};
    const out = {};
    for (let i = 0; i < hashes.length; i += 500) {
      const r = await http.getJson(`${API}/version_files`, {
        method: 'POST',
        json: { hashes: hashes.slice(i, i + 500), algorithm },
        timeout: 30000,
      });
      Object.assign(out, r);
    }
    return out;
  }

  /** Neueste passende Version je Datei-Hash ({hash: version}). */
  async latestForHashes(hashes, { loaders, gameVersions }, algorithm = 'sha1') {
    if (!hashes.length) return {};
    const out = {};
    for (let i = 0; i < hashes.length; i += 500) {
      const body = { hashes: hashes.slice(i, i + 500), algorithm };
      if (loaders && loaders.length) body.loaders = loaders;
      if (gameVersions && gameVersions.length) body.game_versions = gameVersions;
      const r = await http.getJson(`${API}/version_files/update`, { method: 'POST', json: body, timeout: 30000 });
      Object.assign(out, r);
    }
    return out;
  }

  async gameVersionTags() {
    return this._get('/tag/game_version', 60 * 60e3);
  }
}

/** Beste Version aus einer Liste (Release bevorzugt, sonst Beta, sonst Alpha). */
function pickVersion(list, { allowUnstable = true } = {}) {
  if (!list || !list.length) return null;
  const rel = list.find((v) => v.version_type === 'release');
  if (rel) return rel;
  if (!allowUnstable) return null;
  return list.find((v) => v.version_type === 'beta') || list[0];
}

function primaryFile(version) {
  return (version.files || []).find((f) => f.primary) || (version.files || [])[0] || null;
}

module.exports = { Modrinth, pickVersion, primaryFile, API };
