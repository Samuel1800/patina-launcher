'use strict';
// Test: NoRisk-Client-Launcher (v3) – Profile aus app.db und altem profiles.json, gemeinsamer Standard-Ordner, Mod-Übernahme.
// Aufbau nachgebaut nach dem offenen Quellcode des NoRisk-Launchers (github.com/NoRiskClient/noriskclient-launcher).
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { DatabaseSync } = require('node:sqlite');
const { Core } = require('../core/app');

const ROOT = path.join(require('os').tmpdir(), 'patina-test-norisk');
const JARS = process.env.PATINA_TEST_MODS;
if (!JARS) {
  console.log('Übersprungen: PATINA_TEST_MODS nicht gesetzt (Ordner mit den Fabric-26.2-Mods aus diesem Test).');
  process.exit(0);
}
const jar = (name) => path.join(JARS, name);

async function put(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (Buffer.isBuffer(content) || typeof content === 'string') await fsp.writeFile(file, content);
}
async function cp(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}
const ns = (iso) => BigInt(new Date(iso).getTime()) * 1000000n;

(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });

  // ---------- A: aktueller Launcher (app.db) – Windows-Aufbau root/meta + root/data/profiles
  const A = path.join(ROOT, 'norisk', 'NoRiskClientV3');
  const prof = path.join(A, 'data', 'profiles');
  // Profil 1: eigenes Fabric-Profil
  const p1 = path.join(prof, 'pvp-profil');
  await put(path.join(p1, 'options.txt'), 'fov:0.75\nguiScale:2\n');
  await put(path.join(p1, 'saves', 'PvP Welt', 'level.dat'), 'x');
  await put(path.join(p1, 'config', 'sodium-options.json'), '{"quality":{}}');
  await put(path.join(p1, 'noriskclient', 'cosmetics.json'), '{}'); // NoRisk-intern -> nicht übernehmen
  await cp(jar('fabric-api-0.157.0+26.2.jar'), path.join(p1, 'mods', 'nrc-26.2-fabric', 'fabric-api-0.157.0+26.2.jar'));
  await cp(jar('iris-fabric-1.11.2+mc26.2.jar'), path.join(p1, 'mods', 'nrc-26.2-fabric', 'iris-fabric-1.11.2+mc26.2.jar'));
  await cp(jar('Clumps-fabric-26.2-26.2.1.jar'), path.join(p1, 'mods', 'nrc-26.2-fabric', 'nrc-client-26.2-1.0.0.jar')); // NoRisk-Client-Mod
  await cp(jar('Clumps-fabric-26.2-26.2.1.jar'), path.join(p1, 'mods', 'nrc-26.2-fabric', 'norisk-fabric-utils-1.2.jar'));
  await cp(jar('spark-1.10.173-fabric.jar'), path.join(p1, 'custom_mods', 'spark-1.10.173-fabric.jar'));
  await cp(jar('MouseTweaks-fabric-mc26.2-2.31.jar'), path.join(p1, 'mods', 'MouseTweaks-fabric-mc26.2-2.31.jar')); // lose Datei
  // nur im Mod-Cache (Profil wurde nach dem Hinzufügen noch nicht gestartet)
  await cp(jar('sodium-fabric-0.9.1+mc26.2.jar'), path.join(A, 'meta', 'mod_cache', 'sodium-fabric-0.9.1+mc26.2.jar'));
  await cp(jar('entityculling-fabric-1.10.5-mc26.2.jar'), path.join(A, 'meta', 'mod_cache', 'entityculling-fabric-1.10.5-mc26.2.jar'));
  // Profil 2: gemeinsamer Gruppenordner
  const p2 = path.join(prof, 'groups', 'freunde');
  await put(path.join(p2, 'options.txt'), 'fov:0.5\n');
  await put(path.join(p2, 'saves', 'Freundeswelt', 'level.dat'), 'x');
  // Standard-Ordner der NoRisk-Versionen
  const std = path.join(prof, 'noriskclient', 'new');
  await put(path.join(std, 'options.txt'), 'fov:0.9\n');
  await put(path.join(std, 'saves', 'NoRisk Welt', 'level.dat'), 'x');
  await put(path.join(std, 'logs', 'latest.log'), '[12:00:01] [main/INFO]: Loading Minecraft 26.2 with Fabric Loader 0.19.3\n');
  await cp(jar('fabric-api-0.157.0+26.2.jar'), path.join(std, 'mods', 'nrc-26.2-fabric', 'fabric-api-0.157.0+26.2.jar'));
  await cp(jar('Clumps-fabric-26.2-26.2.1.jar'), path.join(std, 'mods', 'nrc-26.2-fabric', 'noriskclient-26.2.jar'));
  await put(path.join(A, 'norisk_versions.json'), JSON.stringify({ profiles: [{ id: 'x', name: 'NoRisk 26.2', path: 'noriskclient/new', game_version: '26.2', loader: 'fabric', loader_version: '0.19.3', group: 'NORISK CLIENT', is_standard_version: true }] }));

  await fsp.mkdir(path.join(A, 'meta'), { recursive: true });
  const db = new DatabaseSync(path.join(A, 'meta', 'app.db'));
  // Tabellen wie im NoRisk-Launcher (nur die Spalten, die Patina liest)
  db.exec(`CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL, game_version TEXT NOT NULL, loader TEXT NOT NULL, loader_version TEXT NULL,
      created INTEGER NOT NULL, last_played INTEGER NULL, group_name TEXT NULL, use_shared_minecraft_folder INTEGER NOT NULL DEFAULT 0, is_standard_version INTEGER NOT NULL DEFAULT 0,
      source_standard_profile_id TEXT NULL, playtime_seconds INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE profile_mods (profile_id TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL, source TEXT NOT NULL, source_type TEXT NOT NULL, project_id TEXT NULL,
      version_id TEXT NULL, file_name TEXT NULL, enabled INTEGER NOT NULL DEFAULT 1, display_name TEXT NULL, file_name_override TEXT NULL, PRIMARY KEY (profile_id, id));`);
  const ins = db.prepare('INSERT INTO profiles (id, name, path, game_version, loader, loader_version, created, last_played, group_name, use_shared_minecraft_folder, is_standard_version, playtime_seconds, settings) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  ins.run('11111111-2222-3333-4444-555555555555', 'PvP Profil', 'pvp-profil', '26.2', 'fabric', '0.19.3', ns('2026-06-01'), ns('2026-10-10T18:00:00Z'), null, 0, 0, 7200, JSON.stringify({ memory: { min: 1024, max: 6144 }, use_overwrite_loader_version: false }));
  ins.run('aaaaaaaa-2222-3333-4444-bbbbbbbbbbbb', 'Mit Freunden', 'mit-freunden', '26.2', 'fabric', '0.19.3', ns('2026-06-01'), null, 'Freunde', 1, 0, 0, '{}');
  const mod = db.prepare('INSERT INTO profile_mods (profile_id, id, ordinal, source, source_type, project_id, version_id, file_name, enabled) VALUES (?,?,?,?,?,?,?,?,?)');
  const mr = (file) => JSON.stringify({ type: 'modrinth', project_id: 'x', version_id: 'y', file_name: file, download_url: 'https://cdn.modrinth.com/x', file_hash_sha1: null });
  mod.run('11111111-2222-3333-4444-555555555555', 'm1', 0, mr('sodium-fabric-0.9.1+mc26.2.jar'), 'modrinth', 'AANobbMI', 'v', 'sodium-fabric-0.9.1+mc26.2.jar', 1);
  mod.run('11111111-2222-3333-4444-555555555555', 'm2', 1, mr('entityculling-fabric-1.10.5-mc26.2.jar'), 'modrinth', 'NNAgCjsB', 'v', 'entityculling-fabric-1.10.5-mc26.2.jar', 0); // deaktiviert
  mod.run('11111111-2222-3333-4444-555555555555', 'm3', 2, mr('iris-fabric-1.11.2+mc26.2.jar'), 'modrinth', 'YL57xq9U', 'v', 'iris-fabric-1.11.2+mc26.2.jar', 1);
  db.close();

  // ---------- B: älterer Launcher (profiles.json), Linux-Aufbau ohne data/
  const B = path.join(ROOT, 'alt');
  const pb = path.join(B, 'profiles', 'Mein Forge');
  await put(path.join(pb, 'options.txt'), 'fov:0.1\n');
  await put(path.join(pb, 'saves', 'Alte Welt', 'level.dat'), 'x');
  await put(path.join(B, 'profiles.json'), JSON.stringify([{ id: 'cccccccc-2222-3333-4444-dddddddddddd', name: 'Mein Forge', path: 'Mein Forge', game_version: '1.20.1', loader: 'forge', loader_version: '47.4.0', created: '2025-01-01T00:00:00Z', last_played: '2026-09-01T12:00:00Z', settings: { memory: { min: 1024, max: 4096 } }, mods: [], is_standard_version: false }]));
  await fsp.mkdir(path.join(B, 'meta'), { recursive: true });

  // ---------- Scan
  await fsp.mkdir(path.join(ROOT, 'user'), { recursive: true });
  await fsp.writeFile(path.join(ROOT, 'user', 'settings.json'), JSON.stringify({ dataRoot: path.join(ROOT, 'patina'), prefetch: false }));
  const core = new Core({ userDir: path.join(ROOT, 'user'), crypt: { encrypt: (s) => s, decrypt: (s) => s } });
  await core.init();
  const list = await core.scanNoRisk([A, B]);
  console.log(list.map((x) => `${x.name}: ${x.game} ${x.loader} ${x.loaderVersion} | ${x.mods} Mods, ${x.worlds} Welten | RAM ${x.memory} | ${x.lastPlayed || '-'}`).join('\n'));
  const pvp = list.find((x) => x.name === 'PvP Profil');
  assert(pvp, 'PvP-Profil gefunden');
  assert.strictEqual(pvp.game, '26.2');
  assert.strictEqual(pvp.loader, 'fabric');
  assert.strictEqual(pvp.loaderVersion, '0.19.3');
  assert.strictEqual(pvp.memory, 6144);
  assert.strictEqual(pvp.lastPlayed, '2026-10-10T18:00:00.000Z');
  assert.strictEqual(pvp.worlds, 1);
  const names = pvp.noriskMods.map((m) => m.name).sort();
  console.log('Mods PvP:', pvp.noriskMods.map((m) => `${m.name}${m.enabled ? '' : ' (aus)'}`).join(', '));
  assert(!names.some((n) => /nrc-client|norisk/i.test(n)), 'NoRisk-eigene Mods aussortiert');
  for (const n of ['fabric-api-0.157.0+26.2.jar', 'iris-fabric-1.11.2+mc26.2.jar', 'sodium-fabric-0.9.1+mc26.2.jar', 'entityculling-fabric-1.10.5-mc26.2.jar', 'spark-1.10.173-fabric.jar', 'MouseTweaks-fabric-mc26.2-2.31.jar']) assert(names.includes(n), `fehlt: ${n}`);
  assert.strictEqual(pvp.noriskMods.find((m) => m.name.startsWith('entityculling')).enabled, false, 'deaktivierte Mod bleibt deaktiviert');
  const group = list.find((x) => x.name === 'Mit Freunden');
  assert(group && group.path.endsWith(path.join('groups', 'freunde')), 'Gruppenordner erkannt');
  const stdItem = list.find((x) => x.name === 'NoRisk Client 26.2');
  assert(stdItem && stdItem.game === '26.2' && stdItem.loaderVersion === '0.19.3' && stdItem.worlds === 1, 'Standard-Ordner mit Version aus dem Log');
  assert.deepStrictEqual(stdItem.noriskMods.map((m) => m.name), ['fabric-api-0.157.0+26.2.jar']);
  const old = list.find((x) => x.name === 'Mein Forge');
  assert(old && old.game === '1.20.1' && old.loader === 'forge' && old.loaderVersion === '47.4.0' && old.memory === 4096 && old.lastPlayed === '2026-09-01T12:00:00.000Z', 'altes profiles.json');
  assert.strictEqual(list.length, 4);

  // ---------- Import
  const [id] = await core.importInstances([pvp], { includeWorlds: true });
  const inst = await core.getInstance(id);
  const mods = (await fsp.readdir(path.join(inst.dir, 'mods'))).sort();
  console.log('Importiert:', inst.name, inst.game, inst.loader, inst.loaderVersion, '| Spielzeit', inst.playTime, '| RAM', inst.memory && inst.memory.max, '\n  mods/:', mods.join(', '));
  assert(!mods.some((m) => m.startsWith('nrc-') || /norisk/i.test(m)), 'keine NoRisk-Ordner/-Dateien in mods/');
  assert(mods.includes('entityculling-fabric-1.10.5-mc26.2.jar.disabled'));
  assert(mods.includes('sodium-fabric-0.9.1+mc26.2.jar') && mods.includes('spark-1.10.173-fabric.jar') && mods.includes('MouseTweaks-fabric-mc26.2-2.31.jar'));
  assert.strictEqual(mods.length, 6);
  assert(!fs.existsSync(path.join(inst.dir, 'custom_mods')) && !fs.existsSync(path.join(inst.dir, 'noriskclient')));
  assert((await fsp.readFile(path.join(inst.dir, 'options.txt'), 'utf8')).includes('guiScale:2'));
  assert(fs.existsSync(path.join(inst.dir, 'saves', 'PvP Welt', 'level.dat')));
  assert(fs.existsSync(path.join(inst.dir, 'config', 'sodium-options.json')));
  assert.strictEqual(inst.playTime, 7200);
  assert.strictEqual(inst.memory.max, 6144);
  const content = (await core.listContent(id, 'mod')).items;
  console.log('  erkannt:', content.map((c) => `${c.title}${c.enabled ? '' : ' (aus)'}${c.projectId ? '' : ' (?)'}`).join(', '));
  assert.strictEqual(content.filter((c) => c.projectId).length, 6, 'alle Mods auf Modrinth erkannt');
  // Original unverändert
  assert(fs.existsSync(path.join(p1, 'mods', 'nrc-26.2-fabric', 'nrc-client-26.2-1.0.0.jar')));
  const again = await core.scanNoRisk([A, B]);
  assert(again.find((x) => x.name === 'PvP Profil').alreadyImported, 'als übernommen markiert');
  assert(!again.find((x) => x.name === 'Mit Freunden').alreadyImported);

  // Standard-Ordner importieren
  const [id2] = await core.importInstances([stdItem], { includeWorlds: true });
  const inst2 = await core.getInstance(id2);
  assert.deepStrictEqual(await fsp.readdir(path.join(inst2.dir, 'mods')), ['fabric-api-0.157.0+26.2.jar']);
  assert(fs.existsSync(path.join(inst2.dir, 'saves', 'NoRisk Welt')));
  console.log('Standard-Ordner importiert:', inst2.name, inst2.game, inst2.loader, inst2.loaderVersion);
  core.dispose();
  console.log('\nNoRisk-Import OK ✅');
  process.exit(0);
})().catch((e) => {
  console.error('FEHLER ❌', e);
  process.exit(1);
});
