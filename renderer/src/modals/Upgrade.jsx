import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowUpCircle, CheckCircle2, AlertTriangle, HelpCircle, ParkingSquare, Copy, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { useStore, useLaunch, call } from '../store.jsx';
import { Modal, Toggle, Img, Progress, Spinner, Ver, cls, fmtBytes, plural } from '../ui.jsx';

const STATUS = {
  update: { label: 'Wird aktualisiert', chip: 'ok', icon: <CheckCircle2 size={14} /> },
  compatible: { label: 'Passt schon', chip: 'ok', icon: <CheckCircle2 size={14} /> },
  keep: { label: 'Bleibt', chip: '', icon: <CheckCircle2 size={14} /> },
  missing: { label: 'Noch nicht verfügbar', chip: 'warn', icon: <AlertTriangle size={14} /> },
  unknown: { label: 'Unbekannte Datei', chip: '', icon: <HelpCircle size={14} /> },
  cfkey: { label: 'Nur auf CurseForge', chip: 'am', icon: <HelpCircle size={14} /> },
  cfmanual: { label: 'Nur manuell', chip: 'warn', icon: <AlertTriangle size={14} /> },
};

export default function UpgradeModal({ inst, onClose }) {
  const { state, tasks, toast } = useStore();
  const launch = useLaunch();
  const [targets, setTargets] = useState(null);
  const [target, setTarget] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planErr, setPlanErr] = useState(null);
  const [mode, setMode] = useState('inplace');
  const [worlds, setWorlds] = useState(state.settings.backupWorldsOnUpgrade !== false);
  const [park, setPark] = useState(true);
  const [phase, setPhase] = useState('plan'); // plan | running | done | failed
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    call('upgradeTargets', inst.id)
      .then((t) => {
        setTargets(t);
        setTarget(t[0] || null);
      })
      .catch((e) => setPlanErr(e.message));
  }, [inst.id]);

  useEffect(() => {
    if (!target) return;
    setPlan(null);
    setPlanErr(null);
    let alive = true;
    call('upgradePlan', inst.id, target)
      .then((p) => alive && setPlan(p))
      .catch((e) => alive && setPlanErr(e.message));
    return () => {
      alive = false;
    };
  }, [target, inst.id]);

  const planTask = tasks.find((t) => t.instanceId === inst.id && t.title.startsWith('Prüfe Kompatibilität') && t.state === 'running');
  const runTask = tasks.find((t) => t.instanceId === inst.id && t.title.startsWith('Upgrade') && t.state === 'running');

  const start = async () => {
    setPhase('running');
    try {
      const r = await call('upgradeApply', inst.id, plan, { mode, backupWorlds: worlds, disableMissing: park, disableUnknown: park });
      setReport(r);
      setPhase('done');
    } catch (e) {
      setError(e.message);
      setPhase('failed');
    }
  };

  const s = plan && plan.summary;
  const mods = plan ? plan.items.filter((i) => i.kind === 'mod' && i.enabled) : [];
  const others = plan ? plan.items.filter((i) => !(i.kind === 'mod' && i.enabled)) : [];
  const problem = mods.filter((m) => m.status === 'missing' || m.status === 'unknown');

  if (phase === 'running') {
    return (
      <Modal title={`Upgrade auf ${plan.to}`} dismissable={false}>
        <div className="col" style={{ gap: 14, padding: '10px 0 8px' }}>
          <VersionJump from={plan.from} to={plan.to} />
          <div className="small muted" style={{ minHeight: 20 }}>
            {runTask ? runTask.label : 'Starte …'}
          </div>
          <Progress value={runTask ? runTask.done : 0} total={runTask ? runTask.total : 0} />
          <div className="small faint">{mode === 'inplace' ? 'Eine Sicherung liegt bereit. Bei einem Fehler stellt Patina den alten Zustand automatisch wieder her.' : 'Die alte Instanz bleibt unverändert.'}</div>
        </div>
      </Modal>
    );
  }

  if (phase === 'done') {
    return (
      <Modal
        title="Upgrade fertig"
        onClose={onClose}
        footer={
          <>
            <button className="btn ghost" onClick={onClose}>
              Schließen
            </button>
            <button
              className="play sm"
              onClick={() => {
                onClose();
                launch(report.instanceId);
              }}
            >
              Jetzt spielen
            </button>
          </>
        }
      >
        <div className="col" style={{ gap: 14 }}>
          <VersionJump from={plan.from} to={plan.to} done />
          <div className="col" style={{ gap: 6 }}>
            <div className="row">
              <CheckCircle2 size={17} color="var(--verdigris)" /> {plural(report.updated.length, 'Inhalt', 'Inhalte')} aktualisiert, {plural(report.kept.length, 'weiterer', 'weitere')} unverändert übernommen.
            </div>
            {report.deps.length > 0 && (
              <div className="row">
                <CheckCircle2 size={17} color="var(--verdigris)" /> Neu nötig und mitinstalliert: {report.deps.join(', ')}
              </div>
            )}
            <div className="row">
              <CheckCircle2 size={17} color="var(--verdigris)" /> Einstellungen, Keybinds, Configs und Welten sind übernommen.
            </div>
            {report.parked.length > 0 && (
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <ParkingSquare size={17} color="var(--gold)" style={{ flex: 'none', marginTop: 2 }} />
                <span>
                  Geparkt: {report.parked.map((p) => p.title).join(', ')}. Sobald es eine passende Version gibt, meldet sich Patina.
                </span>
              </div>
            )}
            {report.warnings.map((w, i) => (
              <div key={i} className="row small muted">
                <AlertTriangle size={15} /> {w}
              </div>
            ))}
            {report.backupId && <div className="small faint">Zurück geht’s jederzeit unter „Sicherungen“.</div>}
          </div>
        </div>
      </Modal>
    );
  }

  if (phase === 'failed') {
    return (
      <Modal title="Upgrade nicht möglich" onClose={onClose} footer={<button className="btn" onClick={onClose}>Schließen</button>}>
        <div className="col" style={{ gap: 12 }}>
          <div className="hint-box">{error}</div>
          <div className="row small muted">
            <RotateCcw size={15} /> {mode === 'inplace' ? 'Deine Instanz wurde auf den Stand vor dem Upgrade zurückgesetzt.' : 'Die Kopie wurde wieder entfernt, das Original ist unverändert.'}
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Auf neue Version upgraden"
      sub="Mods, Shader und Pakete werden auf die neue Version gehoben. Einstellungen und Welten bleiben."
      onClose={onClose}
      wide
      footer={
        <>
          <div className="grow small muted">{plan && s.missing + s.unknown > 0 && park ? `${plural(s.missing + s.unknown, 'Mod wird', 'Mods werden')} geparkt${s.missing ? ' und später automatisch nachgezogen' : ''}.` : ''}</div>
          <button className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button className="copper lg" disabled={!plan || !plan.loaderAvailable} onClick={start}>
            <ArrowUpCircle size={18} /> Upgrade starten
          </button>
        </>
      }
    >
      {targets && !targets.length && (
        <div className="empty">
          <h2>Schon auf dem neuesten Stand</h2>
          <p>{inst.name} läuft bereits mit der neuesten Minecraft-Version.</p>
        </div>
      )}
      {targets && targets.length > 0 && (
        <div className="col" style={{ gap: 18 }}>
          <div className="row" style={{ gap: 16 }}>
            <VersionJump from={inst.game} to={target} />
            <div className="grow" />
            <label className="field" style={{ width: 200 }}>
              <span className="small muted" style={{ fontWeight: 600 }}>
                Zielversion
              </span>
              <select className="select" value={target || ''} onChange={(e) => setTarget(e.target.value)}>
                {targets.map((t, i) => (
                  <option key={t} value={t}>
                    {t}
                    {i === 0 ? ' (neueste)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {planErr && <div className="hint-box">{planErr}</div>}
          {!plan && !planErr && (
            <div className="col" style={{ gap: 8, padding: '8px 0' }}>
              <div className="row muted small">
                <Spinner size={14} /> {planTask ? planTask.label : 'Prüfe, welche Mods es für die neue Version gibt …'}
              </div>
              <Progress value={planTask ? planTask.done : 0} total={planTask ? planTask.total : 0} />
            </div>
          )}

          {plan && (
            <>
              <div className="panel pad" style={{ display: 'grid', gap: 12 }}>
                {inst.loader !== 'vanilla' && (
                  <div className="row small">
                    {plan.loaderAvailable ? <CheckCircle2 size={16} color="var(--verdigris)" /> : <AlertTriangle size={16} color="var(--redstone)" />}
                    {plan.loaderAvailable ? (
                      <span>
                        {plan.loaderName} {plan.loaderVersion} läuft auf {plan.to}.
                      </span>
                    ) : (
                      <span style={{ color: '#ff9a9d' }}>
                        {plan.loaderName} gibt es noch nicht für {plan.to}. Wähl eine ältere Zielversion oder warte ein paar Tage.
                      </span>
                    )}
                  </div>
                )}
                {s.total > 0 ? (
                  <>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div style={{ fontWeight: 650, fontSize: 16 }}>
                        {s.ready} von {plural(s.total, 'Mod', 'Mods')} bereit für {plan.to}
                      </div>
                      <div className="row small muted" style={{ gap: 14 }}>
                        <Legend color="var(--verdigris)" label={`${s.ready} bereit`} />
                        {s.missing > 0 && <Legend color="var(--gold)" label={`${s.missing} fehlen noch`} />}
                        {s.cfKeyNeeded > 0 && <Legend color="var(--amethyst)" label={`${s.cfKeyNeeded} nur CurseForge`} />}
                        {s.unknown - (s.cfKeyNeeded || 0) > 0 && <Legend color="var(--faint)" label={`${s.unknown - (s.cfKeyNeeded || 0)} unbekannt`} />}
                      </div>
                    </div>
                    <div className="meter" aria-hidden="true">
                      <div style={{ width: `${(s.ready / s.total) * 100}%`, background: 'var(--verdigris)' }} />
                      <div style={{ width: `${(s.missing / s.total) * 100}%`, background: 'var(--gold)' }} />
                      <div style={{ width: `${((s.cfKeyNeeded || 0) / s.total) * 100}%`, background: 'var(--amethyst)' }} />
                      <div style={{ width: `${((s.unknown - (s.cfKeyNeeded || 0)) / s.total) * 100}%`, background: 'var(--faint)' }} />
                    </div>
                  </>
                ) : (
                  <div className="small muted">{inst.loader === 'vanilla' ? 'Vanilla-Instanz: Es werden nur Version und ggf. Ressourcenpakete gehoben.' : 'Keine Mods installiert.'}</div>
                )}
              </div>

              {s.cfKeyNeeded > 0 && (
                <div className="hint-box small">
                  <b>{plural(s.cfKeyNeeded, 'Mod gibt', 'Mods gibt')} es nur auf CurseForge.</b>{' '}
                  <span className="muted">Mit einem kostenlosen CurseForge-API-Schlüssel (Einstellungen → Erweitert) aktualisiert Patina auch diese automatisch. Ohne werden sie geparkt.</span>
                </div>
              )}
              {problem.length > 0 && (
                <div>
                  <h3 style={{ marginBottom: 6 }}>Brauchen Aufmerksamkeit</h3>
                  {problem.map((it) => (
                    <StatusRow key={it.key} it={it} />
                  ))}
                </div>
              )}

              <div>
                <button className="btn ghost sm" style={{ paddingLeft: 2 }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Alle Inhalte anzeigen ({plan.items.length})
                </button>
                {showAll && (
                  <div style={{ marginTop: 6 }}>
                    {[...mods.filter((m) => !problem.includes(m)), ...others].map((it) => (
                      <StatusRow key={it.key} it={it} />
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button className={cls('option-card', mode === 'inplace' && 'on')} onClick={() => setMode('inplace')}>
                  <span className="radio" />
                  <span>
                    <b>Diese Instanz upgraden</b>
                    <div className="small muted">Alles bleibt an seinem Platz. Vorher wird automatisch gesichert – ein Klick bringt dich zurück.</div>
                  </span>
                </button>
                <button className={cls('option-card', mode === 'copy' && 'on')} onClick={() => setMode('copy')}>
                  <span className="radio" />
                  <span>
                    <b>
                      <Copy size={13} /> Als Kopie upgraden
                    </b>
                    <div className="small muted">„{inst.name} {plan.to}“ entsteht neu, die alte Instanz bleibt auf {plan.from}.</div>
                  </span>
                </button>
              </div>
              <div className="col" style={{ gap: 10 }}>
                {mode === 'inplace' && (
                  <label className="row small">
                    <Toggle on={worlds} onChange={setWorlds} label="Welten mitsichern" />
                    <span>
                      Welten mitsichern <span className="muted">({fmtBytes(plan.worldsSize)})</span> – empfohlen, Minecraft wandelt Welten beim Öffnen um.
                    </span>
                  </label>
                )}
                {(s.missing > 0 || s.unknown > 0) && (
                  <label className="row small">
                    <Toggle on={park} onChange={setPark} label="Fehlende Mods parken" />
                    <span>Fehlende und unbekannte Mods deaktivieren und später automatisch nachziehen</span>
                  </label>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function VersionJump({ from, to, done }) {
  return (
    <div className="row" style={{ gap: 12 }}>
      <Ver v={from} />
      <ArrowRight size={18} color="var(--muted)" />
      <span className="ver" style={{ fontSize: 18, padding: '3px 10px', background: done ? 'var(--ok-soft)' : 'var(--copper-soft)', borderColor: done ? 'var(--verdigris-lo)' : 'var(--copper-lo)', color: done ? 'var(--verdigris-hi)' : 'var(--copper-hi)' }}>
        {to || '…'}
      </span>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} /> {label}
    </span>
  );
}

function StatusRow({ it }) {
  const st = it.note === 'cf-key' ? STATUS.cfkey : it.note === 'cf-no-download' ? STATUS.cfmanual : STATUS[it.status] || STATUS.keep;
  return (
    <div className="status-row">
      <Img src={it.icon} fallback={<div className="ph" />} />
      <div style={{ minWidth: 0 }}>
        <div className="ellipsis" style={{ fontWeight: 600 }}>
          {it.title}
        </div>
        <div className="arrow-ver ellipsis">
          {it.status === 'update'
            ? `${it.from || '?'} → ${it.to}`
            : it.note === 'cf-key'
            ? 'Mit CurseForge-API-Schlüssel automatisch aktualisierbar'
            : it.note === 'cf-no-download'
            ? 'Autor erlaubt keine Downloads über andere Launcher'
            : it.status === 'unknown'
            ? 'Nicht auf Modrinth gefunden'
            : it.from || ''}
        </div>
      </div>
      <span className="chip faint">{{ mod: 'Mod', shader: 'Shader', resourcepack: 'Paket' }[it.kind]}</span>
      <span className={cls('chip', st.chip)}>
        {st.icon} {st.label}
      </span>
    </div>
  );
}
