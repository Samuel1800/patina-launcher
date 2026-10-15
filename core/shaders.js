'use strict';
// Shader: richtet Iris/Oculus (+Sodium/Embeddium) automatisch ein und aktiviert ein Shaderpack.
const fsp = require('fs').promises;
const path = require('path');
const { exists, ensureDir } = require('./fsutil');

// Reihenfolge = Bevorzugung
const SHADER_MODS = {
  fabric: ['iris'],
  quilt: ['iris'],
  neoforge: ['iris', 'oculus'],
  forge: ['oculus'],
};

const CONFIG_FILES = {
  iris: 'iris.properties',
  oculus: 'oculus.properties',
};

async function readProps(file) {
  try {
    const txt = await fsp.readFile(file, 'utf8');
    const map = new Map();
    for (const line of txt.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i > 0) map.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
    return map;
  } catch {
    return new Map();
  }
}

async function writeProps(file, map) {
  await ensureDir(path.dirname(file));
  const lines = ['#Patina', ...[...map.entries()].map(([k, v]) => `${k}=${v}`)];
  await fsp.writeFile(file, lines.join('\n') + '\n', 'utf8');
}

class Shaders {
  constructor({ content, modrinth, log = () => {} }) {
    this.content = content;
    this.modrinth = modrinth;
    this.log = log;
  }

  /** Welcher Shader-Mod ist installiert? */
  async installedShaderMod(inst) {
    const mods = await this.content.scan(inst, ['mod'], { identify: true });
    for (const m of mods) {
      const id = String(m.modId || m.slug || '').toLowerCase();
      if (!m.enabled) continue;
      if (id === 'iris' || m.slug === 'iris' || /^iris[-_]/i.test(m.file)) return 'iris';
      if (id === 'oculus' || m.slug === 'oculus' || /^oculus[-_]/i.test(m.file)) return 'oculus';
    }
    return null;
  }

  /** Status für die UI. */
  async status(inst) {
    if (inst.loader === 'vanilla') return { supported: false, reason: 'vanilla', mod: null };
    const mod = await this.installedShaderMod(inst);
    if (mod) return { supported: true, mod, ready: true };
    const candidates = SHADER_MODS[inst.loader] || [];
    for (const slug of candidates) {
      try {
        const v = await this.content.compatibleVersion(inst, slug, 'mod');
        if (v) return { supported: true, mod: slug, ready: false };
      } catch {}
    }
    return { supported: false, reason: 'unavailable', mod: null };
  }

  /** Installiert den Shader-Mod, falls nötig. */
  async ensureSupport(inst, { progress } = {}) {
    if (inst.loader === 'vanilla') {
      const e = new Error('Shader brauchen einen Modloader. Stell die Instanz auf Fabric um – das geht mit einem Klick.');
      e.code = 'NEEDS_LOADER';
      throw e;
    }
    const have = await this.installedShaderMod(inst);
    if (have) return { mod: have, installed: [] };
    const candidates = SHADER_MODS[inst.loader] || [];
    let lastErr;
    for (const slug of candidates) {
      try {
        const res = await this.content.install(inst, slug, { kind: 'mod', progress });
        return { mod: slug, installed: res.installed, warnings: res.warnings };
      } catch (e) {
        lastErr = e;
      }
    }
    const e = new Error(
      lastErr && lastErr.code === 'NO_VERSION'
        ? `Für Minecraft ${inst.game} mit ${inst.loader} gibt es noch keinen Shader-Mod (Iris/Oculus).`
        : lastErr
        ? lastErr.message
        : 'Kein Shader-Mod verfügbar.'
    );
    e.code = 'NO_SHADER_MOD';
    throw e;
  }

  configFile(inst, mod) {
    return path.join(inst._dir, 'config', CONFIG_FILES[mod] || CONFIG_FILES.iris);
  }

  async active(inst) {
    for (const mod of ['iris', 'oculus']) {
      const f = this.configFile(inst, mod);
      if (!(await exists(f))) continue;
      const p = await readProps(f);
      if (p.get('enableShaders') === 'false') return null;
      const sp = p.get('shaderPack');
      if (sp) return sp;
    }
    return null;
  }

  /** Aktiviert ein Shaderpack (fileName) oder schaltet Shader aus (null). */
  async activate(inst, fileName) {
    const mod = (await this.installedShaderMod(inst)) || 'iris';
    for (const m of new Set([mod, ...(mod === 'iris' ? [] : ['iris'])])) {
      const f = this.configFile(inst, m);
      if (m !== mod && !(await exists(f))) continue;
      const p = await readProps(f);
      if (fileName) {
        p.set('shaderPack', fileName);
        p.set('enableShaders', 'true');
      } else {
        p.set('enableShaders', 'false');
      }
      await writeProps(f, p);
    }
  }

  /** Shaderpack installieren + Shader-Mod einrichten + aktivieren. */
  async installAndActivate(inst, projectId, { versionId, progress, activate = true } = {}) {
    try {
      projectId = (await this.modrinth.project(projectId)).id;
    } catch {}
    const support = await this.ensureSupport(inst, { progress });
    const res = await this.content.install(inst, projectId, { kind: 'shader', versionId, progress });
    const items = await this.content.scan(inst, ['shader'], { identify: false });
    const pack = items.find((i) => i.projectId === projectId);
    const packFile = pack ? pack.file.replace(/\.disabled$/, '') : null;
    if (activate && packFile) await this.activate(inst, packFile);
    return { pack: packFile, support, installed: [...(support.installed || []), ...res.installed], warnings: [...(support.warnings || []), ...res.warnings] };
  }
}

module.exports = { Shaders, SHADER_MODS };
