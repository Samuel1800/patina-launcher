import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowUpCircle, MoreHorizontal, FolderOpen, Copy, Trash2, Wrench, Link2, Plus, Search, RefreshCw, X,
  Sparkles, Package, Globe2, Settings2, History, ScrollText, Blocks, Check, Server, Play, FileUp, PowerOff, Clock, ChevronUp,
} from 'lucide-react';
import { useStore, useLaunch, call } from '../store.jsx';
import { BlockIcon, Ver, LoaderChip, Menu, Toggle, Img, Spinner, Progress, Seg, ICON_KINDS, cls, fmtAgo, fmtBytes, fmtNum, fmtPlay, plural } from '../ui.jsx';
import { PlayButton, PopularCard, QuickCard, useQuickItems } from './Library.jsx';
import UpgradeModal from '../modals/Upgrade.jsx';
import ProjectModal from '../modals/Project.jsx';

const KIND_LABEL = { mod: 'Mods', shader: 'Shader', resourcepack: 'Ressourcenpakete' };

export default function InstanceView({ id, initialTab }) {
  const { state, setRoute, route, tasks, run, toast } = useStore();
  const inst = state.instances.find((i) => i.id === id);
  const [tab, setTab] = useState(initialTab || (inst && inst.loader === 'vanilla' ? 'resourcepack' : 'mod'));
  const [upgradeOpen, setUpgradeOpen] = useState(Boolean(route.upgrade));
  const [menu, setMenu] = useState(false);
  const moreRef = useRef(null);

  if (!inst) {
    return (
      <div className="empty">
        <h2>Instanz nicht gefunden</h2>
        <button className="btn" onClick={() => setRoute({ view: 'library' })}>
          Zur Bibliothek
        </button>
      </div>
    );
  }
  const task = tasks.find((t) => t.instanceId === id && t.state === 'running');
  const tabs = [
    { id: 'mod', label: 'Mods', icon: <Blocks size={16} />, count: inst.loader !== 'vanilla' ? inst.mods : null },
    { id: 'shader', label: 'Shader', icon: <Sparkles size={16} /> },
    { id: 'resourcepack', label: 'Ressourcenpakete', icon: <Package size={16} /> },
    { id: 'worlds', label: 'Welten & Server', icon: <Globe2 size={16} /> },
    { id: 'settings', label: 'Einstellungen', icon: <Settings2 size={16} /> },
    { id: 'backups', label: 'Sicherungen', icon: <History size={16} /> },
    { id: 'log', label: 'Protokoll', icon: <ScrollText size={16} /> },
  ];

  const shortcut = async () => {
    const f = await run('createShortcut', id);
    toast(`Verknüpfung „${inst.name}“ liegt auf dem Desktop. Ein Doppelklick startet Minecraft direkt.`, 'ok', 7000);
    return f;
  };
  const remove = async () => {
    if (!window.confirm(`„${inst.name}“ wirklich löschen? Der Ordner (inkl. Welten) wandert in den Papierkorb.`)) return;
    await run('deleteInstance', id);
    setRoute({ view: 'library' });
  };

  return (
    <div className="inst-layout">
      <div className="inst-head">
        {inst.cover && <img className="inst-cover" src={`bwfile://inst/${inst.id}/${inst.cover.split('/').map(encodeURIComponent).join('/')}?w=1600`} alt="" draggable={false} />}
        <div className="inst-shade" />
        <div className="row" style={{ gap: 14 }}>
          <button className="btn ghost icon" onClick={() => setRoute({ view: 'library' })} aria-label="Zurück">
            <ArrowLeft size={18} />
          </button>
          <BlockIcon kind={inst.icon} size={58} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="name ellipsis" title={inst.name}>
            {inst.name}
          </div>
          <div className="row wrap" style={{ gap: 7, marginTop: 8 }}>
            <Ver v={inst.game} />
            {inst.upgrade && inst.upgrade.newer && (
              <button className="update-chip" onClick={() => setUpgradeOpen(true)} title={`Mods, Einstellungen und Welten auf ${inst.upgrade.latest} mitnehmen`}>
                <ChevronUp size={13} strokeWidth={2.6} /> {inst.upgrade.latest} verfügbar
              </button>
            )}
            <LoaderChip loader={inst.loader} name={inst.loader === 'vanilla' ? inst.loaderName : `${inst.loaderName}${inst.loaderVersion ? ` ${inst.loaderVersion}` : ''}`} version={inst.loaderVersion} />
            <span className="chip">
              <Clock size={12} /> {fmtPlay(inst.playTime)}
            </span>
            {inst.running && (
              <span className="chip ok">
                <span className="dot live" style={{ width: 6, height: 6 }} /> läuft
              </span>
            )}
          </div>
          {task && (
            <div style={{ marginTop: 10, maxWidth: 460 }}>
              <div className="small muted ellipsis" style={{ marginBottom: 5 }}>
                {task.title}: {task.label}
              </div>
              <Progress value={task.done} total={task.total} />
            </div>
          )}
        </div>
        <div className="row" style={{ position: 'relative' }}>
          <PlayButton inst={inst} task={task} size="lg" />
          <button ref={moreRef} className="btn icon glass" style={{ width: 46, height: 46 }} onClick={() => setMenu((m) => !m)} aria-label="Mehr">
            <MoreHorizontal size={22} strokeWidth={2.4} />
          </button>
          {menu && (
            <Menu anchor={moreRef.current} onClose={() => setMenu(false)}>
              <button onClick={() => setUpgradeOpen(true)}>
                <ArrowUpCircle size={16} /> Minecraft-Version ändern
              </button>
              <button onClick={() => call('openFolder', id)}>
                <FolderOpen size={16} /> Ordner öffnen
              </button>
              {window.bw.platform === 'win32' && (
                <button onClick={shortcut}>
                  <Link2 size={16} /> Desktop-Verknüpfung (Direktstart)
                </button>
              )}
              <button onClick={() => run('duplicateInstance', id).then((n) => setRoute({ view: 'instance', id: n.id }))}>
                <Copy size={16} /> Duplizieren
              </button>
              <button onClick={() => run('repair', id).then(() => toast('Dateien geprüft und repariert.', 'ok'))}>
                <Wrench size={16} /> Dateien reparieren
              </button>
              <hr />
              <button className="danger" onClick={remove}>
                <Trash2 size={16} /> Instanz löschen
              </button>
            </Menu>
          )}
        </div>
      </div>
      <div>
        <PendingBanner inst={inst} />
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} className={cls(tab === t.id && 'on')} onClick={() => setTab(t.id)} role="tab" aria-selected={tab === t.id}>
              {t.icon}
              {t.label}
              {t.count != null && <span className="count">{t.count}</span>}
            </button>
          ))}
        </nav>
      </div>
      <div className="inst-main-wrap">
        <div className="inst-main">
          {(tab === 'mod' || tab === 'shader' || tab === 'resourcepack') && <ContentTab key={tab} inst={inst} kind={tab} />}
          {tab === 'worlds' && <WorldsTab inst={inst} />}
          {tab === 'settings' && <SettingsTab inst={inst} onShortcut={shortcut} />}
          {tab === 'backups' && <BackupsTab inst={inst} />}
          {tab === 'log' && <LogTab inst={inst} />}
        </div>
        <InstanceSide inst={inst} tab={tab} onTab={setTab} />
      </div>
      {upgradeOpen && <UpgradeModal inst={inst} onClose={() => setUpgradeOpen(false)} />}
    </div>
  );
}

