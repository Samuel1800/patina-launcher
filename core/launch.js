'use strict';
// Baut die Startargumente und startet Minecraft direkt (ohne offiziellen Launcher).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const { rulesAllow, currentEnv } = require('./rules');

const LAUNCHER_NAME = 'Patina';
const LAUNCHER_VERSION = '1.2.0';

const LEGACY_GC = [
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+UseG1GC',
  '-XX:G1NewSizePercent=20',
  '-XX:G1ReservePercent=20',
  '-XX:MaxGCPauseMillis=50',
  '-XX:G1HeapRegionSize=32M',
];

function substitute(str, vars) {
  return str.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/** Löst eine Argumentliste (Strings + {rules, value}) auf. */
function expandArgs(list, env, vars) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') {
      out.push(substitute(a, vars));
    } else if (a && rulesAllow(a.rules, env)) {
      const vals = Array.isArray(a.value) ? a.value : [a.value];
      for (const v of vals) out.push(substitute(v, vars));
    }
  }
  return out;
}

function argsSupportFeature(v, feature) {
  const game = (v.arguments && v.arguments.game) || [];
  return game.some((a) => a && a.rules && a.rules.some((r) => r.features && r.features[feature] !== undefined));
}

/**
 * @param plan Ergebnis von Installer.prepare
 * @param o {account, gameDir, javaPath, memory:{min,max}, jvmArgs:string[], resolution:{width,height}|null,
 *           quickPlay:{type:'singleplayer'|'multiplayer', target}|null, clientId}
 */
function buildCommand(plan, o) {
  const v = plan.version;
  const sep = process.platform === 'win32' ? ';' : ':';
  const acc = o.account;
  const qp = o.quickPlay && o.quickPlay.target ? o.quickPlay : null;
  const supportsQuickPlay = argsSupportFeature(v, 'is_quick_play_multiplayer');

  const features = {
    is_demo_user: false,
    has_custom_resolution: Boolean(o.resolution && o.resolution.width && o.resolution.height),
    has_quick_plays_support: Boolean(qp && supportsQuickPlay),
    is_quick_play_singleplayer: Boolean(qp && supportsQuickPlay && qp.type === 'singleplayer'),
    is_quick_play_multiplayer: Boolean(qp && supportsQuickPlay && qp.type === 'multiplayer'),
    is_quick_play_realms: false,
  };
  const env = currentEnv(features);

  const gameAssets = plan.mapToResources ? path.join(o.gameDir, 'resources') : plan.virtualDir || plan.assetsRoot;
  const vars = {
    auth_player_name: acc.name,
    version_name: v.id,
    game_directory: o.gameDir,
    assets_root: plan.virtualDir && !plan.mapToResources ? plan.virtualDir : plan.assetsRoot,
    game_assets: gameAssets,
    assets_index_name: plan.assetIndexId,
    auth_uuid: acc.uuid,
    auth_access_token: acc.accessToken,
    auth_session: `token:${acc.accessToken}:${acc.uuid}`,
    clientid: o.clientId || '0',
    auth_xuid: acc.xuid || '0',
    user_type: acc.type === 'offline' ? 'legacy' : 'msa',
    version_type: v.type || 'release',
    user_properties: '{}',
    natives_directory: plan.nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath: plan.classpath.join(sep),
    classpath_separator: sep,
    library_directory: path.dirname(plan.classpath[0] || '').split(path.sep + 'libraries')[0] + path.sep + 'libraries',
    resolution_width: o.resolution ? o.resolution.width : '',
    resolution_height: o.resolution ? o.resolution.height : '',
    quickPlayPath: path.join(o.gameDir, 'logs', 'quickplay.json'),
    quickPlaySingleplayer: qp && qp.type === 'singleplayer' ? qp.target : '',
    quickPlayMultiplayer: qp && qp.type === 'multiplayer' ? qp.target : '',
    quickPlayRealms: '',
  };
  if (o.libraryDir) vars.library_directory = o.libraryDir;

  // --- JVM
  const jvm = [];
  const max = Math.max(512, Number(o.memory && o.memory.max) || 4096);
  const min = Math.min(max, Math.max(256, Number(o.memory && o.memory.min) || 1024));
  jvm.push(`-Xms${min}M`, `-Xmx${max}M`);

  const userJvm = (o.jvmArgs || []).filter(Boolean);
  const defaults = v.arguments && v.arguments['default-user-jvm'];
  if (defaults) {
    for (const a of expandArgs(defaults, env, vars)) {
      if (/^-Xm[sx]/.test(a)) continue;
      jvm.push(a);
    }
  } else if (plan.javaMajor >= 8 && !userJvm.some((a) => /Use(G1|Z|Shenandoah|Parallel)GC/.test(a))) {
    jvm.push(...LEGACY_GC);
  }
  jvm.push(...userJvm);

  if (v.arguments && v.arguments.jvm) {
    jvm.push(...expandArgs(v.arguments.jvm, env, vars));
  } else {
    // Alte Versionen (minecraftArguments)
    if (process.platform === 'win32') jvm.push('-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump');
    jvm.push(`-Djava.library.path=${plan.nativesDir}`, `-Dminecraft.launcher.brand=${LAUNCHER_NAME}`, `-Dminecraft.launcher.version=${LAUNCHER_VERSION}`, '-cp', vars.classpath);
  }
  if (plan.logArg) jvm.push(plan.logArg);

  // --- Spiel
  let game;
  if (v.arguments && v.arguments.game) {
    game = expandArgs(v.arguments.game, env, vars);
  } else {
    game = (v.minecraftArguments || '').split(/\s+/).filter(Boolean).map((a) => substitute(a, vars));
    if (features.has_custom_resolution) game.push('--width', String(o.resolution.width), '--height', String(o.resolution.height));
  }
  if (qp && !supportsQuickPlay && qp.type === 'multiplayer') {
    const [host, port] = qp.target.split(':');
    game.push('--server', host, '--port', port || '25565');
  }
  if (o.extraGameArgs) game.push(...o.extraGameArgs);

  // gameArgsFrom: ab hier beginnen die Spiel-Argumente (inkl. Zugangs-Token)
  return { java: o.javaPath, args: [...jvm, v.mainClass, ...game], cwd: o.gameDir, gameArgsFrom: jvm.length + 1 };
}

