'use strict';
// Dateisystem-Helfer: atomares JSON, Kopieren, Größen.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

async function readJson(file, fallback = null) {
  try {
    const txt = await fsp.readFile(file, 'utf8');
    return JSON.parse(txt.replace(/^﻿/, ''));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    if (e instanceof SyntaxError) {
      // kaputte Datei sichern statt alles zu verlieren
      await fsp.copyFile(file, `${file}.broken-${Date.now()}`).catch(() => {});
      return fallback;
    }
    throw e;
  }
}

const writeLocks = new Map();
async function writeJson(file, data) {
  // serialisiert Schreibzugriffe pro Datei, schreibt atomar
  const prev = writeLocks.get(file) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    try {
      await fsp.rename(tmp, file);
    } catch (e) {
      await fsp.copyFile(tmp, file);
      await fsp.rm(tmp, { force: true });
    }
  });
  writeLocks.set(file, next);
  try {
    await next;
  } finally {
    if (writeLocks.get(file) === next) writeLocks.delete(file);
  }
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
  return p;
}

/** Rekursiv kopieren mit Filter (relativer Pfad -> bool). */
async function copyDir(src, dest, { filter, onFile } = {}) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (filter && !filter(s, e)) continue;
    if (e.isDirectory()) {
      await copyDir(s, d, { filter, onFile });
    } else if (e.isFile()) {
      await fsp.copyFile(s, d);
      if (onFile) onFile(s, d);
    }
  }
}

async function dirSize(p) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(p, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) total += await dirSize(f);
    else if (e.isFile()) {
      try {
        total += (await fsp.stat(f)).size;
      } catch {}
    }
  }
  return total;
}

async function listDir(p) {
  try {
    return await fsp.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Erlaubte Datei-/Ordnernamen (Windows-sicher). */
function safeName(name, fallback = 'Instanz') {
  const n = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 64);
  if (!n || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) return fallback;
  return n;
}

async function uniqueDir(parent, base) {
  let name = base;
  let i = 2;
  while (await exists(path.join(parent, name))) name = `${base} (${i++})`;
  return name;
}

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** true, wenn target wirklich innerhalb von base liegt (kein ../, kein Nachbarordner mit gleichem Präfix). */
function isInside(base, target) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

module.exports = { readJson, writeJson, exists, ensureDir, copyDir, dirSize, listDir, safeName, uniqueDir, formatBytes, isInside };
