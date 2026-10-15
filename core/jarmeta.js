'use strict';
// Liest Mod-Metadaten (Name, ID, Version, Icon) direkt aus einer JAR.
const AdmZip = require('adm-zip');

function tomlValue(block, key) {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'm').exec(block);
  return m ? m[1] !== undefined ? m[1] : m[2] : undefined;
}

function parseModsToml(txt) {
  const modsIdx = txt.search(/^\s*\[\[mods\]\]/m);
  const block = modsIdx >= 0 ? txt.slice(modsIdx).split(/^\s*\[\[(?!mods\]\])/m)[0] : txt;
  const logo = tomlValue(txt, 'logoFile') || tomlValue(block, 'logoFile');
  return {
    id: tomlValue(block, 'modId'),
    name: tomlValue(block, 'displayName'),
    version: tomlValue(block, 'version'),
    icon: logo,
  };
}

/**
 * @returns {{loader:string, id:string, name:string, version:string, iconData:Buffer|null}|null}
 */
function readModMeta(file) {
  let zip;
  try {
    zip = new AdmZip(file);
  } catch {
    return null;
  }
  const text = (name) => {
    const e = zip.getEntry(name);
    return e ? e.getData().toString('utf8').replace(/^﻿/, '') : null;
  };
  const iconOf = (p) => {
    if (!p) return null;
    const e = zip.getEntry(String(p).replace(/^\//, ''));
    if (!e || e.header.size > 256 * 1024) return null;
    return e.getData();
  };
  try {
    const fab = text('fabric.mod.json');
    if (fab) {
      const j = JSON.parse(fab.replace(/[\u0000-\u0019]+/g, ' '));
      let icon = j.icon;
      if (icon && typeof icon === 'object') icon = icon[Object.keys(icon).sort((a, b) => Number(b) - Number(a))[0]];
      return { loader: 'fabric', id: j.id, name: j.name || j.id, version: j.version, iconData: iconOf(icon) };
    }
    const q = text('quilt.mod.json');
    if (q) {
      const j = JSON.parse(q).quilt_loader || {};
      const md = j.metadata || {};
      let icon = md.icon;
      if (icon && typeof icon === 'object') icon = icon[Object.keys(icon)[0]];
      return { loader: 'quilt', id: j.id, name: md.name || j.id, version: j.version, iconData: iconOf(icon) };
    }
    for (const [name, loader] of [
      ['META-INF/neoforge.mods.toml', 'neoforge'],
      ['META-INF/mods.toml', 'forge'],
    ]) {
      const t = text(name);
      if (t) {
        const m = parseModsToml(t);
        if (m.version === '${file.jarVersion}' || !m.version) {
          const mf = text('META-INF/MANIFEST.MF') || '';
          const iv = /Implementation-Version:\s*(.+)/.exec(mf);
          m.version = iv ? iv[1].trim() : m.version;
        }
        return { loader, id: m.id, name: m.name || m.id, version: m.version, iconData: iconOf(m.icon) };
      }
    }
    const mc = text('mcmod.info');
    if (mc) {
      let j = JSON.parse(mc);
      if (!Array.isArray(j)) j = j.modList || [];
      const m = j[0] || {};
      return { loader: 'forge', id: m.modid, name: m.name || m.modid, version: m.version, iconData: iconOf(m.logoFile) };
    }
  } catch {
    return null;
  }
  return null;
}

/** Name/Icon aus pack.mcmeta + pack.png (Ressourcen-/Shaderpakete als ZIP). */
function readPackMeta(file) {
  try {
    const zip = new AdmZip(file);
    const png = zip.getEntry('pack.png');
    const meta = zip.getEntry('pack.mcmeta');
    let description = null;
    if (meta) {
      try {
        const j = JSON.parse(meta.getData().toString('utf8').replace(/^﻿/, ''));
        const d = j.pack && j.pack.description;
        description = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => (typeof x === 'string' ? x : x.text || '')).join('') : d && d.text;
      } catch {}
    }
    return { iconData: png && png.header.size < 512 * 1024 ? png.getData() : null, description };
  } catch {
    return null;
  }
}

module.exports = { readModMeta, readPackMeta, parseModsToml };
