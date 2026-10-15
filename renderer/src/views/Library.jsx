import React, { useEffect, useMemo, useState } from 'react';
import { Plus, FolderInput, Search, Square, X, Server, Globe2, Check, Play } from 'lucide-react';
import { useStore, useLaunch, call } from '../store.jsx';
import { BlockIcon, Ver, LoaderChip, Progress, Img, Spinner, IsoPattern, bandFor, fmtAgo, fmtPlay, fmtNum, plural, cls } from '../ui.jsx';
import CreateInstance from '../modals/CreateInstance.jsx';
import ImportModal from '../modals/Import.jsx';
import PatchNotesModal from '../modals/PatchNotes.jsx';
import ProjectModal from '../modals/Project.jsx';

const coverUrl = (inst, w) => (inst.cover ? `bwfile://inst/${inst.id}/${inst.cover.split('/').map(encodeURIComponent).join('/')}?w=${w}` : null);

export default function Library() {
  const { state, tasks } = useStore();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ cf: 0, mr: 0, nr: 0 });
  const instances = state.instances;
  const hideHint = state.settings.hideCfHint;

  useEffect(() => {
    if (hideHint) return;
    let alive = true;
    Promise.all([call('scanCurseForge').catch(() => []), call('scanModrinth').catch(() => []), call('scanNoRisk').catch(() => [])]).then(([cf, mr, nr]) => {
      const open = (l) => l.filter((x) => !x.alreadyImported && x.game).length;
      if (alive) setFound({ cf: open(cf), mr: open(mr), nr: open(nr) });
    });
    return () => {
      alive = false;
    };
  }, [instances.length, hideHint]);

  const hero = instances[0];
  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase();
    return instances.filter((i) => !f || i.name.toLowerCase().includes(f) || i.game.includes(f) || i.loader.includes(f));
  }, [instances, q]);
  const showHint = !hideHint && found.cf + found.mr + found.nr > 0;

  return (
    <div className="scroll">
      <div className="home">
        <section className="home-main">
          {hero ? (
            <>
              <Hero inst={hero} task={tasks.find((t) => t.instanceId === hero.id && t.state === 'running')} />
              <QuickRow inst={hero} />
            </>
          ) : (
            <EmptyHero onCreate={() => setCreating(true)} onImport={() => setImporting(true)} found={found} />
          )}

          {instances.length > 0 && (
            <section className="col" style={{ gap: 14 }}>
              <div className="row wrap" style={{ gap: 12 }}>
                <h2 className="grow">
                  Alle Instanzen <span className="faint" style={{ fontWeight: 500 }}>{instances.length}</span>
                </h2>
                <div className="search" style={{ width: 240 }}>
                  <Search size={15} />
                  <input className="input" placeholder="Suchen" aria-label="Instanzen suchen" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <button className="btn" onClick={() => setImporting(true)}>
                  <FolderInput size={16} /> Importieren
                </button>
                <button className="btn primary" onClick={() => setCreating(true)}>
                  <Plus size={16} /> Neue Instanz
                </button>
              </div>
              {showHint && <ImportHint found={found} onOpen={() => setImporting(true)} />}
              <div className="grid">
                {filtered.map((i) => (
                  <Tile key={i.id} inst={i} task={tasks.find((t) => t.instanceId === i.id && t.state === 'running')} />
                ))}
                {!q && (
                  <button className="tile new" onClick={() => setCreating(true)}>
                    <Plus size={22} />
                    Neue Instanz
                  </button>
                )}
              </div>
              {q && !filtered.length && <div className="muted">Keine Instanz passt zu „{q}“.</div>}
            </section>
          )}
        </section>

        <aside className="home-side">
          <NewsCard />
          {hero && <PopularCard inst={hero} />}
        </aside>
      </div>
      {creating && <CreateInstance onClose={() => setCreating(false)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  );
}

// ---------------- Spielen ----------------

export function PlayButton({ inst, task, size }) {
  const launch = useLaunch();
  const starting = task && /^Starte /.test(task.title);
  if (inst.running) {
    return (
      <button className={cls('play stop', size)} onClick={(e) => (e.stopPropagation(), call('stop', inst.id))}>
        <Square size={size === 'sm' ? 14 : 16} fill="currentColor" /> Beenden
      </button>
    );
  }
  return (
    <button className={cls('play', size, starting && 'busy')} disabled={starting} onClick={(e) => (e.stopPropagation(), launch(inst.id))}>
      {starting ? 'Startet …' : 'Spielen'}
    </button>
  );
}

// ---------------- Hero ----------------

function Hero({ inst, task }) {
  const { setRoute } = useStore();
  const cover = coverUrl(inst, 1600);
  return (
    <article className="hero">
      {cover ? <img className="hero-cover" src={cover} alt="" draggable={false} /> : <IsoPattern id="iso-hero" opacity={0.16} />}
      <div className="hero-shade" />
      <div className="hero-content">
        <div className="hero-text">
          <div className="hero-kicker">{inst.running ? 'Läuft gerade' : inst.lastPlayed ? `Zuletzt gespielt ${fmtAgo(inst.lastPlayed)}` : 'Neu angelegt'}</div>
          <h1 className="hero-name" title={inst.name}>
            {inst.name}
          </h1>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="glass-chip strong">{inst.game}</span>
            <span className={cls('glass-chip', `loader-${inst.loader}`)}>
              {inst.loaderName}
              {inst.loaderVersion ? ` ${inst.loaderVersion}` : ''}
            </span>
            {inst.loader !== 'vanilla' && <span className="glass-chip">{plural(inst.mods, 'Mod', 'Mods')}</span>}
            <span className="glass-chip">{inst.playTime ? `${fmtPlay(inst.playTime)} gespielt` : 'noch nicht gespielt'}</span>
          </div>
          {task && (
            <div style={{ maxWidth: 460, marginTop: 4 }}>
              <div className="small ellipsis" style={{ marginBottom: 6, color: '#c9cdd3' }}>
                {task.label}
              </div>
              <Progress value={task.done} total={task.total} />
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 12 }}>
          <button className="btn glass" onClick={() => setRoute({ view: 'instance', id: inst.id })}>
            Verwalten
          </button>
          <PlayButton inst={inst} task={task} size="lg" />
        </div>
      </div>
    </article>
  );
}

function EmptyHero({ onCreate, onImport, found }) {
  const n = found.cf + found.mr + found.nr;
  return (
    <article className="hero" style={{ minHeight: 300 }}>
      <IsoPattern id="iso-empty" opacity={0.14} />
      <div className="hero-shade" />
      <div className="hero-content">
        <div className="hero-text">
          <div className="hero-kicker">Willkommen</div>
          <h1 className="hero-name">Leg deine erste Instanz an</h1>
          <p style={{ margin: 0, color: '#c9cdd3', maxWidth: '58ch' }}>Eine Instanz ist ein eigener Minecraft-Ordner mit Version, Modloader, Mods, Einstellungen und Welten.</p>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <button className="btn glass" onClick={onImport}>
            <FolderInput size={16} /> {n ? `${plural(n, 'Instanz', 'Instanzen')} übernehmen` : 'Importieren'}
          </button>
          <button className="btn primary lg" onClick={onCreate}>
            <Plus size={17} /> Neue Instanz
          </button>
        </div>
      </div>
    </article>
  );
}

// ---------------- Direkt weiter (Welten & Server) ----------------

/** Welten (zuletzt gespielt zuerst) und Server einer Instanz für den Direktstart. */
export function useQuickItems(inst, max = 4) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    call('instanceDetails', inst.id)
      .then((r) => alive && setD(r))
      .catch(() => alive && setD(null));
    return () => {
      alive = false;
    };
  }, [inst.id, inst.lastPlayed]);
  if (!d) return null;
  return [
    ...d.worlds.slice(0, 2).map((w) => ({ key: `w:${w.folder}`, kind: 'world', title: w.folder, sub: `Welt, zuletzt ${fmtAgo(w.lastPlayed)}`, icon: w.hasIcon ? `bwfile://inst/${inst.id}/saves/${encodeURIComponent(w.folder)}/icon.png` : null, qp: { type: 'singleplayer', target: w.folder } })),
    ...d.servers.slice(0, max).map((s, i) => {
      // „Minecraft Server“ ist nur der Standardname – dann ist die Adresse aussagekräftiger
      const named = s.name && s.name.trim() && s.name.trim() !== 'Minecraft Server';
      return { key: `s:${s.ip}:${i}`, kind: 'server', title: named ? s.name : s.ip, sub: named ? s.ip : 'Server', qp: { type: 'multiplayer', target: s.ip } };
    }),
  ].slice(0, max);
}

