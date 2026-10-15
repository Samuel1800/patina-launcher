'use strict';
// Launcher-Einstellungen.
const os = require('os');
const crypto = require('crypto');
const { readJson, writeJson } = require('./fsutil');
const { defaultDataRoot } = require('./paths');

function defaultMemory() {
  const gb = os.totalmem() / 1024 ** 3;
  if (gb >= 30) return 8192;
  if (gb >= 15) return 6144;
  if (gb >= 7) return 4096;
  return 2048;
}

const DEFAULTS = () => ({
  dataRoot: defaultDataRoot(),
  memoryMax: defaultMemory(),
  memoryMin: 1024,
  jvmArgs: '',
  afterLaunch: 'hide', // hide | minimize | keep | close
  startupAction: 'library', // library | lastInstance
  showSnapshots: false,
  autoUpdateMods: false,
  prefetch: true,
  azureClientId: '',
  curseforgeApiKey: '',
  lastInstanceId: null,
  launcherClientId: crypto.randomUUID(),
  onboarded: false,
  backupWorldsOnUpgrade: true,
  defaultLoader: 'fabric',
  hideCfHint: false,
});

class Settings {
  constructor(file) {
    this.file = file;
    this.data = null;
  }
  async load() {
    if (this.data) return this.data;
    const saved = (await readJson(this.file)) || {};
    this.data = { ...DEFAULTS(), ...saved };
    if (!saved.launcherClientId) await this.save();
    return this.data;
  }
  get(k) {
    return this.data[k];
  }
  async set(patch) {
    await this.load();
    for (const [k, v] of Object.entries(patch || {})) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      this.data[k] = v;
    }
    await this.save();
    return this.data;
  }
  async save() {
    await writeJson(this.file, this.data);
  }
}

module.exports = { Settings, defaultMemory };
