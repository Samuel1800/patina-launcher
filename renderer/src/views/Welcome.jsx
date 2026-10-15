import React, { useState } from 'react';
import { ArrowUpCircle, Zap, Sparkles, FolderInput } from 'lucide-react';
import { useStore, call } from '../store.jsx';
import { BlockFaces, Spinner } from '../ui.jsx';

function MsLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

// Kleine Block-Insel: [Material, x, y, z]
const ISLAND = [
  ['deepslate', 0, 2, 0],
  ['stone', 0, 0, 0],
  ['grass', 1, 0, 0],
  ['grass', 0, 1, 0],
  ['grass', 2, 0, 0],
  ['grass', 1, 1, 0],
  ['grass', 1, 2, 0],
  ['copper', 2, 1, 0],
  ['stone', 2, 2, 0],
  ['oak', 0, 0, 1],
  ['oak', 0, 0, 2],
  ['gold', 1, 1, 1],
  ['amethyst', 2, 2, 1],
].sort((p, q) => p[1] + p[2] - (q[1] + q[2]) || p[3] - q[3]);

export default function Welcome() {
  const { toast, refresh, run } = useStore();
  const [busy, setBusy] = useState(false);
  const login = async () => {
    setBusy(true);
    try {
      const a = await call('login');
      await run('setSettings', { onboarded: true });
      toast(`Willkommen, ${a.name}!`, 'ok');
      refresh();
    } catch (e) {
      if (!/abgebrochen/i.test(e.message)) toast(e.message, 'error', 10000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="welcome">
      <div className="left">
        <h1>
          Minecraft,
          <br />
          ohne Umwege.
        </h1>
        <div className="feature-list">
          <div>
            <ArrowUpCircle size={20} />
            <span>
              <b style={{ color: 'var(--text)' }}>Neue Version?</b> Ein Klick – deine Mods werden aktualisiert, Einstellungen und Welten bleiben.
            </span>
          </div>
          <div>
            <Zap size={20} />
            <span>
              <b style={{ color: 'var(--text)' }}>Spielen heißt spielen.</b> Minecraft startet direkt, ohne zweiten Launcher dazwischen.
            </span>
          </div>
          <div>
            <Sparkles size={20} />
            <span>
              <b style={{ color: 'var(--text)' }}>Shader per Klick.</b> Iris und Sodium richten sich selbst ein.
            </span>
          </div>
          <div>
            <FolderInput size={20} />
            <span>
              <b style={{ color: 'var(--text)' }}>Deine CurseForge-Instanzen</b> kannst du mit allen Mods und Welten übernehmen.
            </span>
          </div>
        </div>
        <button className="ms-btn" onClick={login} disabled={busy}>
          {busy ? <Spinner /> : <MsLogo />} Mit Microsoft anmelden
        </button>
        <button className="btn ghost sm" style={{ width: 'fit-content' }} onClick={() => run('setSettings', { onboarded: true })}>
          Erst mal umsehen
        </button>
      </div>
      <div className="right" aria-hidden="true">
        <svg viewBox="0 0 400 400" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
          {ISLAND.map(([m, gx, gy, gz], i) => {
            const k = 3.4;
            const x = 200 - 16 * k + (gx - gy) * 14 * k;
            const y = 120 + (gx + gy) * 7 * k - gz * 14 * k;
            return (
              <g key={i} transform={`translate(${x} ${y}) scale(${k})`}>
                <BlockFaces kind={m} />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