export function QuickCard({ inst, it }) {
  const launch = useLaunch();
  return (
    <button className="quick-card" onClick={() => launch(inst.id, { quickPlay: it.qp })} title={it.kind === 'world' ? `${inst.name} starten und „${it.title}“ laden` : `${inst.name} starten und ${it.title} beitreten`}>
      <span className={cls('quick-ico', it.kind)}>{it.icon ? <img src={it.icon} alt="" /> : it.kind === 'world' ? <Globe2 size={20} /> : <Server size={20} />}</span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="t ellipsis">{it.title}</span>
        <span className="s ellipsis">{it.sub}</span>
      </span>
      <span className="quick-go">
        <Play size={14} fill="currentColor" /> {it.kind === 'world' ? 'Laden' : 'Beitreten'}
      </span>
    </button>
  );
}

function QuickRow({ inst }) {
  const items = useQuickItems(inst);
  if (!items || !items.length) return null;
  return (
    <section className="col quick-wrap" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Direkt weiter</h2>
        <span className="faint small">Startet {inst.name} und lädt sofort Welt oder Server</span>
      </div>
      <div className="quick">
        {items.map((it) => (
          <QuickCard key={it.key} inst={inst} it={it} />
        ))}
      </div>
    </section>
  );
}

// ---------------- Import-Hinweis (ausblendbar) ----------------

