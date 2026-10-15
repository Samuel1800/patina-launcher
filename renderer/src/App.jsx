import React, { useMemo, useRef, useState } from 'react';
import { Download, Settings as SettingsIcon, CheckCircle2, AlertTriangle, Info, X, LogOut, UserPlus, Check } from 'lucide-react';
import { useStore, call } from './store.jsx';
import { Logo, Progress, Menu, cls } from './ui.jsx';
import Library from './views/Library.jsx';
import InstanceView from './views/Instance.jsx';
import Discover from './views/Discover.jsx';
import SettingsView from './views/Settings.jsx';
import Welcome from './views/Welcome.jsx';
import CrashModal from './modals/Crash.jsx';

export default function App() {
  const { state, route, setRoute, toasts, crash, setCrash } = useStore();
  if (!state) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="brand">
            <Logo /> Patina
          </div>
        </div>
        <div />
      </div>
    );
  }
  const needsWelcome = !state.accounts.length && !state.settings.onboarded;
  return (
    <div className="app">
      <TopBar />
      <main className="main">
        {needsWelcome ? (
          <Welcome />
        ) : route.view === 'instance' ? (
          <InstanceView key={route.id} id={route.id} initialTab={route.tab} />
        ) : route.view === 'discover' ? (
          <Discover />
        ) : route.view === 'settings' ? (
          <SettingsView />
        ) : (
          <Library />
        )}
      </main>
      <Toasts toasts={toasts} />
      {crash && <CrashModal data={crash} onClose={() => setCrash(null)} />}
    </div>
  );
}

function TopBar() {
  const { state, route, setRoute, tasks } = useStore();
  const [showTasks, setShowTasks] = useState(false);
  const visibleTasks = tasks.filter((t) => !t.quiet);
  const running = visibleTasks.filter((t) => t.state === 'running');
  const nav = [
    { id: 'library', label: 'Bibliothek' },
    { id: 'discover', label: 'Entdecken' },
  ];
  const isOn = (id) => route.view === id || (id === 'library' && route.view === 'instance');
  return (
    <header className="topbar">
      <div className="brand">
        <Logo /> Patina
      </div>
      <nav className="nav">
        {nav.map((n) => (
          <button key={n.id} className={cls(isOn(n.id) && 'on')} onClick={() => setRoute({ view: n.id })}>
            {n.label}
          </button>
        ))}
      </nav>
      <div className="spacer" />
      <div style={{ position: 'relative' }}>
        <button className="btn ghost icon taskbtn" title="Aufgaben & Downloads" onClick={() => setShowTasks((s) => !s)} aria-label="Aufgaben">
          <Download size={18} />
          {running.length > 0 && <span className="taskbadge">{running.length}</span>}
        </button>
      </div>
      <button className={cls('btn ghost icon', route.view === 'settings' && 'on')} title="Einstellungen" onClick={() => setRoute({ view: 'settings' })} aria-label="Einstellungen">
        <SettingsIcon size={18} />
      </button>
      <AccountButton />
      {showTasks && <TasksPopover tasks={visibleTasks} onClose={() => setShowTasks(false)} />}
    </header>
  );
}

function Head({ uuid, size = 26 }) {
  const [err, setErr] = useState(false);
  if (!uuid || err) return <div style={{ width: size, height: size, borderRadius: 6, background: 'var(--bg-4)' }} />;
  return <img src={`https://mc-heads.net/avatar/${uuid}/${size * 2}`} width={size} height={size} style={{ borderRadius: 6, imageRendering: 'pixelated' }} onError={() => setErr(true)} alt="" />;
}

function AccountButton() {
  const { state, run, refresh, toast } = useStore();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const active = state.accounts.find((a) => a.active) || state.accounts[0];
  const login = async () => {
    try {
      const a = await call('login');
      toast(`Angemeldet als ${a.name}`, 'ok');
      refresh();
    } catch (e) {
      if (!/abgebrochen/i.test(e.message)) toast(e.message, 'error', 9000);
    }
  };
  if (!active) {
    return (
      <button className="btn sm" onClick={login} style={{ marginLeft: 6 }}>
        <UserPlus size={15} /> Anmelden
      </button>
    );
  }
  return (
    <>
      <button ref={ref} className="btn ghost" onClick={() => setOpen((o) => !o)} style={{ gap: 9, paddingLeft: 8, marginLeft: 4 }}>
        <Head uuid={active.uuid} />
        <span style={{ fontWeight: 600 }}>{active.name}</span>
      </button>
      {open && (
        <Menu anchor={ref.current} onClose={() => setOpen(false)}>
          {state.accounts.map((a) => (
            <button key={a.id} onClick={() => run('setActiveAccount', a.id)}>
              <Head uuid={a.uuid} size={22} />
              <span className="grow">{a.name}</span>
              {a.active && <Check size={15} color="var(--verdigris)" />}
            </button>
          ))}
          <hr />
          <button onClick={login}>
            <UserPlus size={16} /> Weiteres Konto hinzufügen
          </button>
          <button className="danger" onClick={() => run('removeAccount', active.id)}>
            <LogOut size={16} /> {active.name} abmelden
          </button>
        </Menu>
      )}
    </>
  );
}

function TasksPopover({ tasks, onClose }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={onClose} />
      <div className="popover" role="dialog" aria-label="Aufgaben">
        {!tasks.length && <div className="empty small" style={{ padding: 24 }}>Gerade läuft nichts.</div>}
        {tasks.map((t) => (
          <div key={t.id} className="task">
            <div className="row" style={{ marginBottom: 6 }}>
              <div className="grow">
                <div style={{ fontWeight: 600 }} className="ellipsis">
                  {t.title}
                </div>
                <div className={cls('small ellipsis', t.state === 'error' ? '' : 'muted')} style={t.state === 'error' ? { color: '#ff9a9d' } : null}>
                  {t.state === 'error' ? t.error : t.label}
                </div>
              </div>
              {t.state === 'running' && t.cancellable && (
                <button className="btn ghost icon sm" title="Abbrechen" onClick={() => call('cancelTask', t.id)} aria-label="Abbrechen">
                  <X size={15} />
                </button>
              )}
              {t.state === 'done' && <CheckCircle2 size={17} color="var(--verdigris)" />}
            </div>
            {t.state === 'running' && <Progress value={t.done} total={t.total} />}
          </div>
        ))}
      </div>
    </>
  );
}

function Toasts({ toasts }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cls('toast', t.type)}>
          {t.type === 'error' ? <AlertTriangle size={18} /> : t.type === 'ok' ? <CheckCircle2 size={18} /> : <Info size={18} />}
          <div>{t.text}</div>
        </div>
      ))}
    </div>
  );
}
