import React, { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, UserPlus, Trash2 } from 'lucide-react';
import { useStore, call } from '../store.jsx';
import { Toggle, Seg, Spinner, fmtBytes, Logo } from '../ui.jsx';

export default function SettingsView() {
  const { state, run, toast, refresh } = useStore();
  const s = state.settings;
  const [mem, setMem] = useState(s.memoryMax);
  const [jvm, setJvm] = useState(s.jvmArgs || '');
  const [azure, setAzure] = useState(s.azureClientId || '');
  const [cfKey, setCfKey] = useState(s.curseforgeApiKey || '');
  const [storage, setStorage] = useState(null);
  const [java, setJava] = useState(null);
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);
  const set = (patch) => run('setSettings', patch);
  const maxMem = Math.max(2048, Math.min(32768, state.totalMemoryMb - 2048));

  useEffect(() => {
    call('storageInfo').then(setStorage).catch(() => {});
    call('javaRuntimes').then(setJava).catch(() => {});
    call('appInfo').then(setInfo).catch(() => {});
  }, []);

  const login = async () => {
    try {
      const a = await call('login');
      toast(`Angemeldet als ${a.name}`, 'ok');
      refresh();
    } catch (e) {
      if (!/abgebrochen/i.test(e.message)) toast(e.message, 'error', 9000);
    }
  };
  const changeRoot = async () => {
    const d = await call('pickFolder', 'Neuer Ordner für Spieldaten');
    if (d && window.confirm(`Spieldaten künftig in „${d}“ speichern? Patina startet dafür neu. Vorhandene Daten werden nicht verschoben.`)) await call('changeDataRoot', d);
  };
  const checkVersions = async () => {
    setChecking(true);
    try {
      const l = await call('refreshVersions');
      toast(`Versionsliste aktuell. Neueste Version: ${l.release}`, 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 860 }}>
        <h1 style={{ marginBottom: 20 }}>Einstellungen</h1>

        <Section title="Konto">
          {state.accounts.map((a) => (
            <div key={a.id} className="setting">
              <img src={`https://mc-heads.net/avatar/${a.uuid}/64`} width={32} height={32} style={{ borderRadius: 6, imageRendering: 'pixelated' }} alt="" />
              <div className="info">
                <div style={{ fontWeight: 600 }}>{a.name}</div>
                <div className="muted">{a.active ? 'Aktives Konto' : 'Microsoft-Konto'}</div>
              </div>
              {!a.active && (
                <button className="btn sm" onClick={() => run('setActiveAccount', a.id)}>
                  Verwenden
                </button>
              )}
              <button className="btn ghost sm icon" aria-label="Abmelden" title="Abmelden" onClick={() => run('removeAccount', a.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <div className="setting">
            <div className="info muted">{state.accounts.length ? 'Weiteres Konto hinzufügen' : 'Melde dich an, um zu spielen.'}</div>
            <button className="btn sm" onClick={login}>
              <UserPlus size={15} /> Mit Microsoft anmelden
            </button>
          </div>
        </Section>

        <Section title="Spielstart">
          <Setting title="Nach dem Start von Minecraft" desc="Ausblenden heißt: Patina verschwindet und taucht wieder auf, wenn du das Spiel beendest.">
            <select className="select" style={{ width: 230 }} value={s.afterLaunch} onChange={(e) => set({ afterLaunch: e.target.value })}>
              <option value="hide">Launcher ausblenden</option>
              <option value="minimize">Launcher minimieren</option>
              <option value="keep">Launcher offen lassen</option>
              <option value="close">Launcher beenden</option>
            </select>
          </Setting>
          <Setting title="Beim Öffnen von Patina" desc="„Direkt spielen“ startet sofort die zuletzt gespielte Instanz – ohne Launcher-Fenster.">
            <Seg
              value={s.startupAction}
              onChange={(v) => set({ startupAction: v })}
              options={[
                { value: 'library', label: 'Bibliothek zeigen' },
                { value: 'lastInstance', label: 'Direkt spielen' },
              ]}
            />
          </Setting>
        </Section>

        <Section title="Leistung">
          <Setting title="Arbeitsspeicher (Standard)" desc={`${(mem / 1024).toLocaleString('de-DE')} GB von ${(state.totalMemoryMb / 1024).toFixed(0)} GB. Für große Modpacks 6–8 GB.`}>
            <input type="range" className="range" style={{ width: 260 }} min={1024} max={maxMem} step={512} value={mem} onChange={(e) => setMem(Number(e.target.value))} onMouseUp={() => set({ memoryMax: mem })} onKeyUp={() => set({ memoryMax: mem })} aria-label="Arbeitsspeicher" />
          </Setting>
          <Setting title="Java-Argumente (global)" desc="Gelten für alle Instanzen.">
            <input className="input" style={{ width: 300 }} value={jvm} onChange={(e) => setJvm(e.target.value)} onBlur={() => jvm !== s.jvmArgs && set({ jvmArgs: jvm })} placeholder="leer lassen" />
          </Setting>
          <Setting title="Spieldateien vorab laden" desc="Lädt Minecraft, Loader und Java schon beim Anlegen oder Upgraden – „Spielen“ startet dann sofort.">
            <Toggle on={s.prefetch} onChange={(v) => set({ prefetch: v })} label="Vorab laden" />
          </Setting>
        </Section>

        <Section title="Versionen & Upgrades">
          <Setting title="Neueste Minecraft-Version" desc="Die Versionsliste kommt direkt von Mojang und aktualisiert sich alle 30 Minuten von selbst.">
            <div className="row">
              <span className="ver">{state.latest ? state.latest.release : '…'}</span>
              <button className="btn sm" onClick={checkVersions} disabled={checking}>
                {checking ? <Spinner size={14} /> : <RefreshCw size={14} />} Jetzt prüfen
              </button>
            </div>
          </Setting>
          <Setting title="Snapshots anzeigen" desc="Vorab-Versionen beim Anlegen und als Upgrade-Ziel.">
            <Toggle on={s.showSnapshots} onChange={(v) => set({ showSnapshots: v })} label="Snapshots" />
          </Setting>
          <Setting title="Welten bei Upgrades mitsichern" desc="Empfohlen: Minecraft wandelt Welten beim ersten Öffnen in einer neuen Version um.">
            <Toggle on={s.backupWorldsOnUpgrade} onChange={(v) => set({ backupWorldsOnUpgrade: v })} label="Welten sichern" />
          </Setting>
        </Section>

        <Section title="Speicher">
          <Setting title="Spieldaten-Ordner" desc={s.dataRoot}>
            <div className="row">
              <button className="btn sm" onClick={() => call('openDataFolder')}>
                <FolderOpen size={14} /> Öffnen
              </button>
              <button className="btn sm" onClick={changeRoot}>
                Ändern
              </button>
            </div>
          </Setting>
          {storage && (
            <div className="setting">
              <div className="info muted small">
                Instanzen {fmtBytes(storage.parts.instances)}, Bibliotheken {fmtBytes(storage.parts.libraries)}, Assets {fmtBytes(storage.parts.assets)}, Versionen {fmtBytes(storage.parts.versions)}, Java {fmtBytes(storage.parts.runtime)}
              </div>
            </div>
          )}
          <Setting title="Java" desc="Patina lädt automatisch die passende Java-Version (Eclipse Temurin) für jede Minecraft-Version.">
            <div className="row wrap" style={{ justifyContent: 'flex-end', maxWidth: 300 }}>
              {java && !java.length && <span className="muted small">noch keine geladen</span>}
              {(java || []).map((j) => (
                <span key={j.major} className="chip" title={j.release}>
                  Java {j.major}
                </span>
              ))}
            </div>
          </Setting>
        </Section>

        <Section title="Erweitert">
          <Setting title="CurseForge-API-Schlüssel" desc="Optional. Damit erkennt und aktualisiert Patina auch Mods, die es nur auf CurseForge gibt. Kostenlos auf console.curseforge.com.">
            <input className="input" type="password" style={{ width: 300 }} value={cfKey} onChange={(e) => setCfKey(e.target.value)} onBlur={() => cfKey !== (s.curseforgeApiKey || '') && set({ curseforgeApiKey: cfKey.trim() })} placeholder="$2a$10$…" autoComplete="off" />
          </Setting>
          <Setting title="Eigene Azure-App-ID" desc="Optional. Leer lassen nutzt den Standard-Login. Nur nötig, wenn du eine eigene, von Mojang freigegebene App hast.">
            <input className="input" style={{ width: 300 }} value={azure} onChange={(e) => setAzure(e.target.value)} onBlur={() => azure !== s.azureClientId && set({ azureClientId: azure.trim() })} placeholder="00000000-0000-…" />
          </Setting>
        </Section>

        <div className="row muted small" style={{ marginTop: 26, gap: 10 }}>
          <Logo size={20} />
          <span>
            Patina {info ? info.version : ''}. Mods, Shader und Modpacks kommen von Modrinth. Forge und NeoForge werden über deren offizielle Installer eingerichtet – wer die Projekte unterstützen möchte:{' '}
            <a href="https://www.patreon.com/LexManos/" target="_blank" rel="noreferrer">
              Forge
            </a>
            ,{' '}
            <a href="https://opencollective.com/neoforged" target="_blank" rel="noreferrer">
              NeoForge
            </a>
            .
          </span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h2 style={{ marginBottom: 8 }}>{title}</h2>
      <div className="panel pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {children}
      </div>
    </section>
  );
}

function Setting({ title, desc, children }) {
  return (
    <div className="setting">
      <div className="info">
        <div style={{ fontWeight: 600 }}>{title}</div>
        {desc && <div className="muted ellipsis" title={desc} style={{ whiteSpace: 'normal' }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}