function PendingBanner({ inst }) {
  const { run, toast } = useStore();
  const [list, setList] = useState(null);
  useEffect(() => {
    if (!inst.pending) {
      setList(null);
      return;
    }
    call('checkPending', inst.id).then(setList).catch(() => setList(null));
  }, [inst.id, inst.pending, inst.game]);
  if (!list || !list.length) return null;
  const avail = list.filter((p) => p.available);
  const waiting = list.filter((p) => !p.available && (p.projectId || (p.cfProjectId && !p.needsKey)));
  const cfOnly = list.filter((p) => !p.projectId && p.cfProjectId && p.needsKey);
  const unknown = list.filter((p) => !p.projectId && !p.cfProjectId);
  const apply = async () => {
    const n = await run('applyPending', inst.id, null);
    toast(`${plural(n, 'Mod', 'Mods')} aktualisiert und wieder aktiviert.`, 'ok');
  };
  const dismissUnknown = async () => {
    for (const p of unknown) await call('dismissPending', inst.id, p.key);
  };
  return (
    <div className="banner" style={{ margin: '12px 24px 0' }}>
      <span className="dot" style={{ background: avail.length ? 'var(--verdigris)' : waiting.length ? 'var(--gold)' : 'var(--faint)', flex: 'none' }} />
      <div className="grow">
        {avail.length > 0 && (
          <>
            <b>{avail.length === 1 ? `${avail[0].title} ist jetzt für ${inst.game} verfügbar.` : `${avail.length} geparkte Mods sind jetzt für ${inst.game} verfügbar.`}</b>
            <div className="small muted">{avail.map((a) => a.title).join(', ')}</div>
          </>
        )}
        {!avail.length && waiting.length > 0 && (
          <>
            <b>{plural(waiting.length, 'Mod wartet', 'Mods warten')} auf eine Version für {inst.game}.</b>
            <div className="small muted">{waiting.map((a) => a.title).join(', ')} – Patina prüft bei jedem Start und meldet sich, sobald es sie gibt.</div>
          </>
        )}
        {!avail.length && !waiting.length && cfOnly.length > 0 && (
          <>
            <b>{plural(cfOnly.length, 'CurseForge-Mod ist', 'CurseForge-Mods sind')} geparkt.</b>
            <div className="small muted">{cfOnly.map((a) => a.title).join(', ')} – mit einem CurseForge-API-Schlüssel (Einstellungen → Erweitert) zieht Patina sie automatisch nach.</div>
          </>
        )}
        {!avail.length && !waiting.length && !cfOnly.length && unknown.length > 0 && (
          <>
            <b>{plural(unknown.length, 'lokale Mod-Datei wurde', 'lokale Mod-Dateien wurden')} beim Upgrade deaktiviert.</b>
            <div className="small muted">{unknown.map((a) => a.title).join(', ')} – nicht auf Modrinth, also bitte selbst eine passende Version besorgen.</div>
          </>
        )}
      </div>
      {avail.length > 0 && (
        <button className="btn sm primary" onClick={apply}>
          Aktualisieren & aktivieren
        </button>
      )}
      {!avail.length && !waiting.length && !cfOnly.length && unknown.length > 0 && (
        <button className="btn sm" onClick={dismissUnknown}>
          Verstanden
        </button>
      )}
    </div>
  );
}

