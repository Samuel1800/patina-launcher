'use strict';
// Absturz-Analyse: übersetzt typische Fehlermeldungen in verständliche Hinweise.
const fsp = require('fs').promises;
const path = require('path');

async function latestCrashReport(gameDir, since) {
  const dir = path.join(gameDir, 'crash-reports');
  try {
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.txt'));
    let best = null;
    for (const f of files) {
      const st = await fsp.stat(path.join(dir, f));
      if (st.mtimeMs >= since - 5000 && (!best || st.mtimeMs > best.t)) best = { f: path.join(dir, f), t: st.mtimeMs };
    }
    return best ? best.f : null;
  } catch {
    return null;
  }
}

function analyze(text) {
  const t = text || '';
  const hints = [];
  let m;
  if ((m = /UnsupportedClassVersionError.*?class file version (\d+)/.exec(t))) {
    const needed = Number(m[1]) - 44;
    hints.push({ title: `Ein Mod braucht Java ${needed}`, hint: 'Wahrscheinlich ist ein Mod für eine neuere Minecraft-Version gedacht. Prüfe die zuletzt hinzugefügten Mods.' });
  }
  if (/OutOfMemoryError/.test(t)) {
    hints.push({ title: 'Zu wenig Arbeitsspeicher', hint: 'Erhöhe den RAM in den Instanz-Einstellungen (z. B. auf 6–8 GB bei vielen Mods).' });
  }
  const fabricIncompat = /(Incompatible mods? (found|set)|Mod resolution encountered an incompatible mod set)[\s\S]{0,4000}/.exec(t);
  if (fabricIncompat) {
    const lines = fabricIncompat[0]
      .split(/\r?\n/)
      .filter((l) => /requires|is incompatible|Replace|Install|Remove|breaks/.test(l))
      .map((l) => l.replace(/^\s*[-\t ]*/, '').replace(/^\[.*?\]\s*/, '').trim())
      .slice(0, 8);
    hints.push({ title: 'Mods passen nicht zusammen', hint: lines.length ? lines.join('\n') : 'Fabric hat inkompatible Mods gefunden.', details: lines });
  }
  if ((m = /Missing or unsupported mandatory dependencies:([\s\S]{0,2000})/.exec(t))) {
    const lines = m[1]
      .split(/\r?\n/)
      .filter((l) => /Mod ID/.test(l))
      .map((l) => l.trim())
      .slice(0, 8);
    hints.push({ title: 'Fehlende Abhängigkeiten', hint: lines.join('\n') || 'Ein Mod braucht einen weiteren Mod.', details: lines });
  }
  if ((m = /Mixin (?:apply|transformation) .*?failed.*?(?:from mod|mod) ['"]?([\w-]+)/i.exec(t))) {
    hints.push({ title: `Mod „${m[1]}“ ist nicht kompatibel`, hint: 'Dieser Mod passt nicht zur Minecraft-Version oder zu einem anderen Mod. Deaktivieren oder aktualisieren.' });
  }
  if (/Pixel format not accelerated|GLFW error 65542|WGL: The driver does not appear to support OpenGL/.test(t)) {
    hints.push({ title: 'Grafiktreiber-Problem', hint: 'Installiere den aktuellen Treiber deiner Grafikkarte (NVIDIA/AMD/Intel).' });
  }
  if (/Could not find or load main class|ClassNotFoundException: net\.minecraft/.test(t)) {
    hints.push({ title: 'Installation unvollständig', hint: 'Nutze „Dateien reparieren“ in den Instanz-Einstellungen.' });
  }
  if ((m = /Duplicate mods? found|Found a duplicate mod|duplicate mod ids?:?\s*(.*)/i.exec(t))) {
    hints.push({ title: 'Ein Mod ist doppelt installiert', hint: m[1] ? `Doppelt: ${m[1]}` : 'Entferne die doppelte Datei im Mods-Ordner.' });
  }
  return hints;
}

module.exports = { analyze, latestCrashReport };
