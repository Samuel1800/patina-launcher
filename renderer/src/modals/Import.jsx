import React, { useEffect, useState } from 'react';
import { FolderOpen, Package } from 'lucide-react';
import { useStore, call } from '../store.jsx';
import { Modal, Seg, Toggle, Ver, LoaderChip, Spinner, plural, cls, fmtAgo } from '../ui.jsx';
import { VersionPicker } from './CreateInstance.jsx';

export default function ImportModal({ onClose }) {
  const [tab, setTab] = useState('curseforge');
  return (
    <Modal
      title="Importieren"
      sub="Mods, Einstellungen und Welten werden kopiert – das Original bleibt unverändert."
      onClose={onClose}
      wide
    >
      <div style={{ marginBottom: 14 }}>
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { value: 'curseforge', label: 'CurseForge' },
            { value: 'modrinth', label: 'Modrinth App' },
            { value: 'norisk', label: 'NoRisk Client' },
            { value: 'folder', label: 'Beliebiger Ordner' },
            { value: 'mrpack', label: 'Modpack-Datei' },
          ]}
        />
      </div>
      {tab === 'curseforge' && <ScanTab key="cf" source="curseforge" onDone={onClose} />}
      {tab === 'modrinth' && <ScanTab key="mr" source="modrinth" onDone={onClose} />}
      {tab === 'norisk' && <ScanTab key="nr" source="norisk" onDone={onClose} />}
      {tab === 'folder' && <FolderTab onDone={onClose} />}
      {tab === 'mrpack' && <MrpackTab onDone={onClose} />}
    </Modal>
  );
}

const SOURCES = {
  curseforge: { method: 'scanCurseForge', name: 'CurseForge', pick: 'CurseForge-Instanzordner wählen', where: 'Liegt dein CurseForge-Ordner woanders? Wähl ihn aus.' },
  modrinth: {
    method: 'scanModrinth',
    name: 'Modrinth App',
    pick: 'Datenordner der Modrinth App wählen (enthält „profiles“)',
    where: 'Die Modrinth App speichert ihre Instanzen normalerweise unter %APPDATA%\\ModrinthApp. Liegt der Ordner woanders, wähl ihn aus. Modrinth-Modpacks findest du außerdem unter „Entdecken“ → Modpacks.',
  },
  norisk: {
    method: 'scanNoRisk',
    name: 'NoRisk-Client',
    pick: 'Ordner des NoRisk-Launchers wählen (z. B. %APPDATA%\\norisk\\NoRiskClientV3)',
    where: 'Der NoRisk-Launcher speichert seine Profile normalerweise unter %APPDATA%\\norisk\\NoRiskClientV3. Liegt der Ordner woanders (eigener Spielordner), wähl ihn aus.',
    note: 'Übernommen werden Mods, Einstellungen, Welten, Ressourcenpakete und Shader. Der NoRisk-Client-Mod selbst läuft nur im NoRisk-Launcher und bleibt deshalb draußen.',
  },
};

