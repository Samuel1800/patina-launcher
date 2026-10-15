'use strict';
// Auswertung der Mojang-Regeln (rules) in Version-JSONs.
const os = require('os');

function osName(platform = process.platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'osx';
  return 'linux';
}

/** Mojang benutzt "x86" für 32-bit. */
function osArch(arch = process.arch) {
  if (arch === 'ia32') return 'x86';
  if (arch === 'x64') return 'x86_64';
  return arch; // arm64
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function osMatches(ruleOs, env) {
  if (!ruleOs) return true;
  if (ruleOs.name && ruleOs.name !== env.os) return false;
  if (ruleOs.arch) {
    if (ruleOs.arch === 'x86' && env.arch !== 'x86') return false;
    if (ruleOs.arch !== 'x86' && ruleOs.arch !== env.arch) return false;
  }
  if (ruleOs.version) {
    try {
      if (!new RegExp(ruleOs.version).test(env.osVersion)) return false;
    } catch {
      return false;
    }
  }
  if (ruleOs.versionRange) {
    const { min, max } = ruleOs.versionRange;
    if (min && compareVersions(env.osVersion, min) < 0) return false;
    if (max && compareVersions(env.osVersion, max) >= 0) return false;
  }
  return true;
}

function featuresMatch(ruleFeatures, features) {
  if (!ruleFeatures) return true;
  for (const [k, v] of Object.entries(ruleFeatures)) {
    if (Boolean(features[k]) !== Boolean(v)) return false;
  }
  return true;
}

function currentEnv(features = {}) {
  return { os: osName(), arch: osArch(), osVersion: os.release(), features };
}

/** true, wenn das Element nach den Regeln erlaubt ist. */
function rulesAllow(rules, env) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const r of rules) {
    if (osMatches(r.os, env) && featuresMatch(r.features, env.features || {})) {
      allowed = r.action === 'allow';
    }
  }
  return allowed;
}

module.exports = { osName, osArch, rulesAllow, currentEnv, compareVersions };
