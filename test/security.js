'use strict';
// Sicherheits-Tests: Pfad-Ausbrüche in Modpacks, fremde Download-Quellen, unverschlüsselte Adressen, Einstellungs-Manipulation.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const AdmZip = require('adm-zip');
const { isInside } = require('../core/fsutil');
const { readMrpack, installMrpackFiles } = require('../core/importers');
const http = require('../core/http');
const { Settings } = require('../core/settings');

const ROOT = path.join(require('os').tmpdir(), 'patina-test-security');
let n = 0;
const ok = (name) => console.log(`✓ ${name}`, ++n && '');

function mrpack(file, { files = [], overrides = {} }) {
  const zip = new AdmZip();
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', name: 'Test', versionId: '1', dependencies: { minecraft: '1.21.1' }, files })));
  for (const [name, content] of Object.entries(overrides)) zip.addFile(name, Buffer.from(content));
  zip.writeZip(file);
  return readMrpack(file);
}

(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
  await fsp.mkdir(path.join(ROOT, 'instances', 'Ziel'), { recursive: true });
  await fsp.mkdir(path.join(ROOT, 'instances', 'Ziel2'), { recursive: true });
  const game = path.join(ROOT, 'instances', 'Ziel');

  // Pfadprüfung
  assert(isInside(game, path.join(game, 'mods', 'a.jar')));
  assert(!isInside(game, path.join(ROOT, 'instances', 'Ziel2', 'x')));
  assert(!isInside(game, path.join(game, '..', 'x')));
  ok('Pfadprüfung erkennt Ausbrüche und Nachbarordner');

  const sha1 = 'a'.repeat(40);
  // 1) ../ im Dateipfad
  let pack = mrpack(path.join(ROOT, 'p1.mrpack'), { files: [{ path: '../Ziel2/mods/boese.jar', hashes: { sha1 }, downloads: ['https://cdn.modrinth.com/data/x/boese.jar'], fileSize: 1 }] });
  await assert.rejects(installMrpackFiles(pack, game), /Unsicherer Pfad/);
  ok('Modpack mit ../-Pfad wird abgelehnt');

  // 2) absoluter Pfad
  pack = mrpack(path.join(ROOT, 'p2.mrpack'), { files: [{ path: '/etc/boese', hashes: { sha1 }, downloads: ['https://cdn.modrinth.com/x'], fileSize: 1 }] });
  await assert.rejects(installMrpackFiles(pack, game), /Unsicherer Pfad/);
  ok('Modpack mit absolutem Pfad wird abgelehnt');

  // 3) fremde Download-Quelle
  pack = mrpack(path.join(ROOT, 'p3.mrpack'), { files: [{ path: 'mods/a.jar', hashes: { sha1 }, downloads: ['https://evil.example.com/a.jar'], fileSize: 1 }] });
  await assert.rejects(installMrpackFiles(pack, game), /Unzulässige Download-Quelle/);
  pack = mrpack(path.join(ROOT, 'p3b.mrpack'), { files: [{ path: 'mods/a.jar', hashes: { sha1 }, downloads: ['http://cdn.modrinth.com/a.jar'], fileSize: 1 }] });
  await assert.rejects(installMrpackFiles(pack, game), /Unzulässige Download-Quelle/);
  ok('Modpack mit fremder oder unverschlüsselter Download-Quelle wird abgelehnt');

  // 4) fehlende Prüfsumme
  pack = mrpack(path.join(ROOT, 'p4.mrpack'), { files: [{ path: 'mods/a.jar', hashes: {}, downloads: ['https://cdn.modrinth.com/a.jar'], fileSize: 1 }] });
  await assert.rejects(installMrpackFiles(pack, game), /Prüfsumme fehlt/);
  ok('Modpack ohne Prüfsumme wird abgelehnt');

  // 5) overrides mit Ausbruch -> wird übersprungen, normale Overrides landen richtig
  // adm-zip bereinigt Namen beim Schreiben -> Eintragsnamen nachträglich roh im Archiv ersetzen
  mrpack(path.join(ROOT, 'p5.mrpack'), { overrides: { 'overrides/XX/XX/XX/boese.txt': 'x', 'overrides/config/ok.txt': 'ok' } });
  const raw = await fsp.readFile(path.join(ROOT, 'p5.mrpack'));
  await fsp.writeFile(path.join(ROOT, 'p5.mrpack'), Buffer.from(raw.toString('latin1').split('overrides/XX/XX/XX/').join('overrides/../../../'), 'latin1'));
  pack = readMrpack(path.join(ROOT, 'p5.mrpack'));
  assert(pack.zip.getEntries().some((e) => e.entryName === 'overrides/../../../boese.txt'), 'Test-Archiv enthält den bösen Pfad');
  await installMrpackFiles(pack, game);
  assert(!fs.existsSync(path.join(ROOT, 'boese.txt')) && !fs.existsSync(path.join(ROOT, 'instances', 'boese.txt')));
  assert.strictEqual(await fsp.readFile(path.join(game, 'config', 'ok.txt'), 'utf8'), 'ok');
  ok('Overrides können nicht aus der Instanz ausbrechen');

  // 6) Netzwerk: nur https
  await assert.rejects(http.getText('ftp://example.com/x'), /Unsichere Adresse/);
  await assert.rejects(http.getText('file:///etc/passwd'), /Unsichere Adresse/);
  ok('Nur verschlüsselte Verbindungen (ftp/file abgelehnt)');

  // 7) Einstellungen: keine Prototyp-Manipulation
  const s = new Settings(path.join(ROOT, 'settings.json'));
  await s.load();
  await s.set(JSON.parse('{"__proto__": {"boese": true}, "memoryMax": 3072}'));
  assert.strictEqual({}.boese, undefined);
  assert.strictEqual(s.data.boese, undefined);
  assert.strictEqual(s.data.memoryMax, 3072);
  ok('Einstellungen ignorieren __proto__');

  console.log(`\n${n} Sicherheits-Tests bestanden ✅`);
  process.exit(0);
})().catch((e) => {
  console.error('FEHLER ❌', e);
  process.exit(1);
});
