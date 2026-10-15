import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const bw = window.bw;
const Ctx = createContext(null);

export function call(method, ...args) {
  return bw.call(method, ...args);
}

export function StoreProvider({ children }) {
  const [state, setState] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [route, setRoute] = useState({ view: 'library' });
  const [crash, setCrash] = useState(null);
  const [gameLogs, setGameLogs] = useState({});
  const [contentRev, setContentRev] = useState(0);
  const refreshTimer = useRef(null);

  const toast = useCallback((text, type = 'info', ms = 4500) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await call('state');
      setState(s);
      setTasks(s.tasks);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const softRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 150);
  }, [refresh]);

  useEffect(() => {
    refresh();
    return bw.on((name, data) => {
      if (name === 'tasks') setTasks(data);
      else if (name === 'changed') {
        if (data.what === 'content') setContentRev((r) => r + 1);
        softRefresh();
      } else if (name === 'game-log') {
        setGameLogs((g) => {
          const cur = g[data.instanceId] || [];
          const next = cur.concat(data.lines);
          return { ...g, [data.instanceId]: next.length > 3000 ? next.slice(-3000) : next };
        });
      } else if (name === 'game-start') {
        setGameLogs((g) => ({ ...g, [data.instanceId]: [] }));
        softRefresh();
      } else if (name === 'game-exit') {
        if (data.crashed) setCrash(data);
        softRefresh();
      } else if (name === 'toast') toast(data.text, data.type);
      else if (name === 'pending-available') {
        const total = data.reduce((s, x) => s + x.count, 0);
        toast(`${total} geparkte Mod${total === 1 ? ' ist' : 's sind'} jetzt verfügbar – öffne die Instanz, um sie zu aktivieren.`, 'ok', 8000);
        softRefresh();
      }
    });
  }, [refresh, softRefresh, toast]);

  /** Aufruf mit Fehler-Toast. */
  const run = useCallback(
    async (method, ...args) => {
      try {
        return await call(method, ...args);
      } catch (e) {
        toast(e.message, 'error', 8000);
        throw e;
      }
    },
    [toast]
  );

  const value = useMemo(
    () => ({ state, tasks, toasts, toast, refresh, route, setRoute, run, crash, setCrash, gameLogs, contentRev }),
    [state, tasks, toasts, toast, refresh, route, run, crash, gameLogs, contentRev]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  return useContext(Ctx);
}

/** Startet eine Instanz; fragt bei Bedarf die Anmeldung ab. */
export function useLaunch() {
  const { run, toast, refresh } = useStore();
  return useCallback(
    async (id, opts) => {
      try {
        await call('launch', id, opts);
      } catch (e) {
        if (e.code === 'MS_EXPIRED' || e.code === 'NO_ACCOUNT') {
          toast('Bitte melde dich (erneut) mit Microsoft an.', 'info');
          try {
            await call('login');
            await refresh();
            await run('launch', id, opts);
          } catch (e2) {
            if (!/abgebrochen/i.test(e2.message)) toast(e2.message, 'error', 8000);
          }
        } else if (!/Absturz-Dialog/.test(e.message)) {
          toast(e.message, 'error', 9000);
        }
      }
    },
    [run, toast, refresh]
  );
}