function ImportHint({ found, onOpen }) {
  const { run } = useStore();
  const parts = [];
  if (found.cf) parts.push(`${found.cf} CurseForge`);
  if (found.mr) parts.push(`${found.mr} Modrinth`);
  if (found.nr) parts.push(`${found.nr} NoRisk`);
  const total = found.cf + found.mr + found.nr;
  return (
    <div className="hint-row" role="status">
      <span className="dot live" style={{ width: 7, height: 7 }} />
      <span className="grow">
        {parts.length > 1 ? `${parts.slice(0, -1).join('-, ')}- und ${parts[parts.length - 1]}` : parts[0]}-{total === 1 ? 'Instanz' : 'Instanzen'} gefunden. Mit Mods, Einstellungen und Welten übernehmen?
      </span>
      <button className="btn sm" onClick={onOpen}>
        Auswählen
      </button>
      <button className="btn ghost sm icon" title="Ausblenden" aria-label="Hinweis ausblenden" onClick={() => run('setSettings', { hideCfHint: true })}>
        <X size={16} />
      </button>
    </div>
  );
}

// ---------------- Kachel ----------------

function Tile({ inst, task }) {
  const { setRoute } = useStore();
  const open = () => setRoute({ view: 'instance', id: inst.id });
  const cover = coverUrl(inst, 640);
  return (
    <div className="tile" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}>
      <div className="tile-band" style={cover ? null : { background: bandFor(inst.icon) }}>
        {cover && <img src={cover} alt="" draggable={false} loading="lazy" />}
        <div className="tile-icon">
          <BlockIcon kind={inst.icon} size={50} />
        </div>
      </div>
      <div className="tile-body">
        <div className="title ellipsis" title={inst.name}>
          {inst.name}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Ver v={inst.game} />
          <LoaderChip loader={inst.loader} name={inst.loaderName} version={inst.loaderVersion} />
        </div>
        <div className="small muted tile-meta">
          {inst.running ? (
            <span className="row" style={{ gap: 7, color: 'var(--verdigris-hi)' }}>
              <span className="dot live" /> Läuft
            </span>
          ) : task ? (
            <span className="ellipsis" style={{ display: 'block' }}>
              {task.label}
            </span>
          ) : (
            <span className="ellipsis" style={{ display: 'block' }}>
              {inst.loader !== 'vanilla' && inst.mods ? `${plural(inst.mods, 'Mod', 'Mods')}, ` : ''}
              {inst.lastPlayed ? fmtAgo(inst.lastPlayed) : 'noch nicht gespielt'}
            </span>
          )}
        </div>
        {task && <Progress value={task.done} total={task.total} />}
      </div>
      <div className={cls('tile-play', inst.running && 'always')}>
        <PlayButton inst={inst} task={task} size="sm" />
      </div>
    </div>
  );
}

// ---------------- Seitenleiste ----------------

