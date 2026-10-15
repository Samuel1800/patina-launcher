'use strict';
// Übernahme aus der Vorgängerversion „Blockwerk“: Konto, Einstellungen, Spieldaten und Verknüpfungen.
// Alles hier ist defensiv: Wenn etwas nicht klappt, läuft die App mit dem alten Stand weiter.
const fs = require('fs');
const path = require('path');

const LEGACY_NAME = 'Blockwerk';

/**
 * Muss VOR app.whenReady() laufen. Nutzt den alten Benutzerordner weiter, falls es ihn gibt –
 * so bleiben Anmeldung (verschlüsselt an diesen Ordner gebunden) und Einstellungen erhalten.
 */
function chooseUserDataDir(app) {
  const appData = app.getPath('appData');
  const fresh = path.join(appData, app.getName());
  const legacy = path.join(appData, LEGACY_NAME);
  if (!fs.existsSync(path.join(fresh, 'settings.json')) && fs.existsSync(path.join(legacy, 'settings.json'))) {
    app.setPath('userData', legacy);
    return { dir: legacy, legacy: true };
  }
  app.setPath('userData', fresh);
  return { dir: fresh, legacy: false };
}

/** Spieldaten-Ordner (.blockwerk -> .patina) umbenennen, wenn er der alte Standardordner ist. */
function migrateDataRoot(settingsFile, { legacyRoot, newRoot, log = () => {} }) {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
  const same = (a, b) => a && b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  let changed = false;
  if (same(s.dataRoot, legacyRoot)) {
    if (fs.existsSync(legacyRoot) && !fs.existsSync(newRoot)) {
      try {
        fs.renameSync(legacyRoot, newRoot);
        s.dataRoot = newRoot;
        changed = true;
        log('info', `Spieldaten verschoben: ${legacyRoot} -> ${newRoot}`);
      } catch (e) {
        log('warn', `Spieldaten-Ordner nicht umbenannt (${e.code || e.message}), bleibe bei ${legacyRoot}`);
      }
    } else if (!fs.existsSync(legacyRoot) && fs.existsSync(newRoot)) {
      // Umbenennen hat schon geklappt, nur die Einstellung fehlte
      s.dataRoot = newRoot;
      changed = true;
    }
  }
  if (changed) {
    const tmp = `${settingsFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, settingsFile);
  }
  return s.dataRoot;
}

/**
 * Windows-Verknüpfungen der alten Version reparieren:
 * - Instanz-Verknüpfungen (--launch) zeigen danach auf die neue Exe
 * - die alte „Blockwerk.lnk“ (Desktop/Startmenü) wird entfernt
 */
function migrateShortcuts({ shell, desktop, startMenu, exePath, appUserModelId, log = () => {} }) {
  const out = { fixed: 0, removed: 0 };
  for (const dir of [desktop, startMenu]) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.lnk'));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = path.join(dir, f);
      let link;
      try {
        link = shell.readShortcutLink(file);
      } catch {
        continue;
      }
      if (!link || !/blockwerk\.exe$/i.test(link.target || '')) continue;
      try {
        if (/--launch/.test(link.args || '')) {
          shell.writeShortcutLink(file, 'replace', { ...link, target: exePath, cwd: path.dirname(exePath), icon: exePath, iconIndex: 0, appUserModelId });
          out.fixed++;
        } else {
          fs.unlinkSync(file);
          out.removed++;
        }
      } catch (e) {
        log('warn', `Verknüpfung ${f}: ${e.message}`);
      }
    }
  }
  return out;
}

module.exports = { chooseUserDataDir, migrateDataRoot, migrateShortcuts, LEGACY_NAME };