// ======================= Inhalte =======================

function ContentTab({ inst, kind }) {
  const { run, toast, contentRev } = useStore();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [browse, setBrowse] = useState(false);
  const [updates, setUpdates] = useState(null);
  const [checking, setChecking] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(() => call('listContent', inst.id, kind).then(setData).catch((e) => toast(e.message, 'error')), [inst.id, kind, toast]);
  useEffect(() => {
    load();
  }, [load, contentRev, inst.game, inst.loader]);

  const items = useMemo(() => {
    if (!data) return [];
    const f = q.trim().toLowerCase();
    return data.items.filter((i) => !f || i.title.toLowerCase().includes(f) || i.file.toLowerCase().includes(f));
  }, [data, q]);
  const upMap = useMemo(() => new Map((updates || []).filter((u) => u.kind === kind).map((u) => [u.key, u])), [updates, kind]);

  const checkUpdates = async () => {
    setChecking(true);
    try {
      const u = await call('checkUpdates', inst.id);
      setUpdates(u);
      const mine = u.filter((x) => x.kind === kind);
      if (!mine.length) toast('Alles aktuell.', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setChecking(false);
    }
  };
  const applyUpdates = async (list) => {
    await run('applyUpdates', inst.id, list);
    setUpdates((u) => (u || []).filter((x) => !list.some((l) => l.key === x.key)));
    toast(`${plural(list.length, 'Inhalt', 'Inhalte')} aktualisiert.`, 'ok');
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDrag(false);
    const files = [...e.dataTransfer.files].map((f) => window.bw.pathForFile(f)).filter(Boolean);
    if (!files.length) return;
    await run('addLocalContent', inst.id, files, kind);
    toast(`${plural(files.length, 'Datei', 'Dateien')} hinzugefügt.`, 'ok');
  };
  const addFiles = async () => {
    const ext = kind === 'mod' ? ['jar'] : ['zip'];
    const files = await call('pickFiles', 'Dateien hinzufügen', [{ name: KIND_LABEL[kind], extensions: ext }]);
    if (files.length) await run('addLocalContent', inst.id, files, kind);
  };

  const needsLoader = (kind === 'mod' || kind === 'shader') && inst.loader === 'vanilla';
  const toggleItem = async (it) => {
    setBusyKey(it.key);
    try {
      if (kind === 'resourcepack') await run('setResourcePack', inst.id, it.file, !it.active);
      else await run('setContentEnabled', inst.id, it.key, !it.enabled);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className={cls('inst-body', browse && 'split')} style={{ height: '100%' }}>
      <div className={cls('pane', drag && 'dropzone')} onDragOver={(e) => (e.preventDefault(), setDrag(true))} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        {needsLoader ? (
          <SwitchToLoader inst={inst} kind={kind} />
        ) : (
          <>
            {kind === 'shader' && data && <ShaderStatus inst={inst} data={data} onChange={load} />}
            <div className="row" style={{ marginBottom: 14 }}>
              <div className="search grow" style={{ maxWidth: 320 }}>
                <Search size={15} />
                <input className="input" placeholder={`${KIND_LABEL[kind]} durchsuchen`} value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 34 }} />
              </div>
              <div className="grow" />
              {upMap.size > 0 ? (
                <button className="btn sm primary" onClick={() => applyUpdates([...upMap.values()])}>
                  <RefreshCw size={14} /> {plural(upMap.size, 'Update', 'Updates')} installieren
                </button>
              ) : (
                <button className="btn sm" onClick={checkUpdates} disabled={checking}>
                  {checking ? <Spinner size={14} /> : <RefreshCw size={14} />} Nach Updates suchen
                </button>
              )}
              <button className="btn sm icon" title="Datei hinzufügen" onClick={addFiles} aria-label="Datei hinzufügen">
                <FileUp size={15} />
              </button>
              <button className="btn sm icon" title="Ordner öffnen" onClick={() => call('openFolder', inst.id, { mod: 'mods', shader: 'shaderpacks', resourcepack: 'resourcepacks' }[kind])} aria-label="Ordner öffnen">
                <FolderOpen size={15} />
              </button>
              <button className={cls('btn sm', !browse && 'primary')} onClick={() => setBrowse((b) => !b)}>
                {browse ? <X size={15} /> : <Plus size={15} />} {browse ? 'Schließen' : `${KIND_LABEL[kind]} hinzufügen`}
              </button>
            </div>
            {!data && (
              <div className="row muted" style={{ padding: 20 }}>
                <Spinner /> Lese Inhalte …
              </div>
            )}
            {data && !data.items.length && (
              <div className="empty">
                <h2>Noch keine {KIND_LABEL[kind]}</h2>
                <p>Füg welche über „{KIND_LABEL[kind]} hinzufügen“ hinzu oder zieh Dateien hier hinein.</p>
                {!browse && (
                  <button className="btn primary" onClick={() => setBrowse(true)}>
                    <Plus size={16} /> {KIND_LABEL[kind]} finden
                  </button>
                )}
              </div>
            )}
            <div className="list cards">
              {items.map((it) => {
                const up = upMap.get(it.key);
                const isOn = kind === 'resourcepack' ? it.active : kind === 'shader' ? data.active === it.file : it.enabled;
                return (
                  <div key={it.key} className={cls('item', kind === 'mod' && !it.enabled && 'off')}>
                    <div className="ico">
                      <Img src={it.icon} />
                    </div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="t ellipsis">{it.title}</div>
                      <div className="s ellipsis">
                        {it.version || it.file}
                        {it.source === 'local' && <span className="chip" style={{ marginLeft: 8, padding: '0 6px' }}>lokal</span>}
                        {it.source === 'curseforge' && <span className="chip am" style={{ marginLeft: 8, padding: '0 6px' }}>CurseForge</span>}
                      </div>
                    </div>
                    {up && (
                      <button className="btn sm" onClick={() => applyUpdates([up])} title={`${up.from} → ${up.to}`}>
                        <ArrowUpCircle size={14} color="var(--copper)" /> {up.to}
                      </button>
                    )}
                    {kind === 'shader' ? (
                      isOn ? (
                        <span className="chip ok">
                          <Check size={13} /> Aktiv
                        </span>
                      ) : (
                        <button className="btn sm" onClick={() => run('activateShader', inst.id, it.file).then(load)}>
                          Aktivieren
                        </button>
                      )
                    ) : (
                      <Toggle on={isOn} onChange={() => toggleItem(it)} disabled={busyKey === it.key} label={isOn ? 'Deaktivieren' : 'Aktivieren'} />
                    )}
                    <button className="btn ghost sm icon" title="Entfernen" aria-label="Entfernen" onClick={() => run('removeContent', inst.id, it.key)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {browse && !needsLoader && <BrowsePane inst={inst} kind={kind} installed={data ? data.items : []} />}
    </div>
  );
}

function SwitchToLoader({ inst, kind }) {
  const { run, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await run('changeLoader', inst.id, 'fabric');
      toast(`${inst.name} nutzt jetzt Fabric. Deine Welten und Einstellungen bleiben.`, 'ok');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="empty">
      <h2>{kind === 'shader' ? 'Shader brauchen einen Modloader' : 'Vanilla lädt keine Mods'}</h2>
      <p style={{ maxWidth: '52ch', margin: '8px auto 16px' }}>
        Stell die Instanz auf Fabric um – Welten, Einstellungen und Ressourcenpakete bleiben. {kind === 'shader' ? 'Iris und Sodium richtet Patina danach automatisch ein.' : ''}
      </p>
      <button className="btn primary" onClick={go} disabled={busy}>
        {busy && <Spinner />} Auf Fabric umstellen
      </button>
    </div>
  );
}

function ShaderStatus({ inst, data, onChange }) {
  const { run } = useStore();
  const st = data.status || {};
  return (
    <div className="panel pad" style={{ marginBottom: 16, display: 'flex', gap: 14, alignItems: 'center' }}>
      <Sparkles size={22} color="var(--amethyst)" />
      <div className="grow">
        <div style={{ fontWeight: 600 }}>
          {data.active ? `Aktiver Shader: ${data.active.replace(/\.zip$/i, '')}` : 'Shader sind aus'}
        </div>
        <div className="small muted">
          {st.ready
            ? `${st.mod === 'oculus' ? 'Oculus' : 'Iris'} ist installiert. Patina schaltet den gewählten Shader beim nächsten Start ein.`
            : st.supported
            ? `Beim ersten Shader installiert Patina automatisch ${st.mod === 'oculus' ? 'Oculus' : 'Iris + Sodium'}.`
            : `Für ${inst.game} gibt es noch keinen Shader-Mod für ${inst.loaderName}.`}
        </div>
      </div>
      {data.active && (
        <button className="btn sm" onClick={() => run('activateShader', inst.id, null).then(onChange)}>
          <PowerOff size={14} /> Shader aus
        </button>
      )}
    </div>
  );
}

function BrowsePane({ inst, kind, installed }) {
  const { run, toast } = useStore();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState({});
  const [detail, setDetail] = useState(null);
  const [allVersions, setAllVersions] = useState(kind !== 'mod');
  const installedIds = useMemo(() => new Set(installed.map((i) => i.projectId).filter(Boolean)), [installed]);
  const loaders = kind === 'mod' ? (inst.loader === 'quilt' ? ['quilt', 'fabric'] : [inst.loader]) : kind === 'shader' ? [] : [];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await call('search', { query: q, type: kind, gameVersion: allVersions && kind !== 'mod' ? null : inst.game, loaders, limit: 30 });
        if (alive) setRes(r);
      } catch (e) {
        if (alive) setRes({ hits: [], error: e.message });
      } finally {
        if (alive) setLoading(false);
      }
    }, q ? 300 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, kind, inst.game, inst.loader, allVersions]); // eslint-disable-line

  const install = async (hit) => {
    setBusy((b) => ({ ...b, [hit.id]: true }));
    try {
      const r = await run('installContent', inst.id, hit.id, { kind, title: hit.title });
      const deps = (r.installed || []).filter((x) => x.dependency).map((x) => x.title);
      toast(`${hit.title} installiert${deps.length ? ` (+ ${deps.join(', ')})` : ''}.${r.warnings && r.warnings.length ? `\n${r.warnings.join('\n')}` : ''}`, r.warnings && r.warnings.length ? 'info' : 'ok', 6000);
    } catch {
      /* Toast kommt aus run */
    } finally {
      setBusy((b) => ({ ...b, [hit.id]: false }));
    }
  };

  return (
    <div className="pane">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 className="grow">{KIND_LABEL[kind]} finden</h3>
        <span className="chip">
          für {inst.game}
          {kind === 'mod' ? ` + ${inst.loaderName}` : ''}
        </span>
      </div>
      <div className="search" style={{ margin: '10px 0' }}>
        <Search size={15} />
        <input className="input" autoFocus placeholder="Name oder Stichwort" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {kind !== 'mod' && (
        <label className="row small muted" style={{ gap: 8, marginBottom: 10 }}>
          <Toggle on={!allVersions} onChange={(v) => setAllVersions(!v)} label="Nur passende Version" /> Nur für {inst.game} markierte anzeigen
        </label>
      )}
      {loading && !res && (
        <div className="row muted" style={{ padding: 12 }}>
          <Spinner /> Suche …
        </div>
      )}
      {res && res.error && <div className="hint-box">{res.error}</div>}
      <div className="results compact" style={{ gridTemplateColumns: '1fr', opacity: loading ? 0.6 : 1 }}>
        {res &&
          res.hits.map((h) => {
            const has = installedIds.has(h.id);
            return (
              <div key={h.id} className="result" onClick={() => setDetail(h)} role="button" tabIndex={0}>
                <Img src={h.icon} />
                <div style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 600 }}>
                    {h.title}
                  </div>
                  <div className="desc">{h.description}</div>
                  <div className="faint small">{fmtNum(h.downloads)} Downloads</div>
                </div>
                {has ? (
                  <span className="chip ok">
                    <Check size={13} /> Drin
                  </span>
                ) : (
                  <button className="btn sm primary" disabled={busy[h.id]} onClick={(e) => (e.stopPropagation(), install(h))}>
                    {busy[h.id] ? <Spinner size={14} /> : <Plus size={14} />}
                  </button>
                )}
              </div>
            );
          })}
        {res && !res.hits.length && !res.error && <div className="empty small">Nichts gefunden für {inst.game}.</div>}
      </div>
      {detail && <ProjectModal hit={detail} kind={kind} inst={inst} installed={installedIds.has(detail.id)} onClose={() => setDetail(null)} onInstall={() => install(detail)} />}
    </div>
  );
}

// ======================= Welten =======================

function WorldsTab({ inst }) {
  const launch = useLaunch();
  const [d, setD] = useState(null);
  useEffect(() => {
    call('instanceDetails', inst.id).then(setD).catch(() => setD({ worlds: [], servers: [] }));
  }, [inst.id, inst.lastPlayed]);
  if (!d)
    return (
      <div className="pane row muted">
        <Spinner /> Lese Welten …
      </div>
    );
  return (
    <div className="pane" style={{ height: '100%' }}>
      <div className="section-head" style={{ marginTop: 0 }}>
        <h2>Welten</h2>
        <button className="btn sm" onClick={() => call('openFolder', inst.id, 'saves')}>
          <FolderOpen size={15} /> Ordner öffnen
        </button>
      </div>
      {!d.worlds.length && <div className="muted">Noch keine Welten – starte das Spiel und leg eine an.</div>}
      <div className="list cards">
        {d.worlds.map((w) => (
          <div key={w.folder} className="item">
            <div className="ico">
              {w.hasIcon ? <img src={`bwfile://inst/${inst.id}/saves/${encodeURIComponent(w.folder)}/icon.png`} alt="" /> : <Globe2 size={18} />}
            </div>
            <div className="grow">
              <div className="t">{w.folder}</div>
              <div className="s">zuletzt {fmtAgo(w.lastPlayed)}</div>
            </div>
            <button className="btn sm" onClick={() => launch(inst.id, { quickPlay: { type: 'singleplayer', target: w.folder } })} title="Startet Minecraft und lädt direkt diese Welt">
              <Play size={14} /> Direkt in Welt
            </button>
          </div>
        ))}
      </div>
      <div className="section-head">
        <h2>Server</h2>
      </div>
      {!d.servers.length && <div className="muted">Keine gespeicherten Server. Server, die du im Spiel hinzufügst, erscheinen hier.</div>}
      <div className="list cards">
        {d.servers.map((s) => (
          <div key={s.ip + s.name} className="item">
            <div className="ico">
              <Server size={18} />
            </div>
            <div className="grow">
              <div className="t">{s.name}</div>
              <div className="s">{s.ip}</div>
            </div>
            <button className="btn sm" onClick={() => launch(inst.id, { quickPlay: { type: 'multiplayer', target: s.ip } })}>
              <Play size={14} /> Direkt beitreten
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ======================= Einstellungen =======================

function SettingsTab({ inst, onShortcut }) {
  const { state, run, toast } = useStore();
  const [name, setName] = useState(inst.name);
  const [mem, setMem] = useState(inst.memory && inst.memory.max ? inst.memory.max : null);
  const [jvm, setJvm] = useState(inst.jvmArgs || '');
  const [avail, setAvail] = useState(null);
  const [details, setDetails] = useState(null);
  const total = state.totalMemoryMb;
  const maxMem = Math.max(2048, Math.min(32768, total - 2048));
  useEffect(() => {
    if (inst.loader !== 'vanilla') call('loaderAvailability', inst.game).then(setAvail).catch(() => {});
    call('instanceDetails', inst.id).then(setDetails).catch(() => {});
  }, [inst.id, inst.game, inst.loader]);
  const save = (patch) => run('updateInstance', inst.id, patch);
  const qp = inst.quickPlay;

  return (
    <div className="pane" style={{ height: '100%' }}>
      <div style={{ maxWidth: 760 }}>
        <div className="panel pad">
          <div className="setting">
            <div className="info">
              <div style={{ fontWeight: 600 }}>Name</div>
            </div>
            <input className="input" style={{ width: 300 }} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== inst.name && save({ name })} />
          </div>
          <div className="setting">
            <div className="info">
              <div style={{ fontWeight: 600 }}>Symbol</div>
            </div>
            <div className="icons" style={{ maxWidth: 420 }}>
              {ICON_KINDS.map((k) => (
                <button key={k} className={cls(inst.icon === k && 'on')} onClick={() => save({ icon: k })} aria-label={k}>
                  <BlockIcon kind={k} size={26} />
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <div className="info">
              <div style={{ fontWeight: 600 }}>Arbeitsspeicher</div>
              <div className="muted">{mem ? `${(mem / 1024).toLocaleString('de-DE')} GB für diese Instanz` : `Standard aus den Launcher-Einstellungen (${(state.settings.memoryMax / 1024).toLocaleString('de-DE')} GB)`}</div>
            </div>
            <div className="row" style={{ width: 300 }}>
              <input
                type="range"
                className="range"
                min={1024}
                max={maxMem}
                step={512}
                value={mem || state.settings.memoryMax}
                onChange={(e) => setMem(Number(e.target.value))}
                onMouseUp={() => save({ memory: mem ? { max: mem } : null })}
                onKeyUp={() => save({ memory: mem ? { max: mem } : null })}
                aria-label="Arbeitsspeicher"
              />
              {mem && (
                <button className="btn ghost sm" onClick={() => (setMem(null), save({ memory: null }))}>
                  Standard
                </button>
              )}
            </div>
          </div>
          {inst.loader !== 'vanilla' && (
            <div className="setting">
              <div className="info">
                <div style={{ fontWeight: 600 }}>{inst.loaderName}-Version</div>
                <div className="muted">Neuere Loader-Versionen beheben oft Fehler.</div>
              </div>
              <select
                className="select"
                style={{ width: 220 }}
                value={inst.loaderVersion || ''}
                onChange={(e) => save({ loaderVersion: e.target.value }).then(() => toast('Loader-Version geändert – wird beim nächsten Start installiert.', 'ok'))}
              >
                {inst.loaderVersion && !(avail && avail[inst.loader] && avail[inst.loader].versions.some((v) => v.version === inst.loaderVersion)) && <option value={inst.loaderVersion}>{inst.loaderVersion}</option>}
                {avail &&
                  avail[inst.loader] &&
                  avail[inst.loader].versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version}
                      {v.version === avail[inst.loader].recommended ? ' (empfohlen)' : ''}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div className="setting">
            <div className="info">
              <div style={{ fontWeight: 600 }}>Beim Start direkt beitreten</div>
              <div className="muted">Minecraft lädt sofort diesen Server oder diese Welt – ohne Titelbildschirm.</div>
            </div>
            <select
              className="select"
              style={{ width: 260 }}
              value={qp ? `${qp.type}|${qp.target}` : ''}
              onChange={(e) => {
                const v = e.target.value;
                save({ quickPlay: v ? { type: v.split('|')[0], target: v.split('|').slice(1).join('|') } : null });
              }}
            >
              <option value="">Aus (Titelbildschirm)</option>
              {details &&
                details.servers.map((s) => (
                  <option key={s.ip} value={`multiplayer|${s.ip}`}>
                    Server: {s.name}
                  </option>
                ))}
              {details &&
                details.worlds.map((w) => (
                  <option key={w.folder} value={`singleplayer|${w.folder}`}>
                    Welt: {w.folder}
                  </option>
                ))}
            </select>
          </div>
          {window.bw.platform === 'win32' && (
            <div className="setting">
              <div className="info">
                <div style={{ fontWeight: 600 }}>Desktop-Verknüpfung</div>
                <div className="muted">Doppelklick startet direkt Minecraft – der Launcher bleibt unsichtbar.</div>
              </div>
              <button className="btn" onClick={onShortcut}>
                <Link2 size={15} /> Erstellen
              </button>
            </div>
          )}
          <div className="setting" style={{ alignItems: 'flex-start' }}>
            <div className="info">
              <div style={{ fontWeight: 600 }}>Java-Argumente</div>
              <div className="muted">Nur für Profis. Wird zusätzlich zu den globalen Argumenten übergeben.</div>
            </div>
            <textarea className="input" rows={2} style={{ width: 300 }} value={jvm} onChange={(e) => setJvm(e.target.value)} onBlur={() => jvm !== (inst.jvmArgs || '') && save({ jvmArgs: jvm })} placeholder="-XX:+UseZGC" />
          </div>
          <div className="setting">
            <div className="info">
              <div style={{ fontWeight: 600 }}>Modloader wechseln</div>
              <div className="muted">Mods eines anderen Loaders funktionieren danach nicht mehr.</div>
            </div>
            <select className="select" style={{ width: 220 }} value={inst.loader} onChange={(e) => window.confirm(`Wirklich auf ${e.target.value} wechseln?`) && run('changeLoader', inst.id, e.target.value)}>
              {['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].map((l) => (
                <option key={l} value={l}>
                  {{ vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }[l]}
                </option>
              ))}
            </select>
          </div>
          <div className="setting">
            <div className="info">
              <div style={{ fontWeight: 600 }}>Speicherort</div>
              <div className="muted ellipsis" style={{ userSelect: 'text' }}>
                {inst.dir}
              </div>
            </div>
            <button className="btn" onClick={() => call('openFolder', inst.id)}>
              <FolderOpen size={15} /> Öffnen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ======================= Sicherungen =======================

function BackupsTab({ inst }) {
  const { run, toast } = useStore();
  const [list, setList] = useState(null);
  const load = useCallback(() => call('backups', inst.id).then(setList), [inst.id]);
  useEffect(() => {
    load();
  }, [load, inst.game]);
  const restore = async (b) => {
    if (!window.confirm(`Sicherung vom ${new Date(b.at).toLocaleString('de-DE')} (Minecraft ${b.game}) wiederherstellen? Mods und Configs werden ersetzt${b.includesWorlds ? ', gesicherte Welten zurückgespielt' : ''}.`)) return;
    await run('restoreBackup', inst.id, b.id);
    toast(`Zurück auf ${b.game}.`, 'ok');
    load();
  };
  return (
    <div className="pane" style={{ height: '100%' }}>
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <h2>Sicherungen</h2>
          <div className="muted small">Vor jedem Upgrade legt Patina automatisch eine an. Damit kommst du jederzeit zurück.</div>
        </div>
        <button className="btn sm" onClick={() => run('createBackup', inst.id, { includeWorlds: true }).then(load)}>
          <Plus size={15} /> Jetzt sichern
        </button>
      </div>
      {!list && <Spinner />}
      {list && !list.length && <div className="muted">Noch keine Sicherungen.</div>}
      <div className="list">
        {(list || []).map((b) => (
          <div key={b.id} className="item">
            <div className="ico">
              <History size={18} />
            </div>
            <div className="grow">
              <div className="t">
                {new Date(b.at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} <span className="muted">– {b.reason}</span>
              </div>
              <div className="s">
                Minecraft {b.game}, {b.loader}
                {b.includesWorlds ? ', mit Welten' : ''}, {fmtBytes(b.size)}
              </div>
            </div>
            <button className="btn sm" onClick={() => restore(b)}>
              Wiederherstellen
            </button>
            <button className="btn ghost sm icon" aria-label="Löschen" onClick={() => window.confirm('Sicherung löschen?') && call('deleteBackup', inst.id, b.id).then(load)}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ======================= Protokoll =======================

function LogTab({ inst }) {
  const { gameLogs } = useStore();
  const [initial, setInitial] = useState([]);
  const box = useRef(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    call('gameLog', inst.id).then(setInitial).catch(() => {});
  }, [inst.id]);
  const lines = gameLogs[inst.id] && gameLogs[inst.id].length ? gameLogs[inst.id] : initial;
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);
  const text = lines.slice(-1500);
  return (
    <div className="pane" style={{ height: '100%' }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="grow muted small">{inst.running ? 'Live-Ausgabe des laufenden Spiels' : lines.length ? 'Ausgabe der letzten Sitzung' : 'Noch keine Ausgabe – starte das Spiel.'}</div>
        <label className="row small muted" style={{ gap: 8 }}>
          <Toggle on={follow} onChange={setFollow} label="Mitscrollen" /> Mitscrollen
        </label>
        <button className="btn sm" onClick={() => navigator.clipboard.writeText(lines.join('\n'))}>
          <Copy size={14} /> Kopieren
        </button>
        <button className="btn sm" onClick={() => call('openFolder', inst.id, 'logs')}>
          <FolderOpen size={14} /> Logs
        </button>
      </div>
      <div className="log" ref={box}>
        {text.map((l, i) => (
          <div key={i} className={/ERROR|FATAL|Exception|\bat [a-z]/.test(l) ? 'e' : /WARN/.test(l) ? 'w' : undefined}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

// ======================= Seitenleiste (nur auf breiten Bildschirmen) =======================

function InstanceSide({ inst, tab, onTab }) {
  const { state } = useStore();
  const [size, setSize] = useState(null);
  const quick = useQuickItems(inst, 4);
  useEffect(() => {
    let alive = true;
    setSize(null);
    call('instanceSize', inst.id)
      .then((b) => alive && setSize(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [inst.id, inst.mods]);
  const cover = inst.cover ? `bwfile://inst/${inst.id}/${inst.cover.split('/').map(encodeURIComponent).join('/')}?w=800` : null;
  const memMb = inst.memory && inst.memory.max ? inst.memory.max : state.settings.memoryMax;
  const source = inst.importedFrom
    ? /norisk/i.test(inst.importedFrom)
      ? 'NoRisk Client'
      : /modrinth|theseus/i.test(inst.importedFrom)
      ? 'Modrinth App'
      : /curseforge|curse/i.test(inst.importedFrom)
      ? 'CurseForge'
      : 'Ordner'
    : null;
  const stats = [
    { k: 'Spielzeit', v: inst.playTime ? fmtPlay(inst.playTime) : '–' },
    { k: 'Zuletzt gespielt', v: inst.lastPlayed ? fmtAgo(inst.lastPlayed) : 'noch nie' },
    inst.loader !== 'vanilla' ? { k: 'Mods', v: fmtNum(inst.mods) } : { k: 'Modloader', v: 'Vanilla' },
    { k: 'Größe', v: size == null ? '…' : fmtBytes(size) },
  ];
  return (
    <aside className="inst-side" aria-label="Überblick">
      <article className="side-card">
        {cover && <img className="news-img" src={cover} alt="" draggable={false} />}
        <div className="pad col" style={{ gap: 14 }}>
          <div className="stat-grid">
            {stats.map((x) => (
              <div key={x.k} className="stat">
                <div className="stat-v">{x.v}</div>
                <div className="stat-k">{x.k}</div>
              </div>
            ))}
          </div>
          <div className="kv">
            <span>Arbeitsspeicher</span>
            <button className="link-btn" onClick={() => onTab('settings')}>
              {(memMb / 1024).toLocaleString('de-DE')} GB
            </button>
          </div>
          <div className="kv">
            <span>Angelegt</span>
            <span>{new Date(inst.created).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
          {source && (
            <div className="kv">
              <span>Übernommen aus</span>
              <span>{source}</span>
            </div>
          )}
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => call('openFolder', inst.id)}>
            <FolderOpen size={15} /> Ordner öffnen
          </button>
        </div>
      </article>
      {tab !== 'worlds' && quick && quick.length > 0 && (
        <article className="side-card pad col" style={{ gap: 10 }}>
          <h3>Direkt weiter</h3>
          {quick.map((it) => (
            <QuickCard key={it.key} inst={inst} it={it} />
          ))}
        </article>
      )}
      <PopularCard inst={inst} />
    </aside>
  );
}
