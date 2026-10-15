'use strict';
// Test: Modrinth-App-Profile erkennen (neues + altes DB-Schema + profile.json) und importieren.
const assert = require('assert');
const path = require('path');
const fsp = require('fs').promises;
const { DatabaseSync } = require('node:sqlite');
const { scanModrinthApp } = require('../core/importers');
const { Core } = require('../core/app');

const ROOT = path.join(require('os').tmpdir(), 'patina-test-modrinth');
const JARS = process.env.PATINA_TEST_MODS;
if (!JARS) {
  console.log('Übersprungen: PATINA_TEST_MODS nicht gesetzt (Ordner mit den Fabric-26.2-Mods aus diesem Test).');
  process.exit(0);
}

async function profile(dir, name, jars) {
  const p = path.join(dir, 'profiles', name);
  await fsp.mkdir(path.join(p, 'mods'), { recursive: true });
  await fsp.mkdir(path.join(p, 'saves', 'Meine Welt'), { recursive: true });
  await fsp.writeFile(path.join(p, 'saves', 'Meine Welt', 'level.dat'), 'x');
  await fsp.writeFile(path.join(p, 'options.txt'), 'fov:0.5\n');
  for (const j of jars) await fsp.copyFile(path.join(JARS, j), path.join(p, 'mods', j));
  return p;
}

(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
  // A: neues Schema (seit 2026)
  const A = path.join(ROOT, 'ModrinthApp');
  await profile(A, 'Survival 26.2', ['sodium-fabric-0.9.1+mc26.2.jar', 'fabric-api-0.157.0+26.2.jar', 'iris-fabric-1.11.2+mc26.2.jar']);
  let db = new DatabaseSync(path.join(A, 'app.db'));
  db.exec(`CREATE TABLE settings (custom_dir TEXT NULL);
    INSERT INTO settings VALUES (NULL);
    CREATE TABLE instances (id TEXT, path TEXT, applied_content_set_id TEXT, install_stage TEXT, launcher_feature_version TEXT, name TEXT, icon_path TEXT, created INTEGER, modified INTEGER, last_played INTEGER);
    CREATE TABLE instance_content_sets (id TEXT, instance_id TEXT, name TEXT, source_kind TEXT, status TEXT, game_version TEXT, loader TEXT, loader_version TEXT, created INTEGER, modified INTEGER);
    INSERT INTO instances VALUES ('i1', 'Survival 26.2', 'c1', 'installed', '1', 'Survival mit Freunden', NULL, 0, 0, 1791900000);
    INSERT INTO instance_content_sets VALUES ('c1', 'i1', 'x', 'local', 'ok', '26.2', 'fabric', '0.19.3', 0, 0);`);
  db.close();
  // B: altes Schema (profiles)
  const B = path.join(ROOT, 'com.modrinth.theseus');
  await profile(B, 'Alt', ['Clumps-fabric-26.2-26.2.1.jar']);
  db = new DatabaseSync(path.join(B, 'app.db'));
  db.exec(`CREATE TABLE profiles (path TEXT, install_stage TEXT, name TEXT, game_version TEXT, mod_loader TEXT, mod_loader_version TEXT, last_played INTEGER, override_mc_memory_max INTEGER);
    INSERT INTO profiles VALUES ('Alt', 'installed', 'Altes Profil', '26.2', 'fabric', '0.19.3', NULL, 6144);`);
  db.close();
  // C: uraltes profile.json
  const C = path.join(ROOT, 'legacy');
  const cp = await profile(C, 'NeoTest', []);
  await fsp.writeFile(path.join(cp, 'profile.json'), JSON.stringify({ metadata: { name: 'Neo Profil', game_version: '1.21.1', loader: 'neoforge', loader_version: { id: '21.1.77' } } }));

  const list = await scanModrinthApp([A, B, C]);
  console.log(list.map((x) => `${x.name}: ${x.game} ${x.loader} ${x.loaderVersion} (${x.mods} Mods, ${x.worlds} Welten) ${x.lastPlayed || ''}`).join('\n'));
  assert.strictEqual(list.length, 3);
  const a = list.find((x) => x.name === 'Survival mit Freunden');
  assert(a && a.game === '26.2' && a.loader === 'fabric' && a.loaderVersion === '0.19.3' && a.mods === 3 && a.worlds === 1);
  const b = list.find((x) => x.name === 'Altes Profil');
  assert(b && b.memory === 6144 && b.mods === 1);
  const c = list.find((x) => x.name === 'Neo Profil');
  assert(c && c.loader === 'neoforge' && c.loaderVersion === '21.1.77');

  // Import über den Kern
  await fsp.mkdir(path.join(ROOT, 'user'), { recursive: true });
  await fsp.writeFile(path.join(ROOT, 'user', 'settings.json'), JSON.stringify({ dataRoot: path.join(ROOT, 'data'), prefetch: false }));
  const core = new Core({ userDir: path.join(ROOT, 'user'), crypt: { encrypt: (s) => s, decrypt: (s) => s } });
  await core.init();
  const ids = await core.importInstances([a], { includeWorlds: true });
  const inst = await core.getInstance(ids[0]);
  const mods = (await core.listContent(ids[0], 'mod')).items;
  console.log('Importiert:', inst.name, inst.game, inst.loader, inst.loaderVersion, '| Mods:', mods.map((m) => `${m.title}${m.projectId ? '' : ' (?)'}`).join(', '));
  assert.strictEqual(mods.filter((m) => m.projectId).length, 3);
  const opts = await fsp.readFile(path.join(inst.dir, 'options.txt'), 'utf8');
  assert(opts.includes('fov:0.5'));
  const scan2 = (await core.scanModrinth([A])).find((x) => x.path === a.path);
  assert(scan2.alreadyImported);
  core.dispose();
  console.log('\nModrinth-Import OK ✅');
  process.exit(0);
})().catch((e) => {
  console.error('FEHLER ❌', e);
  process.exit(1);
});