/** Maskiert das Token für Logs. */
function redact(args, token) {
  if (!token || token.length < 12) return args;
  return args.map((a) => (a.includes(token) ? a.split(token).join('••••••') : a));
}

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/**
 * Wandelt die XML-Ausgabe von log4j (Mojang-Logkonfiguration) in lesbare Zeilen um.
 * feed(rohzeile) ruft emit(zeile) für jede fertige Zeile auf.
 */
function createLog4jParser(emit) {
  let buf = null;
  const flushEvent = (xml) => {
    const head = /<log4j:Event([^>]*)>/.exec(xml);
    const attr = (n) => {
      const m = head && new RegExp(`${n}="([^"]*)"`).exec(head[1]);
      return m ? unescapeXml(m[1]) : '';
    };
    const cdata = (tag) => {
      const m = new RegExp(`<log4j:${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></log4j:${tag}>`).exec(xml);
      if (m) return m[1];
      const m2 = new RegExp(`<log4j:${tag}>([\\s\\S]*?)</log4j:${tag}>`).exec(xml);
      return m2 ? unescapeXml(m2[1]) : '';
    };
    const ts = Number(attr('timestamp'));
    const time = ts ? new Date(ts).toTimeString().slice(0, 8) : '';
    const msg = cdata('Message');
    const thr = cdata('Throwable');
    const prefix = `[${time}] [${attr('thread')}/${attr('level')}]`;
    const lines = msg.split(/\r?\n/);
    emit(`${prefix}: ${lines[0]}`);
    for (const l of lines.slice(1)) emit(l);
    if (thr) for (const l of thr.replace(/\s+$/, '').split(/\r?\n/)) emit(l);
  };
  return {
    feed(line) {
      if (buf !== null) {
        buf.push(line);
        if (line.includes('</log4j:Event>')) {
          flushEvent(buf.join('\n'));
          buf = null;
        } else if (buf.length > 4000) {
          for (const l of buf) emit(l);
          buf = null;
        }
        return;
      }
      if (line.includes('<log4j:Event')) {
        if (line.includes('</log4j:Event>')) flushEvent(line);
        else buf = [line];
        return;
      }
      emit(line);
    },
    end() {
      if (buf) for (const l of buf) emit(l);
      buf = null;
    },
  };
}

/**
 * Startet den Prozess. Ausgabe geht direkt in eine Logdatei (überlebt das Schließen des Launchers).
 */
async function startProcess(cmd, { logFile, onLine, onExit, detached = true, env, javaMajor = 8 }) {
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  let args = cmd.args;
  // Windows begrenzt Befehlszeilen auf ~32k Zeichen -> ab Java 9 per @argfile
  if (javaMajor >= 9 && args.join(' ').length > 24000) {
    // Nur JVM-Optionen + Hauptklasse in die Datei – Spiel-Argumente (mit Token) landen nie auf der Platte
    const split = cmd.gameArgsFrom > 0 && cmd.gameArgsFrom <= args.length ? cmd.gameArgsFrom : args.length;
    const argFile = path.join(path.dirname(logFile), 'patina-args.txt');
    const q = (a) => `"${String(a).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    await fsp.writeFile(argFile, args.slice(0, split).map(q).join('\n'), 'utf8');
    args = [`@${argFile}`, ...args.slice(split)];
  }
  const fd = fs.openSync(logFile, 'w');
  const child = spawn(cmd.java, args, {
    cwd: cmd.cwd,
    detached,
    windowsHide: false,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, ...(env || {}) },
  });
  fs.closeSync(fd);
  let pos = 0;
  let buf = '';
  let stopped = false;
  const pump = async () => {
    try {
      const st = await fsp.stat(logFile);
      if (st.size > pos) {
        const h = await fsp.open(logFile, 'r');
        const len = Math.min(st.size - pos, 1024 * 1024);
        const b = Buffer.alloc(len);
        await h.read(b, 0, len, pos);
        await h.close();
        pos += len;
        buf += b.toString('utf8');
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        if (onLine) for (const l of lines) onLine(l);
      }
    } catch {}
  };
  const timer = setInterval(() => {
    if (!stopped) pump();
  }, 300);
  child.on('error', (e) => {
    stopped = true;
    clearInterval(timer);
    if (onExit) onExit({ code: -1, error: e });
  });
  child.on('exit', async (code, signal) => {
    stopped = true;
    clearInterval(timer);
    await pump();
    if (buf && onLine) onLine(buf);
    if (onExit) onExit({ code, signal });
  });
  if (detached) child.unref();
  return child;
}

module.exports = { buildCommand, startProcess, expandArgs, substitute, redact, createLog4jParser, LAUNCHER_NAME, LAUNCHER_VERSION };