function ScanTab({ source, onDone }) {
  const src = SOURCES[source];
  const { run, toast, setRoute } = useStore();
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [worlds, setWorlds] = useState(true);
  const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState([]);
  useEffect(() => {
    call(src.method, extra)
      .then((l) => setList(l))
      .catch(() => setList([]));
  }, [extra]);
  const idOf = (x) => x.key || x.path;
  const toggle = (p) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  const doImport = async () => {
    setBusy(true);
    const items = list.filter((x) => sel.has(idOf(x)));
    try {
      const ids = await run('importInstances', items, { includeWorlds: worlds });
      toast(`${plural(ids.length, 'Instanz', 'Instanzen')} übernommen.`, 'ok');
      onDone();
      if (ids.length === 1) setRoute({ view: 'instance', id: ids[0] });
    } catch {
      setBusy(false);
    }
  };
  const pick = async () => {
    const d = await call('pickFolder', src.pick);
    if (d) setExtra((e) => [...e, d]);
  };
  if (!list)
    return (
      <div className="row muted" style={{ padding: 20 }}>
        <Spinner /> Suche {src.name}-Instanzen …
      </div>
    );
  return (
    <div className="col" style={{ gap: 12 }}>
      {!list.length && (
        <div className="empty">
          <h2>Keine {src.name}-Instanzen gefunden</h2>
          <p style={{ maxWidth: '60ch', margin: '8px auto 0' }}>{src.where}</p>
        </div>
      )}
      {list.length > 0 && src.note && <div className="small muted">{src.note}</div>}
      {list.length > 0 && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn sm ghost" onClick={() => setSel(sel.size ? new Set() : new Set(list.filter((x) => !x.alreadyImported && x.game).map(idOf)))}>
            {sel.size ? 'Auswahl aufheben' : 'Alle auswählen'}
          </button>
          <span className="muted small">{plural(list.length, 'Instanz', 'Instanzen')} gefunden</span>
        </div>
      )}
      <div className="list" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {list.map((x) => (
          <label key={idOf(x)} className={cls('item', !x.game && 'off')} style={{ cursor: x.game ? 'pointer' : 'not-allowed' }} title={x.game ? undefined : 'Minecraft-Version unbekannt – bitte über „Beliebiger Ordner“ importieren'}>
            <input type="checkbox" disabled={!x.game} checked={sel.has(idOf(x))} onChange={() => toggle(idOf(x))} style={{ width: 17, height: 17, accentColor: 'var(--verdigris)' }} />
            <div className="grow">
              <div className="t ellipsis">{x.name}</div>
              <div className="s">
                {plural(x.mods, 'Mod', 'Mods')}, {plural(x.worlds, 'Welt', 'Welten')}
                {x.lastPlayed ? `, zuletzt ${fmtAgo(x.lastPlayed)}` : ''}
              </div>
            </div>
            {x.alreadyImported && <span className="chip ok">schon übernommen</span>}
            {x.game ? <Ver v={x.game} /> : <span className="chip warn">Version unbekannt</span>}
            <LoaderChip loader={x.loader} />
          </label>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <div className="row">
          <button className="btn sm" onClick={pick}>
            <FolderOpen size={15} /> Anderen Ordner wählen
          </button>
          <label className="row small" style={{ gap: 8 }}>
            <Toggle on={worlds} onChange={setWorlds} label="Welten mitnehmen" /> Welten mitnehmen
          </label>
        </div>
        <button className="btn primary" disabled={!sel.size || busy} onClick={doImport}>
          {busy && <Spinner />} {sel.size ? `${plural(sel.size, 'Instanz', 'Instanzen')} übernehmen` : 'Übernehmen'}
        </button>
      </div>
    </div>
  );
}

function FolderTab({ onDone }) {
  const { run, toast, setRoute } = useStore();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    const d = await call('pickFolder', 'Minecraft-Ordner wählen (z. B. .minecraft oder eine Instanz)');
    if (!d) return;
    const g = await call('guessFolder', d);
    setInfo(g);
  };
  const doImport = async () => {
    setBusy(true);
    try {
      const ids = await run('importInstances', [info], { includeWorlds: true });
      toast(`${info.name} übernommen.`, 'ok');
      onDone();
      setRoute({ view: 'instance', id: ids[0] });
    } catch {
      setBusy(false);
    }
  };
  if (!info) {
    return (
      <div className="empty">
        <h2>Ordner auswählen</h2>
        <p>Funktioniert mit .minecraft, Prism-, MultiMC-, Lunar- oder anderen Instanzordnern.</p>
        <button className="btn primary" onClick={pick}>
          <FolderOpen size={16} /> Ordner wählen
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      <div className="col" style={{ gap: 14 }}>
        <div className="field">
          <label>Name</label>
          <input className="input" value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} />
        </div>
        <div className="field">
          <label>Modloader</label>
          <Seg
            value={info.loader}
            onChange={(l) => setInfo({ ...info, loader: l, loaderVersion: null })}
            options={['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].map((l) => ({ value: l, label: { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }[l] }))}
          />
        </div>
        <div className="small muted" style={{ wordBreak: 'break-all' }}>
          Quelle: {info.path}
        </div>
        <div className="row">
          <button className="btn ghost sm" onClick={pick}>
            Anderen Ordner
          </button>
          <button className="btn primary" disabled={!info.game || busy} onClick={doImport}>
            {busy && <Spinner />} Übernehmen
          </button>
        </div>
      </div>
      <div className="field">
        <label>Minecraft-Version {info.game ? '' : '(bitte wählen)'}</label>
        <VersionPicker value={info.game} onChange={(g) => setInfo((i) => ({ ...i, game: g }))} snapshots={false} height={280} />
      </div>
    </div>
  );
}

function MrpackTab({ onDone }) {
  const { run, toast, setRoute } = useStore();
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    const files = await call('pickFiles', 'Modrinth-Modpack wählen', [{ name: 'Modrinth-Modpack', extensions: ['mrpack'] }]);
    if (!files.length) return;
    setBusy(true);
    try {
      const inst = await run('importMrpack', files[0]);
      toast(`${inst.name} installiert.`, 'ok');
      onDone();
      setRoute({ view: 'instance', id: inst.id });
    } catch {
      setBusy(false);
    }
  };
  return (
    <div className="empty">
      <Package size={34} color="var(--faint)" />
      <h2 style={{ marginTop: 10 }}>.mrpack-Datei installieren</h2>
      <p>Modrinth-Modpacks kannst du auch direkt unter „Entdecken“ installieren.</p>
      <button className="btn primary" onClick={pick} disabled={busy}>
        {busy ? <Spinner /> : <FolderOpen size={16} />} Datei wählen
      </button>
    </div>
  );
}
