'use strict';
// Test: Umzug von „Blockwerk“ zu „Patina“ – Benutzerordner, Spieldaten, Instanz-Metadaten, Loader-/Java-Marker.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fsp = fs.promises;

const ROOT = path.join(require('os').tmpdir(), 'patina-test-migration');
process.env.XDG_DATA_HOME = path.join(ROOT, 'xdg');
const { defaultDataRoot, legacyDataRoot } = require('../core/paths');
const migrate = require('../electron/migrate');
const { Core } = require('../core/app');

function fakeApp(appData) {
  const p = { appData, userData: path.join(appData, 'Patina') };
  return { getPath: (k) => p[k], setPath: (k, v) => (p[k] = v), getName: () => 'Patina', _p: p };
}

(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
  const appData = path.join(ROOT, 'appdata');
  const legacyUser = path.join(appData, 'Blockwerk');
  const legacyRoot = legacyDataRoot();
  const newRoot = defaultDataRoot();
  assert(legacyRoot.endsWith('blockwerk') && newRoot.endsWith('patina'), `${legacyRoot} / ${newRoot}`);

  // --- alter Zustand nach Blockwerk 1.0: Benutzerordner „Blockwerk“, Spieldaten im Standardordner
  await fsp.mkdir(legacyUser, { recursive: true });
  await fsp.writeFile(path.join(legacyUser, 'settings.json'), JSON.stringify({ dataRoot: legacyRoot, onboarded: true, memoryMax: 6144, prefetch: false }));
  await fsp.writeFile(path.join(legacyUser, 'accounts.json'), JSON.stringify({ active: 'x', list: [] }));
  const instDir = path.join(legacyRoot, 'instances', 'Survival');
  await fsp.mkdir(path.join(instDir, '.blockwerk', 'backups', 'b1'), { recursive: true });
  await fsp.mkdir(path.join(instDir, 'mods'), { recursive: true });
  await fsp.writeFile(path.join(instDir, '.blockwerk', 'instance.json'), JSON.stringify({ id: 'abc-123', name: 'Survival', game: '26.2', loader: 'fabric', loaderVersion: '0.19.3', icon: 'grass', created: '2026-06-01T00:00:00.000Z', lastPlayed: null, playTime: 3600, pending: [], history: [] }));
  await fsp.writeFile(path.join(instDir, '.blockwerk', 'backups', 'b1', 'backup.json'), JSON.stringify({ id: 'b1', at: '2026-10-01T00:00:00.000Z', game: '26.1', loader: 'fabric', loaderVersion: '0.19.0', includesWorlds: false, reason: 'upgrade' }));
  await fsp.mkdir(path.join(legacyRoot, 'versions'), { recursive: true });
  await fsp.writeFile(path.join(legacyRoot, 'versions', '.blockwerk-loaders.json'), JSON.stringify({ 'fabric-loader-0.19.3-26.2': { ok: true } }));

  // 1) Benutzerordner: alter Ordner wird weiterverwendet (Anmeldung bleibt gültig)
  const app = fakeApp(appData);
  const chosen = migrate.chooseUserDataDir(app);
  assert.strictEqual(chosen.legacy, true);
  assert.strictEqual(app._p.userData, legacyUser);

  // 2) Spieldaten-Ordner wird umbenannt und die Einstellung angepasst
  const r = migrate.migrateDataRoot(path.join(legacyUser, 'settings.json'), { legacyRoot, newRoot });
  assert.strictEqual(r, newRoot);
  assert(!fs.existsSync(legacyRoot) && fs.existsSync(newRoot));
  const s = JSON.parse(await fsp.readFile(path.join(legacyUser, 'settings.json'), 'utf8'));
  assert.strictEqual(s.dataRoot, newRoot);
  assert.strictEqual(s.memoryMax, 6144, 'andere Einstellungen bleiben erhalten');
  // zweiter Start: nichts passiert
  assert.strictEqual(migrate.migrateDataRoot(path.join(legacyUser, 'settings.json'), { legacyRoot, newRoot }), newRoot);

  // 3) Kern startet, Instanz-Metadaten ziehen um, Sicherungen bleiben sichtbar
  const core = new Core({ userDir: legacyUser, crypt: { encrypt: (x) => x, decrypt: (x) => x } });
  await core.init();
  const list = await core.listInstances();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'abc-123');
  assert.strictEqual(list[0].playTime, 3600);
  const newInst = path.join(newRoot, 'instances', 'Survival');
  assert(fs.existsSync(path.join(newInst, '.patina', 'instance.json')));
  assert(!fs.existsSync(path.join(newInst, '.blockwerk')));
  const backups = await core.backups('abc-123');
  assert.strictEqual(backups.length, 1);
  core.dispose();

  // 4) Eigener Spieldaten-Ordner (z. B. D:\Spiele) bleibt unangetastet
  const custom = path.join(ROOT, 'custom');
  const u2 = path.join(ROOT, 'u2');
  await fsp.mkdir(u2, { recursive: true });
  await fsp.writeFile(path.join(u2, 'settings.json'), JSON.stringify({ dataRoot: custom }));
  assert.strictEqual(migrate.migrateDataRoot(path.join(u2, 'settings.json'), { legacyRoot, newRoot }), custom);

  // 5) Neuinstallation ohne alten Ordner: neuer Benutzerordner
  const app2 = fakeApp(path.join(ROOT, 'leer'));
  assert.strictEqual(migrate.chooseUserDataDir(app2).legacy, false);

  // 6) Wenn der neue Ordner schon Einstellungen hat, gewinnt er
  const app3dir = path.join(ROOT, 'beide');
  await fsp.mkdir(path.join(app3dir, 'Blockwerk'), { recursive: true });
  await fsp.mkdir(path.join(app3dir, 'Patina'), { recursive: true });
  await fsp.writeFile(path.join(app3dir, 'Blockwerk', 'settings.json'), '{}');
  await fsp.writeFile(path.join(app3dir, 'Patina', 'settings.json'), '{}');
  const app3 = fakeApp(app3dir);
  assert.strictEqual(migrate.chooseUserDataDir(app3).legacy, false);

  // 7) Verknüpfungen: alte Blockwerk.lnk weg, Instanz-Verknüpfung umgebogen
  const desk = path.join(ROOT, 'desk');
  await fsp.mkdir(desk, { recursive: true });
  const links = {
    [path.join(desk, 'Blockwerk.lnk')]: { target: 'C:\\x\\Blockwerk.exe', args: '' },
    [path.join(desk, 'Survival.lnk')]: { target: 'C:\\x\\Blockwerk.exe', args: '--launch abc-123' },
    [path.join(desk, 'Discord.lnk')]: { target: 'C:\\d\\Discord.exe', args: '' },
  };
  for (const f of Object.keys(links)) await fsp.writeFile(f, '');
  const written = {};
  const shell = {
    readShortcutLink: (f) => ({ ...links[f] }),
    writeShortcutLink: (f, op, o) => ((written[f] = o), true),
  };
  const res = migrate.migrateShortcuts({ shell, desktop: desk, startMenu: path.join(ROOT, 'nope'), exePath: 'C:\\y\\Patina.exe', appUserModelId: 'de.samuelerk.patina' });
  console.log('Verknüpfungen:', res, Object.keys(written).map((f) => path.basename(f)));
  assert(!fs.existsSync(path.join(desk, 'Blockwerk.lnk')), 'alte App-Verknüpfung entfernt');
  assert(fs.existsSync(path.join(desk, 'Discord.lnk')), 'fremde Verknüpfung bleibt');
  const w = written[path.join(desk, 'Survival.lnk')];
  assert(w && w.target === 'C:\\y\\Patina.exe' && w.args === '--launch abc-123');

  console.log('\nMigration Blockwerk -> Patina OK ✅');
  process.exit(0);
})().catch((e) => {
  console.error('FEHLER ❌', e);
  process.exit(1);
});
