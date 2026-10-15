'use strict';
// Ordnerstruktur des Datenverzeichnisses (gleich aufgebaut wie .minecraft,
// damit Forge-/NeoForge-Installer direkt hineininstallieren können).
const path = require('path');
const os = require('os');

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}

function defaultDataRoot() {
  if (process.platform === 'win32') return path.join(appDataDir(), '.patina');
  if (process.platform === 'darwin') return path.join(appDataDir(), 'Patina');
  return path.join(appDataDir(), 'patina');
}

/** Datenordner der Vorgängerversion (hieß „Blockwerk“). */
function legacyDataRoot() {
  if (process.platform === 'win32') return path.join(appDataDir(), '.blockwerk');
  if (process.platform === 'darwin') return path.join(appDataDir(), 'Blockwerk');
  return path.join(appDataDir(), 'blockwerk');
}

function createPaths(root) {
  const p = {
    root,
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    runtime: path.join(root, 'runtime'),
    instances: path.join(root, 'instances'),
    cache: path.join(root, 'cache'),
    natives: path.join(root, 'natives'),
    logs: path.join(root, 'logs'),
    temp: path.join(root, 'temp'),
  };
  p.versionDir = (id) => path.join(p.versions, id);
  p.versionJson = (id) => path.join(p.versions, id, `${id}.json`);
  p.versionJar = (id) => path.join(p.versions, id, `${id}.jar`);
  p.assetIndex = (id) => path.join(p.assets, 'indexes', `${id}.json`);
  p.assetObject = (hash) => path.join(p.assets, 'objects', hash.slice(0, 2), hash);
  p.logConfig = (id) => path.join(p.assets, 'log_configs', id);
  p.library = (rel) => path.join(p.libraries, ...rel.split('/'));
  return p;
}

module.exports = { createPaths, defaultDataRoot, legacyDataRoot, appDataDir };
