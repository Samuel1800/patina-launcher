import React from 'react';
import { AlertTriangle, FolderOpen, Copy } from 'lucide-react';
import { useStore, useLaunch, call } from '../store.jsx';
import { Modal } from '../ui.jsx';

export default function CrashModal({ data, onClose }) {
  const { state, setRoute } = useStore();
  const launch = useLaunch();
  const inst = state && state.instances.find((i) => i.id === data.instanceId);
  const a = data.analysis || { hints: [], tail: [] };
  return (
    <Modal
      wide
      icon={<AlertTriangle size={26} color="var(--redstone)" />}
      title={`${inst ? inst.name : 'Minecraft'} ist abgestürzt`}
      sub={data.error ? data.error : `Beendet mit Code ${data.code}${data.seconds ? ` nach ${data.seconds} Sekunden` : ''}.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={() => navigator.clipboard.writeText((a.tail || []).join('\n'))}>
            <Copy size={15} /> Log kopieren
          </button>
          <button className="btn ghost" onClick={() => call('openFolder', data.instanceId, a.report ? 'crash-reports' : 'logs')}>
            <FolderOpen size={15} /> {a.report ? 'Absturzbericht' : 'Logs'} öffnen
          </button>
          <div className="grow" />
          <button
            className="btn"
            onClick={() => {
              onClose();
              setRoute({ view: 'instance', id: data.instanceId, tab: 'mod' });
            }}
          >
            Mods prüfen
          </button>
          <button
            className="play sm"
            onClick={() => {
              onClose();
              launch(data.instanceId);
            }}
          >
            Nochmal starten
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        {a.hints.length > 0 ? (
          a.hints.map((h, i) => (
            <div key={i} className="hint-box">
              <b>{h.title}</b>
              <div className="muted small" style={{ marginTop: 4 }}>
                {h.hint}
              </div>
            </div>
          ))
        ) : (
          <div className="hint-box">
            <b>Keine bekannte Ursache erkannt.</b>
            <div className="muted small" style={{ marginTop: 4 }}>
              Häufig ist ein einzelner Mod schuld. Deaktiviere die zuletzt hinzugefügten Mods oder schau unten ins Log.
            </div>
          </div>
        )}
        <div className="log" style={{ height: 260 }}>
          {(a.tail || []).map((l, i) => (
            <div key={i} className={/ERROR|FATAL|Exception|\bat [a-z]/.test(l) ? 'e' : /WARN/.test(l) ? 'w' : undefined}>
              {l}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
