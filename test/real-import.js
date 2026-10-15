'use strict';
// Test mit echten CurseForge-Instanzen (Kopie): Import -> Erkennung -> Upgrade-Plan -> Upgrade.
const path = require('path');
const fsp = require('fs').promises;
const { Core } = require('../core/app');

const ROOT = path.join(require('os').tmpdir(), 'patina-test-real');
const CF = process.env.CF_DIR;
if (!CF) {
  console.log('Übersprungen: CF_DIR nicht gesetzt (CurseForge-Instanzordner).');
  process.exit(0);
}

(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
  await fsp.mkdir(path.join(ROOT, 'user'), { recursive: true });
  await fsp.writeFile(path.join(ROOT, 'user', 'settings.json'), JSON.stringify({ dataRoot: path.join(ROOT, 'data'), prefetch: false }));
  const core = new Core({ userDir: path.join(ROOT, 'user'), crypt: { encrypt: (s) => s, decrypt: (s) => s } });
  await core.init();

  console.log('=== CurseForge scannen');
  const list = await core.scanCurseForge([CF]);
  const mine = list.filter((x) => x.path.startsWith(CF));
  for (const x of mine) console.log(`  ${x.name}: ${x.game} ${x.loader} ${x.loaderVersion} (${x.mods} Mods) Speicher=${x.memory}`);

  console.log('\n=== Importieren');
  let t = Date.now();
  const ids = await core.importInstances(mine, { includeWorlds: true });
  console.log(`  ${ids.length} importiert in ${((Date.now() - t) / 1000).toFixed(1)}s`);

  for (const id of ids) {
    const inst = await core.getInstance(id);
    t = Date.now();
    const mods = (await core.listContent(id, 'mod')).items;
    const known = mods.filter((m) => m.projectId);
    const viaId = mods.filter((m) => m.source === 'modrinth-modid');
    console.log(`\n### ${inst.name} (${inst.game} ${inst.loader} ${inst.loaderVersion})`);
    console.log(`  Mods: ${mods.length}, auf Modrinth erkannt: ${known.length} (davon über Mod-ID: ${viaId.length}) in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    const unknown = mods.filter((m) => !m.projectId);
    if (unknown.length) console.log('  Unbekannt:', unknown.map((m) => m.title).join(', '));
    const sh = await core.listContent(id, 'shader');
    console.log('  Shader:', sh.items.map((s) => s.title).join(', '), 'aktiv:', sh.active, 'Status:', JSON.stringify(sh.status));

    t = Date.now();
    const plan = await core.upgradePlan(id, '26.3');
    console.log(`  Plan -> 26.3 in ${((Date.now() - t) / 1000).toFixed(1)}s: ${JSON.stringify(plan.summary)}`);
    const miss = plan.items.filter((i) => i.status === 'missing').map((i) => i.title);
    if (miss.length) console.log('  Fehlen für 26.3:', miss.join(', '));
    if (inst.mods < 20) {
      for (const it of plan.items) console.log(`    ${it.status.padEnd(10)} ${it.title} ${it.from || ''} -> ${it.to || ''}`);
    }
    if (process.env.NO_UPGRADE) continue;
    t = Date.now();
    const rep = await core.upgradeApply(id, plan, { prefetch: false });
    console.log(`  Upgrade ausgeführt in ${((Date.now() - t) / 1000).toFixed(1)}s: aktualisiert ${rep.updated.length}, geparkt ${rep.parked.length}, Abh. ${rep.deps.join(', ') || '-'}, Warnungen ${rep.warnings.length}`);
    const after = await core.getInstance(id);
    const opts = await fsp.readFile(path.join(after.dir, 'options.txt'), 'utf8').catch(() => '');
    console.log(`  Jetzt: ${after.game} ${after.loader} ${after.loaderVersion}, options.txt: ${opts.length} Bytes, geparkt: ${after.pending}`);
    const sh2 = await core.listContent(id, 'shader');
    console.log('  Shader aktiv nach Upgrade:', sh2.active);
  }
  core.dispose();
  console.log('\nFERTIG ✅');
  process.exit(0);
})().catch((e) => {
  console.error('FEHLER ❌', e);
  process.exit(1);
});
