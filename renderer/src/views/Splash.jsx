import React from 'react';
import { useStore } from '../store.jsx';
import { Logo, Progress } from '../ui.jsx';

/** Kleines Fenster beim Direktstart (Desktop-Verknüpfung). */
export default function Splash() {
  const { tasks } = useStore();
  const t = tasks.find((x) => x.state === 'running') || tasks[tasks.length - 1];
  return (
    <div className="splash">
      <div className="row" style={{ gap: 10 }}>
        <Logo size={24} />
        <div className="pixel" style={{ fontSize: 18 }}>
          {t ? t.title : 'Starte Minecraft …'}
        </div>
      </div>
      <div className="small muted ellipsis">{t ? (t.state === 'error' ? t.error : t.label) : 'Einen Moment …'}</div>
      <Progress value={t ? t.done : 0} total={t ? t.total : 0} />
    </div>
  );
}
