'use strict';
// Maven-Koordinaten -> Pfade.
/** "group:artifact:version[:classifier][@ext]" -> "group/path/artifact/version/artifact-version[-classifier].ext" */
function mavenPath(coord) {
  let ext = 'jar';
  let c = coord;
  const at = c.indexOf('@');
  if (at >= 0) {
    ext = c.slice(at + 1);
    c = c.slice(0, at);
  }
  const parts = c.split(':');
  if (parts.length < 3) throw new Error(`Ungültige Maven-Koordinate: ${coord}`);
  const [group, artifact, version, classifier] = parts;
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
}

/** Schlüssel zum Deduplizieren: group:artifact[:classifier] (ohne Version). */
function mavenKey(coord) {
  const c = coord.split('@')[0];
  const [group, artifact, , classifier] = c.split(':');
  return `${group}:${artifact}${classifier ? `:${classifier}` : ''}`;
}

module.exports = { mavenPath, mavenKey };