function NewsCard() {
  const [news, setNews] = useState(undefined);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    call('news').then(setNews).catch(() => setNews(null));
  }, []);
  if (news === undefined)
    return (
      <article className="side-card pad">
        <div className="row muted small">
          <Spinner size={14} /> Lade Neuigkeiten …
        </div>
      </article>
    );
  if (!news || !news.release) return null;
  const r = news.release;
  const text = r.text && r.text.length > 230 ? `${r.text.slice(0, 230).replace(/\s+\S*$/, '')} …` : r.text;
  return (
    <article className="side-card news">
      {r.image && <img className="news-img" src={r.image} alt="" loading="lazy" />}
      <div className="pad col" style={{ gap: 8 }}>
        <div className="faint small" style={{ fontWeight: 600 }}>
          Neu in Minecraft, {new Date(r.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}
        </div>
        <h3 style={{ fontSize: 19 }}>{r.title.replace('Minecraft: ', '')}</h3>
        {text && <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>{text}</p>}
        <div className="row" style={{ gap: 14, marginTop: 2 }}>
          <button className="link-btn" onClick={() => setOpen(r)}>
            Patchnotes lesen
          </button>
          {news.snapshot && (
            <button className="link-btn faint" onClick={() => setOpen(news.snapshot)}>
              Neuester Snapshot
            </button>
          )}
        </div>
      </div>
      {open && <PatchNotesModal entry={open} onClose={() => setOpen(null)} />}
    </article>
  );
}

export function PopularCard({ inst }) {
  const { run, toast, setRoute, contentRev } = useStore();
  const [list, setList] = useState(null);
  const [installed, setInstalled] = useState(new Set());
  const [busy, setBusy] = useState({});
  const [detail, setDetail] = useState(null);
  const kind = inst.loader === 'vanilla' ? 'resourcepack' : 'mod';
  useEffect(() => {
    let alive = true;
    setList(null);
    call('search', { type: kind, gameVersion: inst.game, loaders: kind === 'mod' ? (inst.loader === 'quilt' ? ['quilt', 'fabric'] : [inst.loader]) : [], index: 'downloads', limit: 12 })
      .then((r) => alive && setList(r.hits))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [inst.id, inst.game, inst.loader, kind]);
  useEffect(() => {
    call('listContent', inst.id, kind)
      .then((r) => setInstalled(new Set(r.items.map((i) => i.projectId).filter(Boolean))))
      .catch(() => {});
  }, [inst.id, kind, contentRev]);
  if (list && !list.length) return null;
  // Bereits installierte nach hinten, damit Neues oben steht
  const shown = (list || []).slice().sort((a, b) => Number(installed.has(a.id)) - Number(installed.has(b.id))).slice(0, 6);
  const add = async (h) => {
    setBusy((b) => ({ ...b, [h.id]: true }));
    try {
      const r = await run('installContent', inst.id, h.id, { kind, title: h.title });
      const deps = (r.installed || []).filter((x) => x.dependency).map((x) => x.title);
      toast(`${h.title} zu „${inst.name}“ hinzugefügt${deps.length ? ` (+ ${deps.join(', ')})` : ''}.`, 'ok');
      setInstalled((s) => new Set([...s, h.id]));
    } catch {
    } finally {
      setBusy((b) => ({ ...b, [h.id]: false }));
    }
  };
  return (
    <article className="side-card pad col" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3>
          Beliebt für {inst.game}
          {kind === 'mod' ? ` + ${inst.loaderName}` : ''}
        </h3>
        <button className="link-btn small" onClick={() => setRoute({ view: 'discover' })}>
          Mehr
        </button>
      </div>
      {!list && (
        <div className="row muted small">
          <Spinner size={14} /> Lade …
        </div>
      )}
      {shown.map((h) => {
        const has = installed.has(h.id);
        return (
          <div key={h.id} className="pop-row">
            <button className="pop-main" onClick={() => setDetail(h)}>
              <Img src={h.icon} className="pop-ico" />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t ellipsis">{h.title}</span>
                <span className="s ellipsis">{fmtNum(h.downloads)} Downloads</span>
              </span>
            </button>
            {has ? (
              <span className="pop-done" title={`In ${inst.name} installiert`}>
                <Check size={16} />
              </span>
            ) : (
              <button className="btn sm icon" title={`Zu ${inst.name} hinzufügen`} aria-label={`${h.title} zu ${inst.name} hinzufügen`} disabled={busy[h.id]} onClick={() => add(h)}>
                {busy[h.id] ? <Spinner size={14} /> : <Plus size={16} />}
              </button>
            )}
          </div>
        );
      })}
      {detail && <ProjectModal hit={detail} kind={kind} inst={inst} installed={installed.has(detail.id)} onClose={() => setDetail(null)} onInstall={() => add(detail)} />}
    </article>
  );
}
