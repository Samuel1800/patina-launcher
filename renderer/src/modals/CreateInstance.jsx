import React, { useEffect, useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
import { useStore, call } from '../store.jsx';
import { Modal, Seg, Toggle, BlockIcon, ICON_KINDS, Spinner, cls } from '../ui.jsx';

const LOADERS = [
  { value: 'vanilla', label: 'Vanilla' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
];

export function VersionPicker({ value, onChange, snapshots, height }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    call('versionList', { snapshots }).then(setList).catch(() => setList([]));
  }, [snapshots]);
  useEffect(() => {
    if (list && list.length && !value) onChange(list.find((v) => v.type === 'release').id);
  }, [list]); // eslint-disable-line
  const filtered = useMemo(() => (list || []).filter((v) => !q || v.id.includes(q.trim())), [list, q]);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="search">
        <Search size={15} />
        <input className="input" placeholder="Version suchen, z. B. 1.21" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="vlist" style={height ? { maxHeight: height } : null}>
        {!list && (
          <div className="row muted" style={{ padding: 12 }}>
            <Spinner /> Lade Versionen …
          </div>
        )}
        {filtered.map((v, idx) => (
          <button key={v.id} className={cls(value === v.id && 'on')} onClick={() => onChange(v.id)}>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v.id}</span>
            <span className="row" style={{ gap: 6 }}>
              {idx === 0 && !q && v.type === 'release' && <span className="chip ok">Neueste</span>}
              {v.type === 'snapshot' && <span className="chip am">Snapshot</span>}
              <span className="faint small">{new Date(v.releaseTime).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CreateInstance({ onClose }) {
  const { state, run, setRoute, toast } = useStore();
  const [name, setName] = useState('');
  const [game, setGame] = useState(null);
  const [loader, setLoader] = useState(state.settings.defaultLoader || 'fabric');
  const [avail, setAvail] = useState(null);
  const [loaderVersion, setLoaderVersion] = useState('');
  const [icon, setIcon] = useState(ICON_KINDS[Math.floor(Math.random() * ICON_KINDS.length)]);
  const [snapshots, setSnapshots] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!game) return;
    setAvail(null);
    let alive = true;
    call('loaderAvailability', game)
      .then((a) => {
        if (!alive) return;
        setAvail(a);
        if (loader !== 'vanilla' && !(a[loader] && a[loader].available)) {
          const alt = ['fabric', 'neoforge', 'quilt', 'forge'].find((l) => a[l] && a[l].available);
          setLoader(alt || 'vanilla');
        }
      })
      .catch(() => alive && setAvail({}));
    return () => {
      alive = false;
    };
  }, [game]); // eslint-disable-line

  useEffect(() => {
    if (avail && avail[loader]) setLoaderVersion(avail[loader].recommended || '');
    else setLoaderVersion('');
  }, [avail, loader]);

  const autoName = game ? `${loader === 'vanilla' ? 'Minecraft' : LOADERS.find((l) => l.value === loader).label} ${game}` : '';
  const create = async () => {
    setBusy(true);
    try {
      const inst = await run('createInstance', { name: name.trim() || autoName, game, loader, loaderVersion: loader === 'vanilla' ? null : loaderVersion || null, icon });
      toast(`${inst.name} angelegt – Spieldateien werden im Hintergrund geladen.`, 'ok');
      onClose();
      setRoute({ view: 'instance', id: inst.id });
    } catch {
      setBusy(false);
    }
  };

  const loaderOptions = LOADERS.map((l) => ({
    ...l,
    disabled: l.value !== 'vanilla' && avail && !(avail[l.value] && avail[l.value].available),
    title: l.value !== 'vanilla' && avail && !(avail[l.value] && avail[l.value].available) ? `${l.label} gibt es (noch) nicht für ${game}` : undefined,
  }));

  return (
    <Modal
      title="Neue Instanz"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!game || busy || (loader !== 'vanilla' && !avail)} onClick={create}>
            {busy && <Spinner />} Instanz anlegen
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        <div className="col" style={{ gap: 16 }}>
          <div className="field">
            <label htmlFor="iname">Name</label>
            <input id="iname" className="input" placeholder={autoName || 'Meine Instanz'} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Modloader</label>
            <Seg value={loader} onChange={setLoader} options={loaderOptions} />
            <div className="small muted" style={{ minHeight: 18 }}>
              {!avail && game ? (
                <span className="row" style={{ gap: 6 }}>
                  <Spinner size={13} /> Prüfe, welche Loader es für {game} gibt …
                </span>
              ) : loader === 'vanilla' ? (
                'Reines Minecraft. Für Mods oder Shader kannst du später mit einem Klick auf Fabric wechseln.'
              ) : loader === 'fabric' ? (
                'Leicht und schnell. Die meisten Performance-Mods und Iris-Shader laufen hier.'
              ) : loader === 'quilt' ? (
                'Fabric-kompatibel, mit eigenen Erweiterungen.'
              ) : loader === 'forge' ? (
                'Klassiker für große Modpacks, besonders 1.20.1 und älter.'
              ) : (
                'Moderner Forge-Nachfolger für große Mods ab 1.20.2.'
              )}
            </div>
          </div>
          <div className="field">
            <label>Symbol</label>
            <div className="icons">
              {ICON_KINDS.map((k) => (
                <button key={k} className={cls(icon === k && 'on')} onClick={() => setIcon(k)} aria-label={k} title={k}>
                  <BlockIcon kind={k} size={30} />
                </button>
              ))}
            </div>
          </div>
          {loader !== 'vanilla' && avail && avail[loader] && (
            <div>
              <button className="btn ghost sm" onClick={() => setAdvanced((a) => !a)} style={{ paddingLeft: 4 }}>
                {advanced ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Loader-Version
              </button>
              {advanced && (
                <select className="select" value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)} style={{ marginTop: 6 }}>
                  {avail[loader].versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version}
                      {v.version === avail[loader].recommended ? ' (empfohlen)' : v.stable === false ? ' (Beta)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label>Minecraft-Version</label>
            <label className="row small muted" style={{ gap: 8, fontWeight: 500 }}>
              Snapshots <Toggle on={snapshots} onChange={setSnapshots} label="Snapshots anzeigen" />
            </label>
          </div>
          <VersionPicker value={game} onChange={setGame} snapshots={snapshots} height={360} />
        </div>
      </div>
    </Modal>
  );
}
