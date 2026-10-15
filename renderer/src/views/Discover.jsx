import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useStore, call } from '../store.jsx';
import { Seg, Img, Spinner, fmtNum } from '../ui.jsx';
import ProjectModal from '../modals/Project.jsx';

const TYPES = [
  { value: 'mod', label: 'Mods' },
  { value: 'shader', label: 'Shader' },
  { value: 'resourcepack', label: 'Ressourcenpakete' },
  { value: 'modpack', label: 'Modpacks' },
];
const SORTS = [
  { value: 'relevance', label: 'Relevanz' },
  { value: 'downloads', label: 'Downloads' },
  { value: 'follows', label: 'Beliebt' },
  { value: 'newest', label: 'Neu' },
  { value: 'updated', label: 'Aktualisiert' },
];

export default function Discover() {
  const { state } = useStore();
  const [type, setType] = useState('mod');
  const [q, setQ] = useState('');
  const [version, setVersion] = useState('');
  const [loader, setLoader] = useState('');
  const [sort, setSort] = useState('relevance');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState([]);
  const [detail, setDetail] = useState(null);
  const reqId = useRef(0);

  useEffect(() => {
    call('versionList', {}).then((l) => setVersions(l.map((v) => v.id))).catch(() => {});
  }, []);

  const doSearch = async (offset = 0) => {
    const my = ++reqId.current;
    setLoading(true);
    try {
      const r = await call('search', {
        query: q,
        type,
        gameVersion: version || null,
        loaders: loader && (type === 'mod' || type === 'modpack') ? [loader] : [],
        index: !q && sort === 'relevance' ? 'downloads' : sort,
        offset,
        limit: 30,
      });
      if (my !== reqId.current) return;
      setRes((prev) => (offset && prev ? { ...r, hits: [...prev.hits, ...r.hits] } : r));
    } catch (e) {
      if (my === reqId.current) setRes({ hits: [], total: 0, error: e.message });
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => doSearch(0), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, type, version, loader, sort]); // eslint-disable-line

  return (
    <div className="scroll">
      <div className="page wide">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h1>Entdecken</h1>
          <Seg value={type} onChange={setType} options={TYPES} />
        </div>
        <div className="row wrap" style={{ marginBottom: 18 }}>
          <div className="search grow" style={{ minWidth: 260 }}>
            <Search size={15} />
            <input className="input" placeholder={`${TYPES.find((t) => t.value === type).label} durchsuchen`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <select className="select" style={{ width: 150 }} value={version} onChange={(e) => setVersion(e.target.value)} aria-label="Minecraft-Version">
            <option value="">Alle Versionen</option>
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {(type === 'mod' || type === 'modpack') && (
            <select className="select" style={{ width: 140 }} value={loader} onChange={(e) => setLoader(e.target.value)} aria-label="Modloader">
              <option value="">Alle Loader</option>
              <option value="fabric">Fabric</option>
              <option value="quilt">Quilt</option>
              <option value="forge">Forge</option>
              <option value="neoforge">NeoForge</option>
            </select>
          )}
          <select className="select" style={{ width: 150 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sortierung">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {res && res.error && <div className="hint-box">{res.error}</div>}
        {!res && (
          <div className="row muted">
            <Spinner /> Lade …
          </div>
        )}
        {res && (
          <>
            <div className="small muted" style={{ marginBottom: 10 }}>
              {res.total.toLocaleString('de-DE')} Treffer auf Modrinth
            </div>
            <div className="results" style={{ opacity: loading ? 0.65 : 1 }}>
              {res.hits.map((h) => (
                <button key={h.id} className="result" onClick={() => setDetail(h)}>
                  <Img src={h.icon} />
                  <div style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 650 }}>
                      {h.title}
                    </div>
                    <div className="faint small ellipsis">
                      {h.author}, {fmtNum(h.downloads)} Downloads
                    </div>
                    <div className="desc">{h.description}</div>
                  </div>
                </button>
              ))}
            </div>
            {res.hits.length < res.total && (
              <div style={{ textAlign: 'center', marginTop: 18 }}>
                <button className="btn" onClick={() => doSearch(res.hits.length)} disabled={loading}>
                  {loading && <Spinner />} Mehr laden
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {detail && <ProjectModal hit={detail} kind={type} onClose={() => setDetail(null)} />}
    </div>
  );
}
