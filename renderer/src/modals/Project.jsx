import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, Check, Plus } from 'lucide-react';
import { useStore, call } from '../store.jsx';
import { Modal, Img, Spinner, BlockIcon, Ver, LoaderChip, fmtNum, cls } from '../ui.jsx';

/** Projektdetails. Mit `inst`: Installation in diese Instanz. Ohne: Instanz wählen (oder Modpack installieren). */
export default function ProjectModal({ hit, kind, inst, installed, onClose, onInstall }) {
  const { run, toast, setRoute } = useStore();
  const [p, setP] = useState(null);
  const [targets, setTargets] = useState(null);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState({});

  useEffect(() => {
    call('project', hit.id).then(setP).catch((e) => toast(e.message, 'error'));
    if (!inst && kind !== 'modpack') call('compatibleInstances', hit.id, kind).then(setTargets).catch(() => setTargets([]));
  }, [hit.id]); // eslint-disable-line

  const installTo = async (t) => {
    setBusy(t.id);
    try {
      const r = await run('installContent', t.id, hit.id, { kind, title: hit.title });
      setDone((d) => ({ ...d, [t.id]: true }));
      const deps = (r.installed || []).filter((x) => x.dependency).map((x) => x.title);
      toast(`${hit.title} in „${t.name}“ installiert${deps.length ? ` (+ ${deps.join(', ')})` : ''}.`, 'ok');
    } catch {
    } finally {
      setBusy(null);
    }
  };
  const installPack = async () => {
    setBusy('pack');
    try {
      const i = await run('installModpack', hit.id);
      toast(`Modpack „${i.name}“ installiert.`, 'ok');
      onClose();
      setRoute({ view: 'instance', id: i.id });
    } catch {
      setBusy(null);
    }
  };

  const body = p && p.body ? renderMarkdownLite(p.body) : null;
  return (
    <Modal
      wide
      onClose={onClose}
      icon={<Img src={hit.icon} className="ico" />}
      title={hit.title}
      sub={`von ${hit.author || 'unbekannt'} – ${fmtNum(hit.downloads)} Downloads`}
      footer={
        <>
          {p && (
            <button className="btn ghost" onClick={() => call('openExternal', p.links.page)}>
              <ExternalLink size={15} /> Auf Modrinth ansehen
            </button>
          )}
          <div className="grow" />
          {inst ? (
            installed ? (
              <span className="chip ok">
                <Check size={14} /> Bereits installiert
              </span>
            ) : (
              <button
                className="btn primary"
                onClick={() => {
                  onInstall();
                  onClose();
                }}
              >
                <Download size={16} /> In „{inst.name}“ installieren
              </button>
            )
          ) : kind === 'modpack' ? (
            <button className="btn primary" onClick={installPack} disabled={busy === 'pack'}>
              {busy === 'pack' ? <Spinner /> : <Download size={16} />} Als neue Instanz installieren
            </button>
          ) : null}
        </>
      }
    >
      <style>{'.modal-head .ico{width:48px;height:48px;border-radius:10px;object-fit:cover;background:var(--bg-3)}'}</style>
      {!p && (
        <div className="row muted">
          <Spinner /> Lade Details …
        </div>
      )}
      {p && (
        <div className="col" style={{ gap: 16 }}>
          <p className="prose" style={{ margin: 0, color: 'var(--text)' }}>
            {p.description}
          </p>
          <div className="row wrap" style={{ gap: 6 }}>
            {(p.loaders || []).filter((l) => !['minecraft', 'datapack'].includes(l)).map((l) => (
              <span key={l} className="chip">
                {l}
              </span>
            ))}
            {p.gameVersions && p.gameVersions.length > 0 && (
              <span className="chip">
                bis {p.gameVersions.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v)).slice(-1)[0]}
              </span>
            )}
            {(p.categories || []).slice(0, 4).map((c) => (
              <span key={c} className="chip faint">
                {c}
              </span>
            ))}
          </div>

          {!inst && kind !== 'modpack' && (
            <div className="panel pad">
              <h3 style={{ marginBottom: 8 }}>Installieren in …</h3>
              {!targets && <Spinner />}
              {targets && !targets.length && <div className="muted small">Du hast noch keine Instanz. Leg zuerst eine an.</div>}
              <div className="list">
                {(targets || []).map((t) => (
                  <div key={t.id} className={cls('item', !t.compatible && 'off')}>
                    <BlockIcon kind={t.icon} size={30} />
                    <div className="grow">
                      <div className="t">{t.name}</div>
                    </div>
                    <Ver v={t.game} />
                    <LoaderChip loader={t.loader} />
                    {done[t.id] || t.installed ? (
                      <span className="chip ok">
                        <Check size={13} /> Installiert
                      </span>
                    ) : (
                      <button className="btn sm" disabled={!t.compatible || busy === t.id} onClick={() => installTo(t)} title={t.compatible ? '' : 'Passt nicht zu Version/Loader dieser Instanz'}>
                        {busy === t.id ? <Spinner size={14} /> : <Plus size={14} />} {t.compatible ? 'Installieren' : 'Passt nicht'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {p.gallery.length > 0 && (
            <div className="gallery">
              {p.gallery.slice(0, 6).map((g) => (
                <img key={g.url} src={g.url} alt={g.title || ''} loading="lazy" />
              ))}
            </div>
          )}
          {body && <div className="prose" dangerouslySetInnerHTML={{ __html: body }} />}
        </div>
      )}
    </Modal>
  );
}

/** Sehr einfache, sichere Markdown-Darstellung (Text, Überschriften, Listen, Links). */
function renderMarkdownLite(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const lines = esc(md.replace(/<[^>]+>/g, '').slice(0, 6000)).split(/\r?\n/);
  let html = '';
  let inList = false;
  for (let l of lines) {
    l = l.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    if (/^\s*[-*] /.test(l)) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${l.replace(/^\s*[-*] /, '')}</li>`;
      continue;
    }
    if (inList) {
      html += '</ul>';
      inList = false;
    }
    if (/^#{1,6} /.test(l)) html += `<h3 style="color:var(--text);margin:14px 0 4px">${l.replace(/^#+ /, '')}</h3>`;
    else if (l.trim()) html += `<p style="margin:6px 0">${l}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}
