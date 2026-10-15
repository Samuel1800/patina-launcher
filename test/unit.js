'use strict';
// Schnelle Unit-Tests ohne Netzwerk: node test/unit.js
const assert = require('assert');
const { neoToMc, cmpLoose } = require('../core/loaders');
const { parseCfLoader } = require('../core/importers');
const { murmur2, fingerprintBuffer } = require('../core/curseforge');
const { mavenPath, mavenKey } = require('../core/maven');
const { rulesAllow, compareVersions } = require('../core/rules');
const { substitute, expandArgs, createLog4jParser, redact } = require('../core/launch');
const { mergeVersion } = require('../core/versions');
const { parseModsToml } = require('../core/jarmeta');
const { analyze } = require('../core/crash');
const { splitArgs } = require('../core/app');

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log('✓', name);
};

t('NeoForge -> Minecraft', () => {
  assert.strictEqual(neoToMc('21.1.77'), '1.21.1');
  assert.strictEqual(neoToMc('21.0.167'), '1.21');
  assert.strictEqual(neoToMc('20.4.251'), '1.20.4');
  assert.strictEqual(neoToMc('26.1.0.19-beta'), '26.1');
  assert.strictEqual(neoToMc('26.1.2.117'), '26.1.2');
  assert.strictEqual(neoToMc('0.25w14craftmine.5-beta'), null);
});

t('Versionsvergleich', () => {
  assert(cmpLoose('21.1.77', '21.1.100') < 0);
  assert(compareVersions('10.0.22631', '10.0.17134') > 0);
});

t('CurseForge-Loader parsen', () => {
  assert.deepStrictEqual(parseCfLoader({ name: 'fabric-0.16.9-1.21.1', type: 4 }, '1.21.1'), { loader: 'fabric', version: '0.16.9' });
  assert.deepStrictEqual(parseCfLoader({ name: 'forge-47.4.0', type: 1, forgeVersion: '47.4.0' }, '1.20.1'), { loader: 'forge', version: '47.4.0' });
  assert.deepStrictEqual(parseCfLoader({ name: 'neoforge-21.1.77', type: 6 }, '1.21.1'), { loader: 'neoforge', version: '21.1.77' });
  assert.deepStrictEqual(parseCfLoader(null, '1.21'), { loader: 'vanilla', version: null });
});

t('Murmur2 (CurseForge-Fingerprint)', () => {
  assert.strictEqual(murmur2(Buffer.from('')), murmur2(Buffer.alloc(0)));
  // Whitespace wird ignoriert
  assert.strictEqual(fingerprintBuffer(Buffer.from('a b\nc\td\r')), fingerprintBuffer(Buffer.from('abcd')));
});

t('Maven-Pfade', () => {
  assert.strictEqual(mavenPath('net.fabricmc:fabric-loader:0.16.9'), 'net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar');
  assert.strictEqual(mavenPath('org.lwjgl:lwjgl:3.3.3:natives-windows'), 'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar');
  assert.strictEqual(mavenPath('de.oceanlabs.mcp:mcp_config:1.20.1@zip'), 'de/oceanlabs/mcp/mcp_config/1.20.1/mcp_config-1.20.1.zip');
  assert.strictEqual(mavenKey('org.lwjgl:lwjgl:3.3.3:natives-windows'), 'org.lwjgl:lwjgl:natives-windows');
});

t('Regeln', () => {
  const win = { os: 'windows', arch: 'x86_64', osVersion: '10.0.22631', features: {} };
  assert(rulesAllow([{ action: 'allow', os: { name: 'windows' } }], win));
  assert(!rulesAllow([{ action: 'allow', os: { name: 'osx' } }], win));
  assert(!rulesAllow([{ action: 'allow', os: { arch: 'x86' } }], win));
  assert(rulesAllow([{ action: 'allow', os: { name: 'windows', versionRange: { min: '10.0.17134' } } }], win));
  assert(!rulesAllow([{ action: 'allow', os: { name: 'windows', versionRange: { max: '10.0.17134' } } }], win));
  assert(!rulesAllow([{ action: 'allow', features: { is_demo_user: true } }], win));
});

t('Argumente', () => {
  assert.strictEqual(substitute('--gameDir ${game_directory}', { game_directory: 'C:\\x' }), '--gameDir C:\\x');
  const env = { os: 'windows', arch: 'x86_64', osVersion: '10.0', features: { has_custom_resolution: true } };
  const out = expandArgs(['--a', { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${w}'] }], env, { w: 800 });
  assert.deepStrictEqual(out, ['--a', '--width', '800']);
  assert.deepStrictEqual(redact(['x0y'], '0'), ['x0y']);
  assert.deepStrictEqual(splitArgs('-Xmx2G "-Dfoo=a b" -XX:+UseZGC'), ['-Xmx2G', '-Dfoo=a b', '-XX:+UseZGC']);
});

t('Versionen zusammenführen (inheritsFrom)', () => {
  const parent = { id: '1.20.1', libraries: [{ name: 'a:b:1' }], arguments: { game: ['--x'], jvm: ['-cp', '${classpath}'] }, logging: { client: { file: {} } }, mainClass: 'Main', _chain: ['1.20.1'], _jarId: '1.20.1', _rootId: '1.20.1', javaVersion: { majorVersion: 17 } };
  const child = { id: 'forge', inheritsFrom: '1.20.1', libraries: [{ name: 'c:d:1' }], arguments: { game: ['--fml'], jvm: ['-p'] }, logging: {}, mainClass: 'Boot' };
  const m = mergeVersion(parent, child);
  assert.deepStrictEqual(m.libraries.map((l) => l.name), ['c:d:1', 'a:b:1']);
  assert.deepStrictEqual(m.arguments.game, ['--x', '--fml']);
  assert.strictEqual(m.mainClass, 'Boot');
  assert.strictEqual(m._jarId, '1.20.1');
  assert(m.logging.client);
  assert.strictEqual(m.javaVersion.majorVersion, 17);
});

t('mods.toml lesen', () => {
  const m = parseModsToml('modLoader="javafml"\n[[mods]]\nmodId="create"\nversion="6.0.4"\ndisplayName="Create"\nlogoFile="logo.png"\n[[dependencies.create]]\nmodId="forge"');
  assert.deepStrictEqual(m, { id: 'create', name: 'Create', version: '6.0.4', icon: 'logo.png' });
});

t('log4j-XML -> Text', () => {
  const out = [];
  const p = createLog4jParser((l) => out.push(l));
  for (const l of [
    'plain line',
    '<log4j:Event logger="x" timestamp="1700000000000" level="ERROR" thread="Render thread">',
    '  <log4j:Message><![CDATA[Kaputt]]></log4j:Message>',
    '  <log4j:Throwable><![CDATA[java.lang.Error: boom',
    '\tat a.b(C.java:1)',
    ']]></log4j:Throwable>',
    '</log4j:Event>',
  ])
    p.feed(l);
  p.end();
  assert.strictEqual(out[0], 'plain line');
  assert(/\[Render thread\/ERROR\]: Kaputt$/.test(out[1]));
  assert.strictEqual(out[2], 'java.lang.Error: boom');
});

t('Absturz-Analyse', () => {
  assert(analyze('java.lang.OutOfMemoryError: Java heap space')[0].title.includes('Arbeitsspeicher'));
  assert(analyze('Exception: UnsupportedClassVersionError: x has been compiled by a more recent version (class file version 65.0)')[0].title.includes('Java 21'));
});

console.log(`\n${n} Tests bestanden ✅`);
