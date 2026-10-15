'use strict';
// End-to-End-Test der Kernfunktionen (ohne Electron, ohne Spielstart).
const assert = require('assert');
const path = require('path');
const fsp = require('fs').promises;
const { Core } = require('../core/app');

const ROOT = process.env.BW_TEST_ROOT || path.join(require('os').tmpdir(), 'patina-test-flow');

function step(name) {
  console.log(`\n=== ${name}`);
}

(async () => {
  await fsp.rm(path.join(ROOT, 'user'), { recursive: true, force: true });
  await fsp.rm(path.join(ROOT, 'data', 'instances'), { recursive: true, force: true });
  await fsp.mkdir(path.join(ROOT, 'user'), { recursive: true });
  await fsp.writeFile(path.join(ROOT, 'user', 'settings.json'), JSON.stringify({ dataRoot: path.join(ROOT, 'data'), prefetch: false }));
  const core = new Core({ userDir: path.join(ROOT, 'user'), crypt: { encrypt: (s) => Buffer.from(s).toString('base64'), decrypt: (s) => Buffer.from(s, 'base64').toString() } });
  await core.init();
  core.tasks.on('update', (l) => {
    for (const t of l) if (t.state === 'running' && Math.random() < 0.05) console.log(`   … ${t.title}: ${t.label}`);
  });

  step('Versionsliste');
  const st = await core.state();
  console.log('Neueste:', st.latest);
  const rel = await core.versionList();
  assert(rel.length > 50);

  step('Loader-Verfügbarkeit 1.21.4');
  const av = await core.loaderAvailability('1.21.4');
  console.log(Object.fromEntries(Object.entries(av).map(([k, v]) => [k, v.available ? v.recommended || 'ja' : 'nein'])));
  assert(av.fabric.available && av.forge.available && av.neoforge.available);

  step('Instanz anlegen (Fabric 1.21.4)');
  const inst = await core.createInstance({ name: 'Testwelt', game: '1.21.4', loader: 'fabric' });
  console.log(inst.name, inst.game, inst.loader, inst.loaderVersion);

  step('Mods installieren (mit Abhängigkeiten)');
  for (const slug of ['sodium', 'lithium', 'modmenu', 'appleskin', 'xaeros-minimap']) {
    const r = await core.installContent(inst.id, slug, { kind: 'mod', title: slug });
    console.log(slug, '->', r.installed.map((x) => `${x.title} ${x.version}${x.dependency ? ' (Abh.)' : ''}`).join(', '), r.warnings.join(' | '));
  }
  let mods = (await core.listContent(inst.id, 'mod')).items;
  console.log('Installiert:', mods.map((m) => `${m.title} [${m.version}]`).join(', '));
  assert(mods.some((m) => m.title === 'Fabric API'), 'Fabric API als Abhängigkeit erwartet');

  step('Shader installieren (Iris automatisch)');
  const sh = await core.installContent(inst.id, 'complementary-reimagined', { kind: 'shader', title: 'Complementary' });
  console.log('Shader:', sh.pack, 'Mitinstalliert:', sh.installed.map((x) => x.title).join(', '));
  const shaders = await core.listContent(inst.id, 'shader');
  console.log('Aktiv:', shaders.active, 'Status:', shaders.status);
  assert(shaders.active, 'Shader sollte aktiv sein');

  step('Ressourcenpaket');
  await core.installContent(inst.id, 'fresh-animations', { kind: 'resourcepack', title: 'Fresh Animations' }).catch((e) => console.log('RP:', e.message));
  const rps = await core.listContent(inst.id, 'resourcepack');
  console.log(rps.items.map((r) => `${r.title} aktiv=${r.active}`));

  step('Einstellungen simulieren');
  const instObj = await core.instances.get(inst.id);
  await fsp.writeFile(path.join(instObj._dir, 'options.txt'), (await fsp.readFile(path.join(instObj._dir, 'options.txt'), 'utf8').catch(() => '')) + 'fov:0.75\nrenderDistance:16\n');
  await fsp.mkdir(path.join(instObj._dir, 'saves', 'Meine Welt'), { recursive: true });
  await fsp.writeFile(path.join(instObj._dir, 'saves', 'Meine Welt', 'level.dat'), 'x');
  // unbekannte Mod-Datei
  await fsp.writeFile(path.join(instObj._dir, 'mods', 'eigener-mod-1.0.jar'), 'kein echtes jar');

  step('Updates prüfen');
  const ups = await core.checkUpdates(inst.id);
  console.log('Updates:', ups.length);

  step('Upgrade-Plan 1.21.4 -> 26.3');
  const targets = await core.upgradeTargets(inst.id);
  console.log('Ziele:', targets.slice(0, 6).join(', '));
  const plan = await core.upgradePlan(inst.id, targets[0]);
  console.log('Loader:', plan.loaderName, plan.loaderVersion, 'Zusammenfassung:', plan.summary);
  for (const it of plan.items) console.log(`  ${it.status.padEnd(10)} ${it.kind.padEnd(12)} ${it.title} ${it.from || ''} -> ${it.to || ''}`);

  step('Upgrade ausführen');
  const report = await core.upgradeApply(inst.id, plan, { prefetch: false });
  console.log('Aktualisiert:', report.updated.length, 'Geparkt:', report.parked.map((p) => p.title), 'Abh.:', report.deps, 'Warnungen:', report.warnings);
  const after = await core.getInstance(inst.id);
  console.log('Neue Version:', after.game, after.loaderVersion, 'pending:', after.pending);
  assert.strictEqual(after.game, targets[0]);
  const opts = await fsp.readFile(path.join(instObj._dir, 'options.txt'), 'utf8');
  assert(opts.includes('fov:0.75'), 'Einstellungen müssen erhalten bleiben');
  mods = (await core.listContent(inst.id, 'mod')).items;
  console.log('Mods jetzt:', mods.map((m) => `${m.title} [${m.version}]${m.enabled ? '' : ' (aus)'}`).join(', '));
  const shAfter = await core.listContent(inst.id, 'shader');
  console.log('Shader aktiv nach Upgrade:', shAfter.active);

  step('Geparkte Mods prüfen');
  console.log(await core.checkPending(inst.id));

  step('Sicherungen + Rollback');
  const backups = await core.backups(inst.id);
  console.log(backups.map((b) => `${b.id} ${b.game} welten=${b.includesWorlds}`));
  await core.restoreBackup(inst.id, backups[0].id);
  const restored = await core.getInstance(inst.id);
  console.log('Nach Rollback:', restored.game, restored.loaderVersion);
  assert.strictEqual(restored.game, '1.21.4');
  const modsBack = (await core.listContent(inst.id, 'mod')).items;
  console.log('Mods zurück:', modsBack.map((m) => `${m.title} [${m.version}]`).join(', '));

  step('Kopier-Modus');
  const plan2 = await core.upgradePlan(inst.id, '1.21.5');
  const rep2 = await core.upgradeApply(inst.id, plan2, { mode: 'copy', prefetch: false });
  const copy = await core.getInstance(rep2.instanceId);
  console.log('Kopie:', copy.name, copy.game, 'Original bleibt:', (await core.getInstance(inst.id)).game);

  step('Suche');
  const s = await core.search({ query: 'shader', type: 'shader', limit: 5 });
  console.log(s.total, s.hits.map((h) => h.title).join(', '));

  console.log('\nALLE TESTS OK ✅');
  core.dispose();
  process.exit(0);
})().catch((e) => {
  console.error('TEST FEHLGESCHLAGEN ❌', e);
  process.exit(1);
});
