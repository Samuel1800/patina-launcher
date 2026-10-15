'use strict';
// Integrationstest: installiert eine Version (+Loader) und startet sie offline.
// Aufruf: node test/smoke-launch.js <gameVersion> [loader] [loaderVersion]
const path = require('path');
const fsp = require('fs').promises;
const { createPaths } = require('../core/paths');
const { Versions } = require('../core/versions');
const { Installer } = require('../core/installer');
const { JavaManager } = require('../core/java');
const { Loaders } = require('../core/loaders');
const { buildCommand, startProcess, redact } = require('../core/launch');

(async () => {
  const [game = '26.3', loader = 'vanilla', lv] = process.argv.slice(2);
  const root = process.env.BW_ROOT || path.join(require('os').tmpdir(), 'patina-test-data');
  const paths = createPaths(root);
  const log = (lvl, m) => console.log(`[${lvl}] ${m}`);
  const versions = new Versions(paths, log);
  const java = new JavaManager({ paths, log });
  const loaders = new Loaders({ paths, java, versions, log });
  const installer = new Installer({ paths, versions, log });
  let last = 0;
  const progress = (p) => {
    if (Date.now() - last > 2000) {
      last = Date.now();
      console.log(`  ${p.label} ${p.total ? Math.round((p.done / p.total) * 100) + '%' : ''}`);
    }
  };
  const t0 = Date.now();
  const id = await loaders.install(loader, game, lv, { progress });
  console.log('Versions-ID:', id, `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  const plan = await installer.prepare(id, { progress });
  console.log('Classpath-Einträge:', plan.classpath.length, 'Java:', plan.javaMajor, `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  const javaPath = await java.ensure(plan.javaMajor, { progress, console: true });
  console.log('Java:', javaPath);
  const gameDir = path.join(paths.instances, `test-${loader}-${game}`);
  await fsp.mkdir(gameDir, { recursive: true });
  const cmd = buildCommand(plan, {
    account: { name: 'PatinaTest', uuid: '00000000000000000000000000000000', accessToken: process.env.PAD ? 'GEHEIMES-TEST-TOKEN-123456' : '0', type: 'offline' },
    gameDir,
    javaPath,
    memory: { min: 512, max: 2048 },
    jvmArgs: process.env.PAD ? [`-Dpatina.pad=${'x'.repeat(Number(process.env.PAD))}`] : [],
    libraryDir: paths.libraries,
    resolution: process.env.RES ? { width: Number(process.env.RES.split('x')[0]), height: Number(process.env.RES.split('x')[1]) } : null,
  });
  console.log('Befehl:', redact(cmd.args, null).slice(0, 4).join(' '), '…', cmd.args.slice(-26).join(' '));
  await fsp.writeFile(path.join(gameDir, 'cmd.txt'), [cmd.java, ...cmd.args].join('\n'));
  if (process.env.NO_RUN) return;
  const logFile = path.join(gameDir, 'logs', 'patina-latest.log');
  const timeout = Number(process.env.RUN_SECONDS || 90) * 1000;
  let ok = false;
  const child = await startProcess(cmd, {
    logFile,
    javaMajor: plan.javaMajor,
    detached: false,
    onLine: (l) => {
      if (/Sound engine started|Created: \d+x\d+.*atlas|Narrator library|Reloading ResourceManager|Loaded \d+ (recipes|advancements)/.test(l)) ok = true;
      if (/ERROR|Exception|FATAL/.test(l)) console.log('   >', l.slice(0, 220));
    },
    onExit: ({ code }) => {
      console.log('Spiel beendet mit Code', code);
    },
  });
  await new Promise((r) => setTimeout(r, timeout));
  if (process.env.PAD) {
    const af = path.join(path.dirname(logFile), 'patina-args.txt');
    const txt = await fsp.readFile(af, 'utf8').catch(() => null);
    console.log('Argfile vorhanden:', Boolean(txt), '| Token in Argfile:', Boolean(txt && txt.includes('GEHEIMES-TEST-TOKEN')));
    if (!txt || txt.includes('GEHEIMES-TEST-TOKEN')) ok = false;
  }
  console.log(ok ? 'ERGEBNIS: Spiel läuft (Ressourcen geladen) ✅' : 'ERGEBNIS: kein Erfolgsmarker im Log ❌');
  if (process.env.SHOT) {
    require('child_process').execSync(`import -window root ${process.env.SHOT}`);
    console.log('Screenshot:', process.env.SHOT);
  }
  try {
    child.kill();
  } catch {}
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('FEHLER:', e);
  process.exit(2);
});
